import assert from "node:assert/strict";
import test from "node:test";
import {
  EXCLUDED,
  PENDING,
  VERIFIED,
  bugProblems,
  designChanges,
  ensureLabels,
  reconcileIssue,
} from "./issue-policy.mjs";

const design = "type:design";
const claude = "owner:claude";
const labels = (...names) => new Set(names);
const labeled = (name) => ({ action: "labeled", label: { name } });
const applied = (name) => ({ event: "labeled", label: { name } });
const reopened = { action: "reopened" };

test("open and later design classification enroll without replacing other labels", () => {
  assert.deepEqual(
    designChanges({ action: "opened" }, labels(design, "type:implementation")),
    { addPending: true },
  );
  assert.deepEqual(designChanges(labeled(claude), labels(claude)), {
    addPending: true,
  });
  assert.deepEqual(
    designChanges(labeled(design), labels("type:implementation")),
    {},
  );
  assert.deepEqual(designChanges(labeled(design), labels(design, PENDING)), {
    addPending: false,
  });
  assert.deepEqual(
    designChanges(labeled(design), labels(design, VERIFIED)),
    {},
  );
  assert.deepEqual(
    designChanges({ action: "opened" }, labels(design, EXCLUDED)),
    {},
  );
});

test("irrelevant events preserve design verification and ordinary close preserves pending", () => {
  for (const event of [
    { action: "edited" },
    { action: "closed" },
    labeled("type:bug"),
  ]) {
    assert.deepEqual(
      designChanges(event, labels(design, VERIFIED, PENDING), [
        applied(VERIFIED),
        applied(PENDING),
      ]),
      {},
    );
    assert.deepEqual(designChanges(event, labels(design, PENDING)), {});
  }
});

test("reopen and explicit revision use history and preserve later verification", () => {
  const verifiedDesign = labels(design, VERIFIED);
  assert.deepEqual(
    designChanges(reopened, verifiedDesign, [
      applied(VERIFIED),
      { event: "reopened" },
    ]),
    {
      addPending: true,
      removeVerified: true,
    },
  );
  assert.deepEqual(
    designChanges(reopened, verifiedDesign, [
      { event: "reopened" },
      applied(VERIFIED),
    ]),
    {},
  );
  const mixedDesign = labels("type:implementation", PENDING, VERIFIED);
  assert.deepEqual(
    designChanges(labeled(PENDING), mixedDesign, [
      applied(VERIFIED),
      applied(PENDING),
    ]),
    {
      addPending: false,
      removeVerified: true,
    },
  );
  assert.deepEqual(
    designChanges(labeled(PENDING), mixedDesign, [
      applied(PENDING),
      applied(VERIFIED),
    ]),
    {},
  );
  assert.deepEqual(
    designChanges(labeled(PENDING), verifiedDesign, [
      applied(VERIFIED),
      applied(PENDING),
    ]),
    {},
  );
  const automatedPending = {
    ...applied(PENDING),
    actor: { login: "github-actions[bot]" },
  };
  assert.deepEqual(
    designChanges(labeled(PENDING), mixedDesign, [
      applied(VERIFIED),
      automatedPending,
    ]),
    {},
  );
  assert.deepEqual(
    designChanges(reopened, labels(design, EXCLUDED, VERIFIED), [
      applied(VERIFIED),
      { event: "reopened" },
    ]),
    {},
  );
});

function fakeGitHub(initialLabels = []) {
  const repository = "repos/example/vera";
  const endpoint = `${repository}/issues/7`;
  const catalog = new Map([
    [design, { name: design, description: "existing description" }],
  ]);
  const current = labels(...initialLabels);
  const history = [];
  const writes = [];
  const comments = new Map();
  const state = { body: "" };
  let nextId = 10;
  function api(method, path, body) {
    if (method === "GET") {
      if (path === endpoint) {
        return {
          labels: [...current].map((name) => ({ name })),
          comments: comments.size,
          body: state.body,
        };
      }
      if (path === `${endpoint}/comments`) return [...comments.values()];
      if (path === `${endpoint}/events`) return [...history];
      if (path === `${repository}/labels`) return [...catalog.values()];
    }
    writes.push({ method, path, body });
    if (path === `${repository}/labels`) catalog.set(body.name, body);
    else if (path === `${endpoint}/labels`) {
      for (const name of body.labels) current.add(name);
    } else if (path === `${endpoint}/labels/${encodeURIComponent(VERIFIED)}`)
      current.delete(VERIFIED);
    else if (path === `${endpoint}/comments` && method === "POST") {
      const id = nextId++;
      comments.set(id, {
        id,
        user: { login: "github-actions[bot]" },
        body: body.body,
      });
    } else if (path.startsWith(`${repository}/issues/comments/`)) {
      const id = Number(path.split("/").at(-1));
      if (method === "DELETE") comments.delete(id);
      else if (method === "PATCH") comments.get(id).body = body.body;
      else assert.fail(`Unexpected ${method} ${path}`);
    } else assert.fail(`Unexpected ${method} ${path}`);
  }
  return {
    api,
    repository,
    current,
    catalog,
    history,
    writes,
    comments,
    state,
  };
}

