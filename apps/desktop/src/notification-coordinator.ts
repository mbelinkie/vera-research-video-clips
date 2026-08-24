import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DesktopNotificationPreferencesSchema,
  DesktopNotificationSupportStatusSchema,
  NotificationFeedPageSchema,
  sanitizeNotificationLabel,
  type DesktopNotificationNavigationTarget,
  type DesktopNotificationPreferences,
  type DesktopNotificationSupportStatus,
  type NotificationEvent,
  type NotificationFeedPage,
} from "@research-video/contracts";

const MAX_DELIVERED_EVENTS = 1_000;
const MAX_PAGES_PER_POLL = 8;

type StoredAccount = {
  preferences: DesktopNotificationPreferences;
  delivered: Array<{ id: string; deliveredAt: string }>;
};
type StoredState = { version: 1; accounts: Record<string, StoredAccount> };

export interface DesktopNotificationStore {
  read(accountScope: string): Promise<StoredAccount>;
  writePreferences(
    accountScope: string,
    preferences: DesktopNotificationPreferences,
  ): Promise<void>;
  markDelivered(
    accountScope: string,
    eventId: string,
    deliveredAt: string,
  ): Promise<void>;
}

export class FileDesktopNotificationStore implements DesktopNotificationStore {
  private readonly path: string;
  private writes: Promise<void> = Promise.resolve();

  constructor(userData: string) {
    this.path = join(userData, "desktop-notifications.json");
  }

  async read(accountScope: string): Promise<StoredAccount> {
    const state = await this.readState();
    return (
      state.accounts[accountScope] ?? {
        preferences: defaultPreferences(),
        delivered: [],
      }
    );
  }

  async writePreferences(
    accountScope: string,
    preferences: DesktopNotificationPreferences,
  ): Promise<void> {
    await this.mutate((state) => {
      const current = state.accounts[accountScope];
      state.accounts[accountScope] = {
        preferences: DesktopNotificationPreferencesSchema.parse(preferences),
        delivered: current?.delivered ?? [],
      };
    });
  }

  async markDelivered(
    accountScope: string,
    eventId: string,
    deliveredAt: string,
  ): Promise<void> {
    await this.mutate((state) => {
      const account = state.accounts[accountScope] ?? {
        preferences: defaultPreferences(),
        delivered: [],
      };
      if (!account.delivered.some((entry) => entry.id === eventId)) {
        account.delivered.push({ id: eventId, deliveredAt });
        account.delivered = account.delivered
          .sort((left, right) =>
            right.deliveredAt.localeCompare(left.deliveredAt),
          )
          .slice(0, MAX_DELIVERED_EVENTS);
      }
      state.accounts[accountScope] = account;
    });
  }

  private async mutate(update: (state: StoredState) => void): Promise<void> {
    const operation = this.writes.then(async () => {
      const state = await this.readState();
      update(state);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(state), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.path);
    });
    this.writes = operation.catch(() => undefined);
    await operation;
  }

  private async readState(): Promise<StoredState> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as {
        version?: unknown;
        accounts?: unknown;
      };
      if (parsed.version !== 1 || !isRecord(parsed.accounts)) {
        return emptyState();
      }
      const accounts: Record<string, StoredAccount> = {};
      for (const [scope, value] of Object.entries(parsed.accounts)) {
        if (!/^[a-f0-9]{64}$/u.test(scope) || !isRecord(value)) continue;
        const preferences = DesktopNotificationPreferencesSchema.safeParse(
          value.preferences,
        );
        const delivered = Array.isArray(value.delivered)
          ? value.delivered
              .filter(
                (entry): entry is { id: string; deliveredAt: string } =>
                  isRecord(entry) &&
                  typeof entry.id === "string" &&
                  typeof entry.deliveredAt === "string" &&
                  Number.isFinite(Date.parse(entry.deliveredAt)),
              )
              .slice(0, MAX_DELIVERED_EVENTS)
          : [];
        if (preferences.success) {
          accounts[scope] = { preferences: preferences.data, delivered };
        }
      }
      return { version: 1, accounts };
    } catch {
      return emptyState();
    }
  }
}

export type NotificationSession = {
  accountScope: string;
  readCloud(
    cursor: string | undefined,
    since: string,
  ): Promise<NotificationFeedPage>;
  readLocal(
    cursor: string | undefined,
    since: string,
  ): Promise<NotificationFeedPage>;
};

export class DesktopNotificationCoordinator {
  private session: NotificationSession | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  private failureCount = 0;

  constructor(
    private readonly store: DesktopNotificationStore,
    private readonly native: {
      supported(): boolean;
      show(input: { title: string; body: string; onClick(): void }): void;
    },
    private readonly navigation: {
      focus(): void;
      open(target: DesktopNotificationNavigationTarget): void;
    },
    private readonly clock: () => Date = () => new Date(),
    private readonly schedule: typeof setTimeout = setTimeout,
    private readonly cancel: typeof clearTimeout = clearTimeout,
    private readonly intervalMs = 30_000,
  ) {}

  supportStatus(): DesktopNotificationSupportStatus {
    return DesktopNotificationSupportStatusSchema.parse(
      this.native.supported()
        ? { available: true, reason: "available" }
        : { available: false, reason: "unsupported_platform" },
    );
  }

