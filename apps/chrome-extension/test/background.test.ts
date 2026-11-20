import { afterEach, describe, expect, it, vi } from "vitest";

type Tab = {
  id: number;
  windowId: number;
  url: string;
  title?: string;
};

type Event = {
  addListener(listener: (...args: any[]) => any): void;
  dispatch(...args: any[]): any;
};

const REQUEST_ID_PATTERN = /^[0-9a-f-]{36}$/u;
const PNG = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0,
  0, 0, 3,
]);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;
const source: Tab = {
  id: 7,
  windowId: 1,
  url: "https://example.test/article?authToken=private&story=7",
  title: "Fixture article",
};

function event(): Event {
  const listeners: Array<(...args: any[]) => any> = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    dispatch(...args) {
      return listeners[0]?.(...args);
    },
  };
}

function identity(tab: Tab = source) {
  const url = new URL(tab.url);
  url.searchParams.delete("authToken");
  return {
    url: url.toString(),
    navigationKey: "fixture-navigation",
    viewport: { width: 800, height: 600 },
    scroll: { x: 17, y: 240 },
  };
}

function createFixture(
  options: {
    activeTab?: Tab;
    targetTabs?: Tab[];
    onContent?: (tab: Tab, message: { type: string }) => unknown;
    onCapture?: () => void;
    unknownConfirmationTab?: boolean;
    contentUrl?: string;
  } = {},
) {
  const runtimeOnMessage = event();
  const contextMenusOnClicked = event();
  const tabsOnActivated = event();
  const tabsOnRemoved = event();
  const effectiveActiveTab = options.activeTab ?? source;
  const tabsById = new Map<number, Tab>([
    [effectiveActiveTab.id, effectiveActiveTab],
    ...(options.targetTabs ?? []).map((tab) => [tab.id, tab] as const),
  ]);
  let activeTab = options.activeTab ?? source;
  let nextConfirmationTabId = 100;
  const extensionId = "a".repeat(32);
  const captureTimes: number[] = [];
  const chrome: any = {
    runtime: {
      getURL: (file: string) => `chrome-extension://${extensionId}/${file}`,
      onInstalled: event(),
      onStartup: event(),
      onMessage: runtimeOnMessage,
    },
    tabs: {
      query: vi.fn(async (query: { active?: boolean; windowId?: number }) => {
        if (query.active) return [activeTab];
        return [...tabsById.values()].filter(
          (tab) =>
            query.windowId === undefined || tab.windowId === query.windowId,
        );
      }),
      get: vi.fn(async (tabId: number) => tabsById.get(tabId)),
      sendMessage: vi.fn(async (tabId: number, message: { type: string }) => {
        const tab = tabsById.get(tabId) ?? source;
        const custom = options.onContent?.(tab, message);
        if (custom !== undefined) return custom;
        const current = identity(tab);
        if (message.type === "vera.capture.prepare-quote") {
          return {
            ok: true,
            value: {
              ...current,
              metadata: { title: tab.title ?? "Fixture" },
              articleText: "Article text only",
              text: "Selected words",
              surroundingWords: { before: "before", after: "after" },
            },
          };
        }
        if (message.type === "vera.capture.quote-data") {
          return {
            ok: true,
            value: {
              ...current,
              metadata: { title: tab.title ?? "Fixture" },
              articleText: "Article text only",
              text: "Selected words",
              surroundingWords: { before: "before", after: "after" },
              rectangles: [{ left: 100, top: 120, width: 220, height: 40 }],
            },
          };
        }
        if (message.type === "vera.capture.scroll-top") {
          return { ok: true, value: { atTop: true } };
        }
        if (message.type === "vera.capture.page") {
          return {
            ok: true,
            value: {
              ...current,
              metadata: { title: tab.title ?? "Fixture" },
              articleText: "Article text only",
            },
          };
        }
        if (message.type === "vera.capture.still") {
          return {
            ok: true,
            value: {
              url: "https://images.example/kept.png",
              pageUrl: current.url,
              title: "Fixture image",
              data: "aGVsbG8=",
              mimeType: "image/png",
            },
          };
        }
        if (message.type === "vera.capture.youtube-playhead") {
          return { ok: true, value: 193001 };
        }
        return { ok: true, value: current };
      }),
      captureVisibleTab: vi.fn(async () => {
        captureTimes.push(Date.now());
        options.onCapture?.();
        return PNG_DATA_URL;
      }),
      create: vi.fn(async ({ url }: { url: string }) => {
        const tab = {
          id: nextConfirmationTabId++,
          windowId: 2,
          url,
          title: "VERA confirmation",
        } satisfies Tab;
        if (!options.unknownConfirmationTab) tabsById.set(tab.id, tab);
        return { id: 2, tabs: options.unknownConfirmationTab ? [] : [tab] };
      }),
      onActivated: tabsOnActivated,
      onRemoved: tabsOnRemoved,
    },
    windows: {
      create: vi.fn(async ({ url }: { url: string }) => {
        const tab = {
          id: nextConfirmationTabId++,
          windowId: 2,
          url,
          title: "VERA confirmation",
        } satisfies Tab;
        if (!options.unknownConfirmationTab) tabsById.set(tab.id, tab);
        return { id: 2, tabs: options.unknownConfirmationTab ? [] : [tab] };
      }),
    },
    scripting: { executeScript: vi.fn(async () => undefined) },
    contextMenus: {
      removeAll: vi.fn((callback: () => void) => callback()),
      create: vi.fn(),
      onClicked: contextMenusOnClicked,
    },
    commands: { onCommand: event() },
    storage: {
      local: {
        set: vi.fn(async () => undefined),
        get: vi.fn(async () => ({})),
      },
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
  };

  return {
    chrome,
    runtimeOnMessage,
    contextMenusOnClicked,
    tabsOnActivated,
    tabsById,
    captureTimes,
    setActiveTab(tab: Tab) {
      activeTab = tab;
    },
    contentUrl: options.contentUrl,
  };
}

async function loadWorker(chrome: any) {
  (globalThis as Record<string, unknown>).chrome = chrome;
  vi.resetModules();
  // @ts-expect-error The JavaScript service worker is exercised under fake Chrome.
  await import("../background.js");
}

async function runtimeMessage(
  fixture: ReturnType<typeof createFixture>,
  message: unknown,
  sender: Record<string, unknown>,
) {
  return new Promise<any>((resolve) => {
    fixture.runtimeOnMessage.dispatch(message, sender, resolve);
  });
}

function confirmationSender(url: string, tabId: number, documentId = "doc-1") {
  return { tab: { id: tabId }, frameId: 0, url, documentId };
}

async function readDraft(
  fixture: ReturnType<typeof createFixture>,
  start: { requestId: string },
  tabId: number,
  documentId = "doc-1",
) {
  const create = fixture.chrome.windows.create.mock.results.at(-1)?.value;
  const popup = create ? await create : undefined;
  const url =
    popup?.tabs?.[0]?.url ??
    `chrome-extension://${"a".repeat(32)}/confirm.html#${start.requestId}`;
  return runtimeMessage(
    fixture,
    { type: "vera.capture.read", requestId: start.requestId },
    confirmationSender(url, tabId, documentId),
  );
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).chrome;
  vi.useRealTimers();
});

