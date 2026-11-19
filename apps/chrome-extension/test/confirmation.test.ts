import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it.each([false, true])(
  "sends the captured YouTube position only when selected (%s)",
  async (checked) => {
    const requestId = "3874ec11-5ba7-4249-8985-e16bbe14dbde";
    const draft = {
      kind: "youtube",
      requestId,
      url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      playheadMs: 193001,
    };
    const paired = { origin: "https://vera.example", key: "fixture" };
    const gateway = vi.fn(
      async (_origin: string, path: string, _body: unknown) =>
        path === "projects"
          ? [{ id: "project", name: "Editorial" }]
          : { status: "queued" },
    );
    const elements = new Map<string, ReturnType<typeof element>>();
    function element() {
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
        onsubmit: undefined as
          undefined | ((event: { preventDefault(): void }) => Promise<void>),
      };
    }
    function byId(id: string) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id)!;
    }
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
        chrome: { runtime: { sendMessage: async () => ({ ...draft }) } },
        connection: async () => paired,
        gateway,
      },
    );
    await vi.waitFor(() =>
      expect(byId("status").textContent).toContain("Connected"),
    );
    expect(byId("time").checked).toBe(false);
    expect(byId("time-text").textContent).toBe("Include 3:13");
    expect(gateway.mock.calls.map((call) => call[1])).toEqual(["projects"]);
    byId("time").checked = checked;
    byId("project").value = "project";
    byId("comment").value = "Compare the before shot.";
    await byId("save").onsubmit!({ preventDefault() {} });
    expect(gateway.mock.calls[1]?.[2]).toEqual({
      kind: draft.kind,
      url: draft.url,
      requestId,
      comment: "Compare the before shot.",
      ...(checked && { timecodeMs: draft.playheadMs }),
    });
  },
);
