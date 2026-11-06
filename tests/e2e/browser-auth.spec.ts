import { expect, test, type BrowserContext } from "@playwright/test";

async function signIn(context: BrowserContext, code: "alice" | "bob") {
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
  await expect(page.getByLabel("Display name")).toBeVisible();
  await page.getByLabel("Display name").fill(code);
  await page.getByRole("button", { name: "Create profile" }).click();
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