describe("capture worker", () => {
  it("runs a page capture through the real worker and restores the source tab", async () => {
    const fixture = createFixture();
    await loadWorker(fixture.chrome);

    const start = await runtimeMessage(
      fixture,
      { type: "vera.capture.start", kind: "page" },
      { url: fixture.chrome.runtime.getURL("popup.html") },
    );

    expect(start.ok).toBe(true);
    expect(REQUEST_ID_PATTERN.test(start.requestId)).toBe(true);
    expect(fixture.chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(2);
    const [firstCapture, secondCapture] = fixture.captureTimes as [
      number,
      number,
    ];
    expect(secondCapture - firstCapture).toBeGreaterThanOrEqual(500);
    expect(
      fixture.chrome.tabs.sendMessage.mock.calls.map(
        ([, message]: any[]) => message.type,
      ),
    ).toContain("vera.capture.page-restore");

    const draft = await readDraft(fixture, start, 100);
    expect(draft.kind).toBe("page");
    expect(draft.top).toMatchObject({ width: 2, height: 3 });
    expect(draft.passage).toMatchObject({ width: 2, height: 3 });
    expect(draft.articleText).toBe("Article text only");
  }, 10_000);

  it("preserves quote geometry and captures both views", async () => {
    const fixture = createFixture();
    await loadWorker(fixture.chrome);

    const start = await runtimeMessage(
      fixture,
      { type: "vera.capture.start", kind: "quote" },
      { url: fixture.chrome.runtime.getURL("popup.html") },
    );
    const draft = await readDraft(fixture, start, 100);

    expect(fixture.chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(2);
    expect(draft.quote.text).toBe("Selected words");
    expect(draft.quote.surroundingWords).toEqual({
      before: "before",
      after: "after",
    });
    expect(draft.quote.highlight.rectangles).toHaveLength(1);
  }, 10_000);

  it("keeps a clean quote passage and restores selection when the extra top screenshot fails", async () => {
    const fixture = createFixture({
      onContent: (_tab, message) => {
        if (message.type === "vera.capture.top-next") {
          return {
            ok: true,
            value: {
              delta: 360,
              rect: { left: 0, top: 0, right: 800, bottom: 600 },
              viewport: { width: 800, height: 600 },
            },
          };
        }
      },
    });
    fixture.chrome.tabs.captureVisibleTab
      .mockResolvedValueOnce(PNG_DATA_URL)
      .mockRejectedValueOnce(new Error("second screenshot unavailable"))
      .mockResolvedValueOnce(PNG_DATA_URL);
    await loadWorker(fixture.chrome);

    const start = await runtimeMessage(
      fixture,
      { type: "vera.capture.start", kind: "quote" },
      { url: fixture.chrome.runtime.getURL("popup.html") },
    );
    expect(start.ok).toBe(true);
    const draft = await readDraft(fixture, start, 100);
    const messages = fixture.chrome.tabs.sendMessage.mock.calls.map(
      ([, message]: any[]) => message.type,
    );
    expect(fixture.chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(3);
    expect(messages.indexOf("vera.capture.top-next")).toBeLessThan(
      messages.indexOf("vera.capture.scroll-selection"),
    );
    expect(messages.at(-1)).toBe("vera.capture.restore");
    expect(draft.top).toMatchObject({ width: 2, height: 3 });
    expect(draft.passage).toMatchObject({ width: 2, height: 3 });
    expect(draft.quote.highlight.rectangles).toEqual([
      { x: 0, y: 0, width: 0.5, height: 1 / 3 },
    ]);
  }, 10_000);

  it("keeps the original page top and restores the reader on an unstable stitch", async () => {
    const fixture = createFixture({
      onContent: (_tab, message) => {
        if (message.type === "vera.capture.top-next") {
          return {
            ok: true,
            value: {
              delta: 360,
              rect: { left: 0, top: 0, right: 800, bottom: 600 },
              viewport: { width: 800, height: 600 },
            },
          };
        }
      },
    });
    await loadWorker(fixture.chrome);
    const start = await runtimeMessage(
      fixture,
      { type: "vera.capture.start", kind: "page" },
      { url: fixture.chrome.runtime.getURL("popup.html") },
    );
    expect(start.ok).toBe(true);
    const draft = await readDraft(fixture, start, 100);
    expect(fixture.chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(3);
    expect(draft.top).toMatchObject({ width: 2, height: 3 });
    expect(draft.passage).toMatchObject({ width: 2, height: 3 });
    expect(
      fixture.chrome.tabs.sendMessage.mock.calls.map(
        ([, message]: any[]) => message.type,
      ),
    ).toContain("vera.capture.page-restore");
  }, 10_000);

  it.each(["Chrome declines capture", "page cannot reach the top"])(
    "can save the quote and passage picture when %s",
    async (reason) => {
      const fixture = createFixture({
        onContent: (_tab, message) => {
          if (
            reason === "page cannot reach the top" &&
            message.type === "vera.capture.scroll-top"
          )
            return { ok: true, value: { atTop: false } };
        },
      });
      if (reason === "Chrome declines capture") {
        fixture.chrome.tabs.captureVisibleTab.mockRejectedValueOnce(
          new Error("capture unavailable"),
        );
      }
      await loadWorker(fixture.chrome);
      const start = await runtimeMessage(
        fixture,
        { type: "vera.capture.start", kind: "quote" },
        { url: fixture.chrome.runtime.getURL("popup.html") },
      );
      expect(start.ok).toBe(true);
      const draft = await readDraft(fixture, start, 100);
      expect(draft).not.toHaveProperty("top");
      expect(draft.passage).toBeDefined();
      expect(draft.quote.text).toBeTruthy();
    },
  );
  it("rejects a viewport change before attaching a screenshot", async () => {
    let identityCalls = 0;
    const fixture = createFixture({
      onContent: (_tab, message) => {
        if (message.type === "vera.capture.identity") {
          identityCalls += 1;
          const value = identity(source);
          if (identityCalls > 1) value.viewport = { width: 801, height: 600 };
          return { ok: true, value };
        }
      },
    });
    await loadWorker(fixture.chrome);

    const result = await runtimeMessage(
      fixture,
      { type: "vera.capture.start", kind: "page" },
      { url: fixture.chrome.runtime.getURL("popup.html") },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("viewport");
    expect(fixture.chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("uses the right-click target for non-raster captures", async () => {
    const target: Tab = {
      id: 9,
      windowId: 1,
      url: "https://research.example/notes",
      title: "Target tab",
    };
    const fixture = createFixture({ targetTabs: [target] });
    await loadWorker(fixture.chrome);
    fixture.contextMenusOnClicked.dispatch(
      {
        menuItemId: "vera-save-audio",
        tabId: target.id,
        linkUrl: "https://cdn.example/clip.mp3",
      },
      target,
    );
    await vi.waitFor(() =>
      expect(fixture.chrome.windows.create).toHaveBeenCalled(),
    );

    const url = fixture.chrome.windows.create.mock.calls[0][0].url as string;
    const requestId = url.split("#")[1];
    const draft = await runtimeMessage(
      fixture,
      { type: "vera.capture.read", requestId },
      confirmationSender(url, 100),
    );
    expect(draft.kind).toBe("audio");
    expect(draft.pageUrl).toBe(target.url);
  });

  it("keeps an optional locally measured YouTube playhead", async () => {
    const fixture = createFixture({
      activeTab: {
        ...source,
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      },
    });
    await loadWorker(fixture.chrome);

    const start = await runtimeMessage(
      fixture,
      { type: "vera.capture.start", kind: "youtube" },
      { url: fixture.chrome.runtime.getURL("popup.html") },
    );
    const draft = await readDraft(fixture, start, 100);
    expect(draft.playheadMs).toBe(193001);
    expect(fixture.chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("omits the YouTube playhead when no local video measurement is available", async () => {
    const fixture = createFixture({
      activeTab: {
        ...source,
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      },
      onContent: (_tab, message) => {
        if (message.type === "vera.capture.youtube-playhead") {
          return { ok: true, value: null };
        }
      },
    });
    await loadWorker(fixture.chrome);

    const start = await runtimeMessage(
      fixture,
      { type: "vera.capture.start", kind: "youtube" },
      { url: fixture.chrome.runtime.getURL("popup.html") },
    );
    const draft = await readDraft(fixture, start, 100);
    expect(draft).not.toHaveProperty("playheadMs");
  });

  it("returns an explicit CORS failure and binds a confirmation tab that races creation", async () => {
    const fixture = createFixture({
      unknownConfirmationTab: true,
      onContent: (_tab, message) => {
        if (message.type === "vera.capture.still") {
          return {
            ok: true,
            value: {
              pageUrl: source.url,
              url: "https://images.example/kept.png",
              title: "Fixture image",
              error:
                "The image could not be copied from this page because CORS or network access was blocked",
            },
          };
        }
      },
    });
    await loadWorker(fixture.chrome);
    const failed = await runtimeMessage(
      fixture,
      { type: "vera.capture.start", kind: "still" },
      { url: fixture.chrome.runtime.getURL("popup.html") },
    );
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("CORS");

    const target = source;
    fixture.contextMenusOnClicked.dispatch(
      {
        menuItemId: "vera-save-audio",
        tabId: target.id,
        linkUrl: "https://cdn.example/clip.mp3",
      },
      target,
    );
    await vi.waitFor(() =>
      expect(fixture.chrome.windows.create).toHaveBeenCalled(),
    );
    const url = fixture.chrome.windows.create.mock.calls[0][0].url as string;
    const requestId = url.split("#")[1];
    const capture = await runtimeMessage(
      fixture,
      { type: "vera.capture.read", requestId },
      confirmationSender(url, 222),
    );
    expect(capture.kind).toBe("audio");
    expect(fixture.chrome.action.setBadgeText).toHaveBeenCalled();
  });
});
