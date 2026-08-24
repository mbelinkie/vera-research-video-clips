import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopNotificationPreferences,
  NotificationEvent,
  NotificationFeedPage,
} from "@research-video/contracts";

import {
  DesktopNotificationCoordinator,
  FileDesktopNotificationStore,
  type DesktopNotificationStore,
  type NotificationSession,
} from "./notification-coordinator.ts";

const accountA = "a".repeat(64);
const accountB = "b".repeat(64);
const enabledAt = "2026-08-24T12:00:00.000Z";
const temporaryDirectories = new Set<string>();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("desktop notification coordinator", () => {
  it("defaults off and rejects enabling when native support is unavailable", async () => {
    const store = memoryStore();
    const readCloud = vi.fn(async () => page([]));
    const schedule = vi.fn(() => 1 as never) as unknown as typeof setTimeout;
    const coordinator = createCoordinator({
      store,
      supported: false,
      schedule,
    });

    await coordinator.setSession(session(accountA, readCloud));
    expect(await coordinator.preferences()).toEqual({
      enabled: false,
      updatedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(coordinator.supportStatus()).toEqual({
      available: false,
      reason: "unsupported_platform",
    });
    expect(schedule).not.toHaveBeenCalled();
    await coordinator.pollNow();
    expect(readCloud).not.toHaveBeenCalled();
    await expect(coordinator.updatePreferences(true)).rejects.toThrow(
      "unavailable",
    );
  });

  it("honors enabledAt, merges feeds, deduplicates, persists delivery, and routes clicks", async () => {
    const store = memoryStore();
    const old = localEvent("019fbb95-cd76-7920-93fa-e23ba755ea01", {
      createdAt: "2026-08-24T11:59:59.999Z",
    });
    const cloud = mentionEvent("019fbb95-cd76-7920-93fa-e23ba755ea02");
    const local = localEvent("019fbb95-cd76-7920-93fa-e23ba755ea03");
    const workflow = workflowEvents();
    const readCloud = vi.fn(async () => page([old, cloud, cloud, ...workflow]));
    const readLocal = vi.fn(async () => page([local]));
    const shown: Array<{
      title: string;
      body: string;
      onClick(): void;
    }> = [];
    const focus = vi.fn();
    const open = vi.fn();
    const coordinator = createCoordinator({
      store,
      show: (input) => shown.push(input),
      focus,
      open,
    });

    await coordinator.setSession(session(accountA, readCloud, readLocal));
    expect(await coordinator.updatePreferences(true)).toEqual({
      enabled: true,
      enabledAt,
      updatedAt: enabledAt,
    });
    await coordinator.pollNow();

    expect(shown).toHaveLength(5);
    expect(shown.map(({ title }) => title)).toEqual([
      "A. Researcher mentioned you",
      "Local export complete",
      "Transcription batch ready",
      "Transcription needs attention",
      "Export needs attention",
    ]);
    expect(JSON.stringify(shown)).not.toMatch(
      /comment body|transcript text|private|token|https?:|provider output/iu,
    );
    shown[0]!.onClick();
    expect(focus).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(cloud.navigation);

    await coordinator.pollNow();
    expect(shown).toHaveLength(5);
    expect(
      (await store.read(accountA)).delivered.map(({ id }) => id).sort(),
    ).toEqual([cloud.id, local.id, ...workflow.map(({ id }) => id)].sort());

    const afterRestart: typeof shown = [];
    const restarted = createCoordinator({
      store,
      show: (input) => afterRestart.push(input),
    });
    await restarted.setSession(session(accountA, readCloud, readLocal));
    await restarted.pollNow();
    expect(afterRestart).toEqual([]);

    await restarted.setSession(session(accountB, readCloud, readLocal));
    expect(await restarted.preferences()).toMatchObject({ enabled: false });
    await restarted.pollNow();
    expect(afterRestart).toEqual([]);
  });

  it("stops delivery on sign-out and never overlaps polls", async () => {
    const store = memoryStore({ [accountA]: enabledPreferences() });
    let release!: (value: NotificationFeedPage) => void;
    const pending = new Promise<NotificationFeedPage>((resolve) => {
      release = resolve;
    });
    const readCloud = vi.fn(() => pending);
    const readLocal = vi.fn(async () => page([]));
    const show = vi.fn();
    const coordinator = createCoordinator({ store, show });
    await coordinator.setSession(session(accountA, readCloud, readLocal));

    const first = coordinator.pollNow();
    const overlapping = coordinator.pollNow();
    await vi.waitFor(() => expect(readCloud).toHaveBeenCalledOnce());
    coordinator.stop();
    release(page([localEvent("019fbb95-cd76-7920-93fa-e23ba755ea04")]));
    await Promise.all([first, overlapping]);
    expect(show).not.toHaveBeenCalled();
  });

  it("backs off after failures, caps pagination, and refreshes same-account readers without timer churn", async () => {
    const store = memoryStore({ [accountA]: enabledPreferences() });
    const delays: number[] = [];
    const schedule = vi.fn((callback: () => void, delay?: number) => {
      void callback;
      delays.push(delay ?? 0);
      return delays.length as never;
    }) as unknown as typeof setTimeout;
    const cancel = vi.fn() as unknown as typeof clearTimeout;
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    const coordinator = createCoordinator({
      store,
      schedule,
      cancel,
      intervalMs: 10_000,
    });
    await coordinator.setSession(session(accountA, failing));
    expect(delays).toEqual([0]);
    const replacement = vi.fn(async (_cursor?: string) =>
      page([], "next-cursor-123"),
    );
    await coordinator.setSession(session(accountA, replacement, replacement));
    expect(delays).toEqual([0]);

    for (let index = 0; index < 6; index += 1) {
      await coordinator.setSession(session(accountA, failing));
      await coordinator.pollNow();
    }
    expect(delays.at(-1)).toBe(300_000);

    await coordinator.setSession(session(accountA, replacement, replacement));
    await coordinator.pollNow();
    expect(replacement).toHaveBeenCalledTimes(16);
  });

  it("retains the bounded delivered ledger across file-store restart", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "desktop-notification-store-"),
    );
    temporaryDirectories.add(directory);
    const store = new FileDesktopNotificationStore(directory);
    await store.writePreferences(accountA, enabledPreferences());
    for (let index = 0; index < 1_005; index += 1) {
      await store.markDelivered(
        accountA,
        `event-${index}`,
        new Date(Date.parse(enabledAt) + index).toISOString(),
      );
    }

    const reopened = new FileDesktopNotificationStore(directory);
    const account = await reopened.read(accountA);
    expect(account.preferences).toEqual(enabledPreferences());
    expect(account.delivered).toHaveLength(1_000);
    expect(account.delivered[0]?.id).toBe("event-1004");
    expect(account.delivered.at(-1)?.id).toBe("event-5");
    expect((await reopened.read(accountB)).preferences.enabled).toBe(false);
  });
});

