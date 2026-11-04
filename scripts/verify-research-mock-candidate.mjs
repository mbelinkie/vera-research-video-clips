import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const candidate = JSON.parse(
  readFileSync(
    new URL("../tests/fixtures/deepseek/mock-candidate.json", import.meta.url),
    "utf8",
  ),
);

assert.deepEqual(candidate, {
  fixture: "vera-research-synthetic-candidate",
  status: "mock-verified",
});

console.log("Synthetic Research candidate matches the frozen mock output.");
