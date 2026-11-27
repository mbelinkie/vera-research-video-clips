import { lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";

import { PGlite } from "@electric-sql/pglite";

import { auditTranscriptRecovery } from "../apps/cloud-api/src/transcript-recovery-plan.ts";

try {
  const { values } = parseArgs({
    options: {
      "scratch-catalog": { type: "string" },
      retained: { type: "string" },
      destination: { type: "string" },
    },
  });
  const scratch = values["scratch-catalog"];
  if (
    !scratch ||
    !isAbsolute(scratch) ||
    !(await lstat(scratch)).isDirectory() ||
    !(await lstat(join(scratch, "PG_VERSION"))).isFile()
  ) {
    throw new Error("Existing disposable catalog copy required.");
  }
  const db = new PGlite(scratch);
  try {
    const report = await db.transaction(async (tx) => {
      await tx.exec("SET TRANSACTION READ ONLY");
      return auditTranscriptRecovery(tx, values);
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.close();
  }
} catch {
  console.error(
    "Audit failed. Supply an existing disposable PGlite copy and valid offline inventories.",
  );
  process.exitCode = 1;
}