test("label setup only creates missing labels and keeps existing descriptions", () => {
  const { api, repository, writes, catalog } = fakeGitHub();
  ensureLabels(api, repository);
  assert.equal(writes.length, 12);
  ensureLabels(api, repository);
  assert.equal(writes.length, 12);
  assert.equal(catalog.get(design).description, "existing description");
});

test("duplicate reopen adds pending once and removes only stale verification", () => {
  const { api, repository, current, history, writes } = fakeGitHub([
    claude,
    VERIFIED,
    "model:sol",
  ]);
  history.push(applied(VERIFIED), { event: "reopened" });
  const event = { ...reopened, issue: { number: 7, labels: [] } };
  reconcileIssue(api, repository, event);
  const writeCount = writes.length;
  assert.deepEqual(current, labels(claude, "model:sol", PENDING));
  reconcileIssue(api, repository, event);
  assert.equal(writes.length, writeCount);
  current.delete(PENDING);
  current.add(VERIFIED);
  history.push(applied(VERIFIED));
  reconcileIssue(api, repository, event);
  assert.equal(writes.length, writeCount);
  assert.deepEqual(current, labels(claude, "model:sol", VERIFIED));
});

const auditBody = "### Issue origin\n\naudit\n\n### Evidence";
const completeBug = ["type:bug", "severity:medium", "priority:P2"];

test("bug classification uses exact labels and structured origin", () => {
  assert.deepEqual(bugProblems(labels(...completeBug, "bug"), "", "P2"), []);
  assert.deepEqual(
    bugProblems(labels(...completeBug, "source:audit"), auditBody),
    [],
  );
  assert.deepEqual(
    bugProblems(
      labels(...completeBug),
      "Notes mention audit, urgent, P0 and high.",
    ),
    [],
  );
  assert.deepEqual(
    bugProblems(labels(...completeBug), "Notes\n\n" + auditBody),
    [],
  );
  assert.deepEqual(bugProblems(labels("type:investigation"), auditBody), []);
  assert.match(
    bugProblems(labels(...completeBug), auditBody).join(),
    /source:audit/,
  );
  assert.match(
    bugProblems(labels(...completeBug), "", "P0").join(),
    /Project Priority/,
  );
  assert.equal(bugProblems(labels("bug"), "").length, 3);
  assert.equal(
    bugProblems(labels(...completeBug, "severity:high", "priority:P0"), "")
      .length,
    2,
  );
  assert.equal(
    bugProblems(labels("type:bug", "severity:critical", "priority:P9"), "")
      .length,
    2,
  );
});

test("mixed design bugs enroll and reconcile one exact warning against current metadata", () => {
  const { api, repository, current, writes, comments, state } = fakeGitHub([
    design,
    "bug",
  ]);
  const event = (action, label) => ({
    action,
    issue: { number: 7, labels: [] },
    label: { name: label },
  });
  reconcileIssue(api, repository, event("opened"));
  assert.deepEqual(current, labels(design, "bug", PENDING));
  const original = [...comments.values()][0];
  assert.match(original.body, /type:bug[\s\S]+severity:high[\s\S]+priority:P0/);
  const firstWarning = original.body;
  const writesAfterOpen = writes.length;
  reconcileIssue(api, repository, event("opened"));
  assert.equal(writes.length, writesAfterOpen);

  comments.set(2, { id: 2, user: { login: "producer" }, body: firstWarning });
  comments.set(3, { ...original, id: 3 });
  for (const label of completeBug) current.add(label);
  state.body = auditBody;
  reconcileIssue(api, repository, event("edited"));
  assert.equal(comments.size, 2);
  assert.equal(comments.get(2).body, firstWarning);
  assert.equal(
    comments.get(original.id).body,
    [
      "<!-- vera-issue-policy:bug-classification -->",
      "**Bug classification needs attention**",
      "",
      "- Add `source:audit` for the recorded audit origin.",
    ].join("\n"),
  );

  current.add("source:audit");
  reconcileIssue(api, repository, event("labeled", "source:audit"));
  assert.deepEqual([...comments.keys()], [2]);

  current.delete("priority:P2");
  reconcileIssue(api, repository, event("unlabeled", "priority:P2"));
  assert.equal(comments.size, 2);
  current.add("priority:P2");
  reconcileIssue(api, repository, event("unlabeled", "priority:P2"));
  assert.deepEqual([...comments.keys()], [2]);
  assert.deepEqual(
    current,
    labels(design, PENDING, "bug", ...completeBug, "source:audit"),
  );
});

test("ordinary issues stay untouched and losing both bug labels clears the warning", () => {
  const { api, repository, current, writes, comments } = fakeGitHub([
    "type:implementation",
  ]);
  const event = { action: "edited", issue: { number: 7 } };
  reconcileIssue(api, repository, event);
  assert.deepEqual(writes, []);
  current.add("type:bug");
  reconcileIssue(api, repository, event);
  assert.equal(comments.size, 1);
  current.delete("type:bug");
  reconcileIssue(api, repository, event);
  assert.equal(comments.size, 0);
});
