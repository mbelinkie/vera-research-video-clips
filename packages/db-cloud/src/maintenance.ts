import { lstat } from "node:fs/promises";
import { join } from "node:path";

export const pilotBackupGatePath = (objectRoot: string) =>
  join(objectRoot, ".vera-backup-writes-blocked");

export async function pilotBackupGateIsActive(
  objectRoot: string,
): Promise<boolean> {
  try {
    await lstat(pilotBackupGatePath(objectRoot));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    // An unreadable gate is not safe evidence that writes may proceed.
    throw error;
  }
}
