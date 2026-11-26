import { expect, test, type BrowserContext } from "@playwright/test";

type FakeCode = "alice" | "bob" | "carol";

async function signIn(context: BrowserContext, code: FakeCode) {
  // A fake IdP with a nonresolving DNS name cannot be reliably intercepted
  // after an HTTP 303 navigation. The browser context's request client shares
  // cookies with its pages: retain the real login transaction, then complete
  // the test-only fake provider callback through a top-level navigation.
  const initial = await context.request.get("/cloud-api/auth/login", {
    maxRedirects: 0,
  });
  expect(initial.status()).toBe(303);
  const url = new URL(initial.headers().location!);
  expect(url.origin).toBe("https://idp.example");
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")?.length).toBe(43);
  expect(url.searchParams.get("nonce")?.length).toBe(43);
  expect(url.searchParams.get("redirect_uri")).toBe(
    "https://127.0.0.1:43177/cloud-api/auth/callback",
  );
  const page = await context.newPage();
  await page.goto(
    `/cloud-api/auth/callback?state=${encodeURIComponent(url.searchParams.get("state")!)}&code=${code}`,
  );
  const profileName = page.getByLabel("Display name");
  if (!(await session(context)).registered) {
    await expect(profileName).toBeVisible();
    await profileName.fill(code);
    await page.getByRole("button", { name: "Create profile" }).click();
  }
  await expect(page.getByText(`Signed in as ${code}.`)).toBeVisible();
  return page;
}

test("HTTPS BFF supports two independent invited actors, CSRF and signout without browser tokens", async ({
  browser,
}) => {
  const a = await browser.newContext({ ignoreHTTPSErrors: true });
  const b = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const alice = await signIn(a, "alice");
    const bob = await signIn(b, "bob");
    const aCookies = await a.cookies();
    const sessionCookie = aCookies.find(
      (cookie) => cookie.name === "__Host-vera_session",
    );
    expect(sessionCookie).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
    expect(sessionCookie?.domain).toBe("127.0.0.1");
    expect(await alice.evaluate(() => Object.keys(localStorage))).toEqual([]);
    expect(await bob.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
    await alice.getByLabel("Create a project").fill("Alice private project");
    await alice
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(
      alice.getByText("Created project “Alice private project”."),
    ).toBeVisible();
    const aliceProjects = await alice.evaluate(async () =>
      (await fetch("/cloud-api/api/projects")).json(),
    );
    const bobProjects = await bob.evaluate(async () =>
      (await fetch("/cloud-api/api/projects")).json(),
    );
    expect(aliceProjects).toHaveLength(1);
    expect(bobProjects).toEqual([]);
    const unauthorizedRead = await bob.evaluate(
      async (projectId) =>
        fetch(`/cloud-api/api/projects/${projectId}/clips`).then(
          (response) => response.status,
        ),
      aliceProjects[0].id,
    );
    expect(unauthorizedRead).toBe(403);
    const csrfRefused = await b.request.post("/cloud-api/api/projects", {
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      data: { name: "forgery" },
    });
    expect(csrfRefused.status()).toBe(403);
    await alice.getByRole("button", { name: "Sign out" }).click();
    await expect(alice.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(bob.getByText("Signed in as bob.")).toBeVisible();
  } finally {
    await a.close();
    await b.close();
  }
});

type SessionSnapshot = {
  authenticated: true;
  registered: boolean;
  csrfToken: string;
  user: { id: string; displayName: string } | null;
};

async function session(context: BrowserContext): Promise<SessionSnapshot> {
  const response = await context.request.get("/cloud-api/api/session");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as SessionSnapshot;
}

async function api(
  context: BrowserContext,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const current = await session(context);
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  const options: {
    method: string;
    headers: Record<string, string>;
    data?: unknown;
  } = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    headers.origin = "https://127.0.0.1:43177";
    headers["x-vera-csrf"] = current.csrfToken;
  }
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    options.data = body;
  }
  return context.request.fetch(path, options);
}

async function json<T>(response: Awaited<ReturnType<typeof api>>): Promise<T> {
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as T;
}

