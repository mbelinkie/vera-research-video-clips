/**
 * Backup naming and retention for the off-laptop destination (#53).
 *
 * Policy (all in UTC): always keep the newest 3 backups; additionally keep the
 * newest backup of each of the last 14 days, each of the last 8 ISO weeks and
 * each of the last 12 months. Only files that match the exact backup name are
 * ever considered, so nothing else in the destination folder can be deleted.
 */
export const BACKUP_NAME = /^vera-research-(\d{8}T\d{6}Z)\.verabk$/u;

export type RetentionPolicy = {
  keepNewest: number;
  daily: number;
  weekly: number;
  monthly: number;
};
export const DEFAULT_RETENTION: RetentionPolicy = {
  keepNewest: 3,
  daily: 14,
  weekly: 8,
  monthly: 12,
};

export function backupName(at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
  return `vera-research-${stamp}.verabk`;
}

export function parseBackupName(name: string): Date | undefined {
  const match = BACKUP_NAME.exec(name);
  if (!match?.[1]) return undefined;
  const s = match[1];
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) || backupName(date) !== name
    ? undefined
    : date;
}

function isoWeek(date: Date): string {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${week}`;
}

/** Returns the backup file names to delete. Never returns a non-backup name. */
export function backupsToPrune(
  names: readonly string[],
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): string[] {
  const backups = names
    .map((name) => ({ name, at: parseBackupName(name) }))
    .filter((entry): entry is { name: string; at: Date } => Boolean(entry.at))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const keep = new Set(backups.slice(0, policy.keepNewest).map((b) => b.name));
  const buckets: Array<[number, number, (d: Date) => string]> = [
    [policy.daily, 86_400_000, (d) => d.toISOString().slice(0, 10)],
    [policy.weekly, 7 * 86_400_000, isoWeek],
    [policy.monthly, 31 * 86_400_000, (d) => d.toISOString().slice(0, 7)],
  ];
  for (const [count, span, bucketOf] of buckets) {
    const seen = new Set<string>();
    for (const backup of backups) {
      if (now.getTime() - backup.at.getTime() > count * span) continue;
      const bucket = bucketOf(backup.at);
      if (seen.has(bucket)) continue;
      seen.add(bucket); // newest first, so the first one seen is the newest
      keep.add(backup.name);
    }
  }
  return backups.filter((b) => !keep.has(b.name)).map((b) => b.name);
}
