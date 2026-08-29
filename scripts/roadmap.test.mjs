import assert from "node:assert/strict";
import test from "node:test";

import {
  assertClaimAvailable,
  latestClaim,
  parseArguments,
  validateRouting,
} from "./roadmap.mjs";

test("parses commands and flags", () => {
  const parsed = parseArguments(["claim", "12", "--model", "gpt-5.6-terra", "--effort", "high"]);
  assert.equal(parsed.command, "claim");
  assert.deepEqual(parsed.positionals, ["12"]);
  assert.equal(parsed.flags.get("effort"), "high");
});

test("accepts one exact routing profile", () => {
  assert.deepEqual(validateRouting(["model:terra", "effort:high"], "gpt-5.6-terra", "high"), {
    expectedModel: "terra",
    expectedEffort: "high",
  });
});

test("rejects missing routing labels", () => {
  assert.throws(() => validateRouting(["effort:high"], "gpt-5.6-terra", "high"), /exactly one/);
});

test("rejects duplicate routing labels", () => {
  assert.throws(() => validateRouting(["model:luna", "model:terra", "effort:high"], "gpt-5.6-terra", "high"), /exactly one/);
});

test("rejects Luna claiming Terra work", () => {
  assert.throws(() => validateRouting(["model:terra", "effort:high"], "gpt-5.6-luna", "high"), /Profile mismatch/);
});

test("rejects Sol claiming Luna work", () => {
  assert.throws(() => validateRouting(["model:luna", "effort:low"], "gpt-5.6-sol", "low"), /Profile mismatch/);
});

test("rejects unsupported effort labels", () => {
  assert.throws(() => validateRouting(["model:terra", "effort:ultra"], "gpt-5.6-terra", "ultra"), /unsupported/);
});

test("uses the latest claim marker", () => {
  const comments = [
    { body: '<!-- vera-claim {"state":"active","task":"one"} -->' },
    { body: '<!-- vera-claim {"state":"released","task":"one"} -->' },
  ];
  assert.equal(latestClaim(comments).state, "released");
  assert.doesNotThrow(() => assertClaimAvailable(comments));
  assert.throws(
    () =>
      assertClaimAvailable([
        { body: '<!-- vera-claim {"state":"active","task":"task-one"} -->' },
      ]),
    /already claimed by task-one/,
  );
});

test("preserves exclusive ownership across Luna-to-Terra and Terra-to-Sol escalation markers", () => {
  const comments = [
    { body: '<!-- vera-claim {"state":"active","model":"gpt-5.6-luna","task":"luna-task"} -->' },
    { body: 'Confirmed evidence: scope exceeded.\n<!-- vera-claim {"state":"released","model":"gpt-5.6-luna","task":"luna-task"} -->' },
    { body: '<!-- vera-claim {"state":"active","model":"gpt-5.6-terra","task":"terra-task"} -->' },
    { body: 'Confirmed evidence: architecture boundary found.\n<!-- vera-claim {"state":"released","model":"gpt-5.6-terra","task":"terra-task"} -->' },
    { body: '<!-- vera-claim {"state":"active","model":"gpt-5.6-sol","task":"sol-task"} -->' },
  ];

  assert.deepEqual(latestClaim(comments), {
    state: "active",
    model: "gpt-5.6-sol",
    task: "sol-task",
  });
  assert.throws(() => assertClaimAvailable(comments), /already claimed by sol-task/);
});
