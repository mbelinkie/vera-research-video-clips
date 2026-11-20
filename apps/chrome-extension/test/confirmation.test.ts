import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

type FakeElement = {
  hidden: boolean;
  disabled: boolean;
  value: string;
  checked: boolean;
  textContent: string;
  selectedOptions: Array<{ text: string }>;
  focus(): void;
  replaceChildren(...children: unknown[]): void;
  add(...children: unknown[]): void;
  append(...children: unknown[]): void;
  onsubmit?: (event: { preventDefault(): void }) => Promise<void>;
  onchange?: () => void;
  oninput?: () => void;
};

function element(): FakeElement {
  return {
    hidden: true,
    disabled: false,
    value: "",
    checked: false,
    textContent: "",
    selectedOptions: [{ text: "Editorial" }],
    focus() {},
    replaceChildren() {},
    add() {},
    append() {},
  };
}

async function runConfirmation(
  options: {
    draft?: Record<string, unknown>;
    sourceReason?: string | null;
    captureResponses?: Array<unknown | Error>;
  } = {},
) {
  const requestId = "3874ec11-5ba7-4249-8985-e16bbe14dbde";
  const draft = options.draft ?? {
    kind: "youtube",
    requestId,
    url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
  };
  const paired = { origin: "https://vera.example", key: "fixture" };
  const elements = new Map<string, FakeElement>();
  const captures: unknown[] = [];
  const byId = (id: string) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id)!;
  };
  let captureIndex = 0;
  const gateway = vi.fn(
    async (_origin: string, path: string, body: unknown) => {
      if (path === "projects") return [{ id: "project", name: "Editorial" }];
      if (path.endsWith("/youtube-source"))
        return {
          sourceId: "source-id",
          reason:
            options.sourceReason === null
              ? null
              : {
                  text: options.sourceReason ?? "Compare this video.",
                  updatedBy: "member-id",
                  updatedByName: "Researcher",
                  updatedAt: "2026-11-20T00:00:00.000Z",
                },
        };
      captures.push(body);
      const response = options.captureResponses?.[captureIndex++];
      if (response instanceof Error) throw response;
      return (
        response ?? {
          batchId: "batch-id",
          status: "queued",
          sourceId: "source-id",
          sourcePath: "/?projectId=project&sourceId=source-id",
        }
      );
    },
  );
  const sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === "vera.capture.read") return { ...draft };
    if (message.type === "vera.capture.youtube-playhead")
      return { ok: true, playheadMs: 193001 };
    return undefined;
  });
  const script = await readFile(
    new URL("../confirm.js", import.meta.url),
    "utf8",
  );
  await runInNewContext(
    script
      .replace(/^import .*?;\s*/u, "")
      .replace("void load();\n", "load();\n"),
    {
      document: { getElementById: byId },
      window: {},
      location: { hash: "#" + requestId },
      Option: class {},
      crypto: { randomUUID: () => "fresh-request-id" },
      chrome: {
        runtime: {
          sendMessage,
          openOptionsPage: vi.fn(),
        },
      },
      connection: async () => paired,
      gateway,
    },
  );
  await vi.waitFor(() =>
    expect(byId("status").textContent).toContain("Connected"),
  );
  return { byId, gateway, captures, sendMessage, requestId };
}

it("prefills and explicitly clears a general YouTube reason", async () => {
  const fixture = await runConfirmation();
  expect(fixture.byId("reason").value).toBe("Compare this video.");
  fixture.byId("reason").value = "";
  fixture.byId("project").value = "project";
  await fixture.byId("save").onsubmit!({ preventDefault() {} });
  expect(fixture.captures[0]).toEqual({
    kind: "youtube",
    requestId: fixture.requestId,
    url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    youtubeDetails: { kind: "general", reason: "" },
  });
});

it("samples a frozen time once and sends a separate moment note", async () => {
  const fixture = await runConfirmation({ sourceReason: null });
  expect(fixture.byId("time").checked).toBe(false);
  expect(fixture.byId("time-text").textContent).toBe("Capture current time");
  fixture.byId("time").checked = true;
  await fixture.byId("time").onchange!();
  await vi.waitFor(() =>
    expect(fixture.byId("time-text").textContent).toBe("Include 3:13"),
  );
  expect(fixture.byId("video-reason").hidden).toBe(true);
  expect(fixture.byId("moment-note-field").hidden).toBe(false);
  fixture.byId("note").value = "Revisit the opening claim.";
  fixture.byId("note").oninput!();
  fixture.byId("project").value = "project";
  await fixture.byId("save").onsubmit!({ preventDefault() {} });
  expect(fixture.captures[0]).toEqual({
    kind: "youtube",
    requestId: fixture.requestId,
    url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    youtubeDetails: {
      kind: "moment",
      timecodeMs: 193001,
      note: "Revisit the opening claim.",
    },
  });
  expect(
    fixture.sendMessage.mock.calls.filter(
      ([message]) => message.type === "vera.capture.youtube-playhead",
    ),
  ).toHaveLength(1);
});

it("restores separate reason and moment drafts across mode switches", async () => {
  const fixture = await runConfirmation({ sourceReason: null });
  fixture.byId("reason").value = "General context";
  fixture.byId("reason").oninput!();
  fixture.byId("time").checked = true;
  await fixture.byId("time").onchange!();
  fixture.byId("note").value = "A point to revisit";
  fixture.byId("note").oninput!();
  fixture.byId("time").checked = false;
  fixture.byId("time").onchange!();
  expect(fixture.byId("reason").value).toBe("General context");
  fixture.byId("time").checked = true;
  await fixture.byId("time").onchange!();
  expect(fixture.byId("note").value).toBe("A point to revisit");
});

it("keeps the request ID for an unchanged retry and refreshes it after intent changes", async () => {
  const fixture = await runConfirmation({
    sourceReason: null,
    captureResponses: [
      new Error("temporary outage"),
      new Error("temporary outage"),
      { batchId: "batch-id", status: "queued" },
    ],
  });
  fixture.byId("project").value = "project";
  await fixture.byId("save").onsubmit!({ preventDefault() {} });
  await fixture.byId("save").onsubmit!({ preventDefault() {} });
  const first = fixture.captures[0] as { requestId: string };
  const second = fixture.captures[1] as { requestId: string };
  expect(second.requestId).toBe(first.requestId);
  fixture.byId("reason").value = "Changed intent";
  fixture.byId("reason").oninput!();
  await fixture.byId("save").onsubmit!({ preventDefault() {} });
  expect((fixture.captures[2] as { requestId: string }).requestId).toBe(
    "fresh-request-id",
  );
});