type Member = {
  projectId: string;
  userId: string;
  role: "owner" | "editor" | "researcher" | "viewer";
  version: number;
  displayName: string;
  verifiedEmail: string | null;
};

async function openPublishedTranscript(
  page: import("@playwright/test").Page,
  videoId: string,
) {
  await page.route("https://www.youtube.com/**", (route) => route.abort());
  await page.getByLabel("YouTube URL or video ID").fill(videoId);
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByTestId("transcript-window-row")).toHaveCount(2);
}

async function selectTranscriptRange(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const words = Array.from(
      document.querySelectorAll<HTMLElement>("[data-transcript-token-id]"),
    );
    const anchor = words[0];
    const focus = words.at(-1);
    if (!anchor?.firstChild || !focus?.firstChild || !focus.textContent)
      throw new Error("Missing fixture transcript tokens");
    const range = document.createRange();
    range.setStart(anchor.firstChild, 0);
    range.setEnd(focus.firstChild, focus.textContent.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    focus.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.getByLabel("Clip selection")).toBeVisible();
}

test("owner sharing preserves role boundaries, clip durability, stale writes, revoke, and transfer", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ownerContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const editorContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const viewerContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const owner = await signIn(ownerContext, "alice");
    await owner.getByLabel("Create a project").fill("Members acceptance");
    await owner
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(owner.getByText("Created project")).toBeVisible();
    const projects = await json<Array<{ id: string; name: string }>>(
      await api(ownerContext, "/cloud-api/api/projects"),
    );
    const project = projects.find(
      (candidate) => candidate.name === "Members acceptance",
    );
    expect(project).toBeTruthy();
    const projectId = project!.id;
    await expect(owner.getByLabel("Target project")).toHaveValue(projectId);

    // The selected-project controls remain keyboard reachable before any
    // membership mutation. This catches a panel inserted outside the form's
    // normal tab order.
    await owner.getByLabel("Target project").focus();
    await owner.keyboard.press("Tab");
    await expect(owner.locator(":focus")).not.toHaveCount(0);

    const editor = await signIn(editorContext, "bob");
    const viewer = await signIn(viewerContext, "carol");
    const { videoId, transcriptUrl } = await json<{
      videoId: string;
      transcriptUrl: string;
    }>(
      await api(
        ownerContext,
        `/__fixture/projects/${projectId}/transcript`,
        "POST",
      ),
    );
    const transcriptPath = `/cloud-api/api/projects/${projectId}/transcripts/english/${videoId}`;
    const csvPath = `/cloud-api/api/projects/${projectId}/clips.csv`;
    let editorClipPayload: Record<string, unknown> | undefined;
    editor.on("request", (request) => {
      const requestUrl = new URL(request.url());
      if (
        request.method() === "POST" &&
        requestUrl.pathname === `/cloud-api/api/projects/${projectId}/clips`
      )
        editorClipPayload = request.postDataJSON() as Record<string, unknown>;
    });

    // A signed-in nonmember cannot infer project membership or clips.
    for (const path of [transcriptPath, transcriptUrl, csvPath]) {
      expect((await api(viewerContext, path)).status()).toBe(403);
    }
    expect(
      (
        await api(
          viewerContext,
          `/cloud-api/api/projects/${projectId}/my-membership`,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await api(viewerContext, `/cloud-api/api/projects/${projectId}/clips`)
      ).status(),
    ).toBe(403);

    await expect(
      owner.getByRole("heading", { name: "Project members" }),
    ).toBeVisible();
    await expect(owner.locator(".member-row")).toHaveCount(1);
    await expect(owner.getByText("alice@example.test")).toBeVisible();
    const memberEmail = owner.getByLabel("Registered user email");
    await memberEmail.fill("missing@example.test");
    await owner.getByRole("button", { name: "Grant access" }).click();
    await expect(owner.getByRole("alert")).toContainText(
      /No account is available to share/,
    );

    // Enter submits the bounded exact-email grant form through its keyboard
    // path, which also keeps the project destination visible in the panel.
    await memberEmail.fill("bob@example.test");
    await memberEmail.press("Enter");
    await expect(
      owner.getByText("Granted editor access to the existing account."),
    ).toBeVisible();
    await memberEmail.fill("carol@example.test");
    await owner.getByLabel("New member role").selectOption("viewer");
    await memberEmail.press("Enter");
    await expect(
      owner.getByText("Granted viewer access to the existing account."),
    ).toBeVisible();

    const members = await json<Member[]>(
      await api(ownerContext, `/cloud-api/api/projects/${projectId}/members`),
    );
    expect(
      members.map(({ verifiedEmail, role }) => [verifiedEmail, role]),
    ).toEqual(
      expect.arrayContaining([
        ["alice@example.test", "owner"],
        ["bob@example.test", "researcher"],
        ["carol@example.test", "viewer"],
      ]),
    );
    const bobMember = members.find(
      (member) => member.verifiedEmail === "bob@example.test",
    )!;
    const carolMember = members.find(
      (member) => member.verifiedEmail === "carol@example.test",
    )!;

    await editor.getByRole("button", { name: "Refresh projects" }).click();
    await expect(editor.getByLabel("Target project")).toHaveValue(projectId);
    const editorMembership = await json<{ membership: Member }>(
      await api(
        editorContext,
        `/cloud-api/api/projects/${projectId}/my-membership`,
      ),
    );
    expect(editorMembership.membership).toMatchObject({
      role: "researcher",
      userId: bobMember.userId,
    });

    // Change Bob behind the panel's back, then use its stale version through
    // the UI. The panel must surface the conflict and reload its roster.
    const roleChange = await api(
      ownerContext,
      `/cloud-api/api/projects/${projectId}/members/${bobMember.userId}`,
      "PATCH",
      { role: "viewer", expectedVersion: bobMember.version },
    );
    expect(roleChange.status()).toBe(204);
    const stale = await api(
      ownerContext,
      `/cloud-api/api/projects/${projectId}/members/${bobMember.userId}`,
      "PATCH",
      { role: "editor", expectedVersion: bobMember.version },
    );
    expect(stale.status()).toBe(409);
    const bobRow = owner
      .locator(".member-row")
      .filter({ hasText: "bob@example.test" });
    await bobRow.getByRole("button", { name: "Make Viewer" }).click();
    await expect(
      owner.getByText(/membership changed in another session/i),
    ).toBeVisible();
    await expect(
      bobRow.getByRole("button", { name: "Make Editor" }),
    ).toBeVisible();
    await bobRow.getByRole("button", { name: "Make Editor" }).click();
    await expect(owner.getByText("Changed bob to editor.")).toBeVisible();

    await expect(editor.getByLabel("Target project")).toHaveValue(projectId);
    await openPublishedTranscript(editor, videoId);
    await selectTranscriptRange(editor);
    await editor.getByRole("button", { name: "Queue / log only" }).click();
    await expect(
      editor.getByText(/Logged to Members acceptance/),
    ).toBeVisible();
    expect(editorClipPayload).toMatchObject({
      video: { youtubeVideoId: videoId },
      selection: expect.any(Object),
      languageEvidence: {
        schemaVersion: 2,
        native: { role: "native" },
        english: { role: "english", text: expect.any(String) },
      },
    });
    expect(editorClipPayload).not.toHaveProperty("englishText");
    await owner.reload();
    await expect(owner.getByLabel("Target project")).toHaveValue(projectId);
    await expect(
      owner.getByRole("heading", { name: "Clip queue" }),
    ).toBeVisible();
    const ownerClips = await json<Array<{ id: string; englishText: string }>>(
      await api(ownerContext, `/cloud-api/api/projects/${projectId}/clips`),
    );
    expect(ownerClips).toHaveLength(1);
    expect(ownerClips[0]?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(ownerClips[0]?.englishText).toBe(
      (
        editorClipPayload?.languageEvidence as {
          english: { text: string };
        }
      ).english.text,
    );
    await expect(
      owner.getByText(ownerClips[0]!.englishText, { exact: true }),
    ).toBeVisible();

    // Viewer can read own membership and project clips but cannot mutate
    // membership or append a project record.
    await viewer.getByRole("button", { name: "Refresh projects" }).click();
    await expect(viewer.getByLabel("Target project")).toHaveValue(projectId);
    await openPublishedTranscript(viewer, videoId);
    const viewerDownload = await api(viewerContext, transcriptUrl);
    expect(viewerDownload.status()).toBe(200);
    expect(viewerDownload.headers()["cache-control"]).toBe("no-store");
    const viewerCsv = await api(viewerContext, csvPath);
    expect(viewerCsv.status()).toBe(200);
    expect(viewerCsv.headers()["cache-control"]).toBe("no-store");
    const viewerMembership = await json<{ membership: Member }>(
      await api(
        viewerContext,
        `/cloud-api/api/projects/${projectId}/my-membership`,
      ),
    );
    expect(viewerMembership.membership).toMatchObject({
      role: "viewer",
      userId: carolMember.userId,
    });
    const viewerWrite = await api(
      viewerContext,
      `/cloud-api/api/projects/${projectId}/clips`,
      "POST",
      {
        ...editorClipPayload,
        idempotencyKey: `viewer-denied-${Date.now()}`,
      },
    );
    expect(viewerWrite.status()).toBe(403);
    // A viewer may read the flat roster but never the owner-only identity
    // details (display name and verified email).
    const viewerRoster = await api(
      viewerContext,
      `/cloud-api/api/projects/${projectId}/members`,
    );
    expect(viewerRoster.status()).toBe(200);
    for (const member of await json<Array<Record<string, unknown>>>(
      viewerRoster,
    )) {
      expect(member).not.toHaveProperty("verifiedEmail");
      expect(member).not.toHaveProperty("displayName");
    }
    expect(
      (
        await api(
          viewerContext,
          `/cloud-api/api/projects/${projectId}/members/by-email`,
          "POST",
          {
            email: "alice@example.test",
            role: "viewer",
          },
        )
      ).status(),
    ).toBe(403);

    // Revocation requires explicit confirmation and invalidates a still-open
    // browser session on its next protected request.
    const carolRow = owner
      .locator(".member-row")
      .filter({ hasText: "carol@example.test" });
    const revokeDialog = owner.waitForEvent("dialog").then(async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      return message;
    });
    await carolRow.getByRole("button", { name: "Revoke" }).click();
    expect(await revokeDialog).toContain("Members acceptance");
    await expect(
      owner.getByText("Removed carol from the project."),
    ).toBeVisible();
    for (const path of [transcriptPath, transcriptUrl, csvPath]) {
      expect((await api(viewerContext, path)).status()).toBe(403);
    }
    expect(
      (
        await api(
          viewerContext,
          `/cloud-api/api/projects/${projectId}/my-membership`,
        )
      ).status(),
    ).toBe(403);

    // Transfer ownership to the already-granted Editor with an explicit
    // confirmation. The old owner remains an Editor and loses management
    // access.
    const bobTransferRow = owner
      .locator(".member-row")
      .filter({ hasText: "bob@example.test" });
    const transferDialog = owner.waitForEvent("dialog").then(async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      return message;
    });
    await bobTransferRow
      .getByRole("button", { name: "Transfer ownership" })
      .click();
    expect(await transferDialog).toContain("Members acceptance");
    await expect(
      owner.getByText("Ownership transferred to bob."),
    ).toBeVisible();
    const transferred = await json<Member[]>(
      await api(editorContext, `/cloud-api/api/projects/${projectId}/members`),
    );
    expect(
      transferred.find((member) => member.userId === bobMember.userId)?.role,
    ).toBe("owner");
    // The former owner is now an Editor: flat roster only, no owner details.
    const formerOwnerRoster = await api(
      ownerContext,
      `/cloud-api/api/projects/${projectId}/members`,
    );
    expect(formerOwnerRoster.status()).toBe(200);
    for (const member of await json<Array<Record<string, unknown>>>(
      formerOwnerRoster,
    )) {
      expect(member).not.toHaveProperty("verifiedEmail");
    }
  } finally {
    await ownerContext.close();
    await editorContext.close();
    await viewerContext.close();
  }
});