function createCoordinator(options: {
  store: DesktopNotificationStore;
  supported?: boolean;
  show?: (input: { title: string; body: string; onClick(): void }) => void;
  focus?: () => void;
  open?: (target: NotificationEvent["navigation"]) => void;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
  intervalMs?: number;
}) {
  return new DesktopNotificationCoordinator(
    options.store,
    {
      supported: () => options.supported ?? true,
      show: options.show ?? vi.fn(),
    },
    {
      focus: options.focus ?? vi.fn(),
      open: options.open ?? vi.fn(),
    },
    () => new Date(enabledAt),
    options.schedule ??
      (vi.fn(() => 1 as never) as unknown as typeof setTimeout),
    options.cancel ?? (vi.fn() as unknown as typeof clearTimeout),
    options.intervalMs ?? 30_000,
  );
}

function memoryStore(
  initial: Record<string, DesktopNotificationPreferences> = {},
): DesktopNotificationStore {
  const accounts = new Map(
    Object.entries(initial).map(([scope, preferences]) => [
      scope,
      {
        preferences,
        delivered: [] as Array<{ id: string; deliveredAt: string }>,
      },
    ]),
  );
  return {
    async read(scope) {
      return (
        accounts.get(scope) ?? {
          preferences: {
            enabled: false,
            updatedAt: "1970-01-01T00:00:00.000Z",
          },
          delivered: [],
        }
      );
    },
    async writePreferences(scope, preferences) {
      const current = await this.read(scope);
      accounts.set(scope, { ...current, preferences });
    },
    async markDelivered(scope, id, deliveredAt) {
      const current = await this.read(scope);
      if (!current.delivered.some((entry) => entry.id === id)) {
        current.delivered.push({ id, deliveredAt });
      }
      accounts.set(scope, current);
    },
  };
}

