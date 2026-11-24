import assert from "node:assert/strict";
import test from "node:test";
import { EXCLUDED, PENDING, VERIFIED, designChanges, ensureLabels, reconcileIssue } from "./issue-policy.mjs";

const design = "type:design";
const claude = "owner:claude";
const labels = (...names) => new Set(names);
const labeled = (name) => ({ action: "labeled", label: { name } });
const applied = (name) => ({ event: "labeled", label: { name } });
const reopened = { action: "reopened" };

test("open and later design classification enroll without replacing other labels", () => {
  assert.deepEqual(designChanges({ action: "opened" }, labels(design, "type:implementation")), { addPending: true });
  assert.deepEqual(designChanges(labeled(claude), labels(claude)), { addPending: true });
  assert.deepEqual(designChanges(labeled(design), labels("type:implementation")), {});
  assert.deepEqual(designChanges(labeled(design), labels(design, PENDING)), { addPending: false });
  assert.deepEqual(designChanges(labeled(design), labels(design, VERIFIED)), {});
  assert.deepEqual(designChanges({ action: "opened" }, labels(design, EXCLUDED)), {});
});

test("irrelevant events preserve design verification and ordinary close preserves pending", () => {
  for (const event of [{ action: "edited" }, { action: "closed" }, labeled("type:bug")]) {
    assert.deepEqual(designChanges(event, labels(design, VERIFIED, PENDING), [applied(VERIFIED), applied(PENDING)]), {});
    assert.deepEqual(designChanges(event, labels(design, PENDING)), {});
  }
});

test("reopen and explicit revision use history and preserve later verification", () => {
  const verifiedDesign = labels(design, VERIFIED);
  assert.deepEqual(designChanges(reopened, verifiedDesign, [applied(VERIFIED), { event: "reopened" }]), {
    addPending: true,
    removeVerified: true,
  });
  assert.deepEqual(designChanges(reopened, verifiedDesign, [{ event: "reopened" }, applied(VERIFIED)]), {});
  const mixedDesign = labels("type:implementation", PENDING, VERIFIED);
  assert.deepEqual(designChanges(labeled(PENDING), mixedDesign, [applied(VERIFIED), applied(PENDING)]), {
    addPending: false,
    removeVerified: true,
  });
  assert.deepEqual(designChanges(labeled(PENDING), mixedDesign, [applied(PENDING), applied(VERIFIED)]), {});
  assert.deepEqual(designChanges(labeled(PENDING), verifiedDesign, [applied(VERIFIED), applied(PENDING)]), {});
  assert.deepEqual(designChanges(reopened, labels(design, EXCLUDED, VERIFIED), [applied(VERIFIED), { event: "reopened" }]), {});
});

function fakeGitHub(initialLabels = []) {
  const repository = "repos/example/vera";
  const endpoint = `${repository}/issues/7`;
  const catalog = new Map([[design, { name: design, description: "existing description" }]]);
  const current = labels(...initialLabels);
  const history = [];
  const writes = [];
  function api(method, path, body) {
    if (method === "GET") {
      if (path === endpoint) return { labels: [...current].map((name) => ({ name })) };
      if (path === `${endpoint}/events`) return [...history];
      if (path === `${repository}/labels`) return [...catalog.values()];
    }
    writes.push({ method, path, body });
    if (path === `${repository}/labels`) catalog.set(body.name, body);
    else if (path === `${endpoint}/labels`) {
      for (const name of body.labels) current.add(name);
    } else if (path === `${endpoint}/labels/${encodeURIComponent(VERIFIED)}`) current.delete(VERIFIED);
    else assert.fail(`Unexpected ${method} ${path}`);
  }
  return { api, repository, current, catalog, history, writes };
}

test("label setup only creates missing labels and keeps existing descriptions", () => {
  const { api, repository, writes, catalog } = fakeGitHub();
  ensureLabels(api, repository);
  assert.equal(writes.length, 3);
  ensureLabels(api, repository);
  assert.equal(writes.length, 3);
  assert.equal(catalog.get(design).description, "existing description");
});

test("duplicate reopen adds pending once and removes only stale verification", () => {
  const { api, repository, current, history, writes } = fakeGitHub([claude, VERIFIED, "model:sol"]);
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