  async setSession(session: NotificationSession | undefined): Promise<void> {
    if (session && this.session?.accountScope === session.accountScope) {
      this.session = session;
      if (this.timer !== undefined || this.polling) return;
      const account = await this.store.read(session.accountScope);
      if (account.preferences.enabled && this.native.supported()) {
        this.queue(0);
      }
      return;
    }
    this.stop();
    this.session = session;
    if (!session) return;
    const account = await this.store.read(session.accountScope);
    if (account.preferences.enabled && this.native.supported()) {
      this.queue(0);
    }
  }

  async preferences(): Promise<DesktopNotificationPreferences> {
    const session = this.requireSession();
    return (await this.store.read(session.accountScope)).preferences;
  }

  async updatePreferences(
    enabled: boolean,
  ): Promise<DesktopNotificationPreferences> {
    const session = this.requireSession();
    if (enabled && !this.native.supported()) {
      throw new Error("Native notifications are unavailable on this device.");
    }
    const now = this.clock().toISOString();
    const preferences = DesktopNotificationPreferencesSchema.parse({
      enabled,
      ...(enabled ? { enabledAt: now } : {}),
      updatedAt: now,
    });
    await this.store.writePreferences(session.accountScope, preferences);
    this.stopTimer();
    if (enabled) this.queue(0);
    return preferences;
  }

  async pollNow(): Promise<void> {
    const session = this.session;
    if (!session || this.polling || !this.native.supported()) return;
    this.polling = true;
    let shouldContinue = true;
    try {
      const account = await this.store.read(session.accountScope);
      const enabledAt = account.preferences.enabledAt;
      if (!account.preferences.enabled || !enabledAt) {
        shouldContinue = false;
        return;
      }
      const delivered = new Set(account.delivered.map((entry) => entry.id));
      const [cloud, local] = await Promise.all([
        readPages(session.readCloud, enabledAt),
        readPages(session.readLocal, enabledAt),
      ]);
      const events = [...cloud, ...local].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      );
      for (const event of events) {
        if (
          event.createdAt < enabledAt ||
          delivered.has(event.id) ||
          this.session?.accountScope !== session.accountScope
        ) {
          continue;
        }
        const presentation = notificationPresentation(event);
        this.native.show({
          ...presentation,
          onClick: () => {
            this.navigation.focus();
            this.navigation.open(event.navigation);
          },
        });
        await this.store.markDelivered(
          session.accountScope,
          event.id,
          this.clock().toISOString(),
        );
        delivered.add(event.id);
      }
      this.failureCount = 0;
    } catch {
      this.failureCount = Math.min(this.failureCount + 1, 5);
    } finally {
      this.polling = false;
      if (
        shouldContinue &&
        this.session?.accountScope === session.accountScope
      ) {
        this.queue(
          Math.min(this.intervalMs * 2 ** this.failureCount, 5 * 60_000),
        );
      }
    }
  }

  stop(): void {
    this.stopTimer();
    this.session = undefined;
    this.failureCount = 0;
  }

  private queue(delay: number): void {
    this.stopTimer();
    this.timer = this.schedule(() => void this.pollNow(), delay);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
  }

  private requireSession(): NotificationSession {
    if (!this.session)
      throw new Error("Sign in to manage desktop notifications.");
    return this.session;
  }
}

async function readPages(
  read: (
    cursor: string | undefined,
    since: string,
  ) => Promise<NotificationFeedPage>,
  since: string,
): Promise<NotificationEvent[]> {
  const events: NotificationEvent[] = [];
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_POLL; pageIndex += 1) {
    const page = NotificationFeedPageSchema.parse(await read(cursor, since));
    events.push(...page.events);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return events;
}

function notificationPresentation(event: NotificationEvent) {
  switch (event.kind) {
    case "transcription_batch_terminal":
      return {
        title:
          event.status === "ready"
            ? "Transcription batch ready"
            : "Transcription needs attention",
        body: `${safeLabel(event.projectLabel, "Project")} · ${safeLabel(event.batchLabel)}`,
      };
    case "transcription_action_needed":
      return {
        title: "Transcription needs attention",
        body: `${safeLabel(event.projectLabel, "Project")} · ${safeLabel(event.sourceLabel ?? event.batchLabel)}`,
      };
    case "logged_export_terminal":
      return {
        title:
          event.status === "completed"
            ? "Export complete"
            : "Export needs attention",
        body: `${safeLabel(event.projectLabel, "Project")} · ${safeLabel(event.clipLabel ?? event.sourceLabel, "Clip")}`,
      };
    case "local_export_terminal":
      return {
        title:
          event.status === "completed"
            ? "Local export complete"
            : "Local export needs attention",
        body: safeLabel(event.sourceLabel, "Local export"),
      };
    case "mention":
      return {
        title: `${safeLabel(event.actorLabel)} mentioned you`,
        body: `${safeLabel(event.projectLabel, "Project")} · ${safeLabel(event.clipLabel ?? event.sourceLabel, "Clip")}`,
      };
  }
}

function safeLabel(value: unknown, fallback = "Untitled"): string {
  const sanitized = sanitizeNotificationLabel(value);
  return sanitized === "Untitled" ? fallback : sanitized;
}

function defaultPreferences(): DesktopNotificationPreferences {
  return DesktopNotificationPreferencesSchema.parse({
    enabled: false,
    updatedAt: new Date(0).toISOString(),
  });
}

function emptyState(): StoredState {
  return { version: 1, accounts: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
