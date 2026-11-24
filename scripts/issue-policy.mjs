import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PENDING = "design:prod-pending";
export const VERIFIED = "design:prod-verified";
export const EXCLUDED = "design:prod-excluded";

const designClassifiers = ["type:design", "owner:claude"];
const policyLabels = [
  ["type:design", "5319e7", "Product design story"],
  [PENDING, "fbca04", "Shipped product design verification pending"],
  [VERIFIED, "0e8a16", "Retained design scope verified in the shipped product"],
  [EXCLUDED, "c5def5", "Design verification exemption or retirement recorded on the issue"],
];

export function isDesignEvent(event) {
  return (
    event.action === "opened" ||
    event.action === "reopened" ||
    (event.action === "labeled" && [...designClassifiers, PENDING].includes(event.label?.name))
  );
}

export function designChanges(event, labels, history = []) {
  if (!isDesignEvent(event) || labels.has(EXCLUDED)) return {};
  if (![...designClassifiers, PENDING, VERIFIED].some((label) => labels.has(label))) return {};

  if (!labels.has(VERIFIED)) return { addPending: !labels.has(PENDING) };

  const revisionSignal = event.action === "labeled" && event.label?.name === PENDING && labels.has(PENDING);
  if (event.action !== "reopened" && !revisionSignal) return {};

  // GitHub's event order distinguishes a revision from a later verification, even in the same second.
  const verifiedAt = history.findLastIndex(({ event, label }) => event === "labeled" && label?.name === VERIFIED);
  const invalidatedAt = history.findLastIndex(({ event, label }) =>
    revisionSignal ? event === "labeled" && label?.name === PENDING : event === "reopened",
  );
  if (verifiedAt === -1 || invalidatedAt <= verifiedAt) return {};
  return { addPending: !labels.has(PENDING), removeVerified: true };
}

function gh(method, endpoint, payload, paginate = false) {
  const args = ["api", "--method", method, endpoint];
  if (paginate) args.push("--paginate", "--slurp");
  if (payload) args.push("--input", "-");
  const response = execFileSync("gh", args, {
    encoding: "utf8",
    input: payload && JSON.stringify(payload),
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!response) return;
  const result = JSON.parse(response);
  return paginate ? result.flat() : result;
}

export function ensureLabels(api, repoPath) {
  const endpoint = `${repoPath}/labels`;
  const existing = new Set(api("GET", endpoint, undefined, true).map(({ name }) => name));
  for (const [name, color, description] of policyLabels) {
    if (existing.has(name)) continue;
    try {
      api("POST", endpoint, { name, color, description });
    } catch (error) {
      // The setup run and issue runs can create the same label concurrently.
      if (!api("GET", endpoint, undefined, true).some((label) => label.name === name)) throw error;
    }
  }
}

export function reconcileIssue(api, repoPath, event) {
  if (!isDesignEvent(event)) return;
  const number = event.issue?.number;
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("Expected a GitHub issue number");
  const endpoint = `${repoPath}/issues/${number}`;
  const issue = api("GET", endpoint);
  if (issue.pull_request) return;
  const labels = new Set(issue.labels.map(({ name }) => name));

  let changes = designChanges(event, labels);
  if (
    labels.has(VERIFIED) &&
    !labels.has(EXCLUDED) &&
    (event.action === "reopened" || (event.label?.name === PENDING && labels.has(PENDING)))
  ) {
    changes = designChanges(event, labels, api("GET", `${endpoint}/events`, undefined, true));
  }
  if (changes.addPending) {
    ensureLabels(api, repoPath);
    api("POST", `${endpoint}/labels`, { labels: [PENDING] });
  }
  if (changes.removeVerified) api("DELETE", `${endpoint}/labels/${encodeURIComponent(VERIFIED)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH } = process.env;
  if (!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY ?? "")) throw new Error("Expected a GitHub repository");
  const repoPath = `repos/${GITHUB_REPOSITORY}`;
  if (GITHUB_EVENT_NAME === "push") ensureLabels(gh, repoPath);
  if (GITHUB_EVENT_NAME === "issues") {
    reconcileIssue(gh, repoPath, JSON.parse(readFileSync(GITHUB_EVENT_PATH, "utf8")));
  }
}