function session(
  accountScope: string,
  readCloud: NotificationSession["readCloud"],
  readLocal: NotificationSession["readLocal"] = async () => page([]),
): NotificationSession {
  return { accountScope, readCloud, readLocal };
}

function page(
  events: NotificationEvent[],
  nextCursor?: string,
): NotificationFeedPage {
  return {
    events,
    ...(nextCursor ? { nextCursor } : {}),
    fetchedAt: "2026-08-24T12:05:00.000Z",
  };
}

function enabledPreferences(): DesktopNotificationPreferences {
  return { enabled: true, enabledAt, updatedAt: enabledAt };
}

function localEvent(
  id: string,
  overrides: Partial<NotificationEvent> = {},
): NotificationEvent {
  return {
    id,
    kind: "local_export_terminal",
    status: "completed",
    sourceLabel: "Safe local source https://private.invalid/path",
    navigation: {
      kind: "local_export",
      requestId: "019fbb95-cd76-7920-93fa-e23ba755ea11",
    },
    createdAt: "2026-08-24T12:02:00.000Z",
    ...overrides,
  } as NotificationEvent;
}

function mentionEvent(id: string): NotificationEvent {
  return {
    id,
    kind: "mention",
    status: "mentioned",
    actorLabel: "A. Researcher",
    projectLabel: "Documentary",
    clipLabel: "Opening quote",
    navigation: {
      kind: "mention",
      projectId: "019fbb95-cd76-7920-93fa-e23ba755ea21",
      clipId: "019fbb95-cd76-7920-93fa-e23ba755ea22",
      commentId: "019fbb95-cd76-7920-93fa-e23ba755ea23",
      sourceTimeMs: 1_234,
    },
    createdAt: "2026-08-24T12:01:00.000Z",
  };
}

function workflowEvents(): NotificationEvent[] {
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ea31";
  const batchId = "019fbb95-cd76-7920-93fa-e23ba755ea32";
  return [
    {
      id: "019fbb95-cd76-7920-93fa-e23ba755ea33",
      kind: "transcription_batch_terminal",
      status: "ready",
      projectLabel: "Documentary",
      batchLabel: "Morning batch",
      navigation: { kind: "transcription", projectId, batchId },
      createdAt: "2026-08-24T12:03:00.000Z",
    },
    {
      id: "019fbb95-cd76-7920-93fa-e23ba755ea34",
      kind: "transcription_action_needed",
      status: "failed",
      projectLabel: "Documentary",
      sourceLabel: "Interview source",
      batchLabel: "Morning batch",
      navigation: {
        kind: "transcription",
        projectId,
        batchId,
        videoId: "019fbb95-cd76-7920-93fa-e23ba755ea35",
      },
      createdAt: "2026-08-24T12:04:00.000Z",
    },
    {
      id: "019fbb95-cd76-7920-93fa-e23ba755ea36",
      kind: "logged_export_terminal",
      status: "action_needed",
      projectLabel: "Documentary",
      clipLabel: "Opening quote",
      navigation: {
        kind: "logged_export",
        projectId,
        clipId: "019fbb95-cd76-7920-93fa-e23ba755ea37",
        requestId: "019fbb95-cd76-7920-93fa-e23ba755ea38",
      },
      createdAt: "2026-08-24T12:05:00.000Z",
    },
  ];
}
