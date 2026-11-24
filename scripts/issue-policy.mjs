import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PENDING = "design:prod-pending";
export const VERIFIED = "design:prod-verified";
export const EXCLUDED = "design:prod-excluded";

const designClassifiers = ["type:design", "owner:claude"];
const severities = ["severity:high", "severity:medium", "severity:low"];
const priorities = ["priority:P0", "priority:P1", "priority:P2", "priority:P3"];
const warningMarker = "<!-- vera-issue-policy:bug-classification -->";
const policyLabels = [
  ["type:design", "5319e7", "Product design story"],
  [PENDING, "fbca04", "Shipped product design verification pending"],
  [VERIFIED, "0e8a16", "Retained design scope verified in the shipped product"],
  [
    EXCLUDED,
    "c5def5",
    "Design verification exemption or retirement recorded on the issue",
  ],
  ["type:bug", "d73a4a", "Confirmed product defect"],
  ["source:audit", "5319e7", "Defect confirmed from a recorded audit finding"],
  [
    severities[0],
    "b60205",
    "Serious data-integrity or essential-workflow failure",
  ],
  [severities[1], "fbca04", "Material bounded impact or a workaround exists"],
  [severities[2], "fef2c0", "Minor product impact"],
  [priorities[0], "b60205", "Remediate immediately"],
  [priorities[1], "d93f0b", "Remediate before the affected release"],
  [priorities[2], "fbca04", "Planned remediation"],
  [priorities[3], "e4e669", "Low urgency"],
];

export function isDesignEvent(event) {
  return (
    event.action === "opened" ||
    event.action === "reopened" ||
    (event.action === "labeled" &&
      [...designClassifiers, PENDING].includes(event.label?.name))
  );
}

export function designChanges(event, labels, history = []) {
  if (!isDesignEvent(event) || labels.has(EXCLUDED)) return {};
  if (
    ![...designClassifiers, PENDING, VERIFIED].some((label) =>
      labels.has(label),
    )
  )
    return {};

  if (!labels.has(VERIFIED)) return { addPending: !labels.has(PENDING) };

  const revisionSignal =
    event.action === "labeled" &&
    event.label?.name === PENDING &&
    labels.has(PENDING);
  if (event.action !== "reopened" && !revisionSignal) return {};

  // GitHub's event order distinguishes a revision from a later verification, even in the same second.
  const verifiedAt = history.findLastIndex(
    ({ event, label }) => event === "labeled" && label?.name === VERIFIED,
  );
  const invalidatedAt = history.findLastIndex(({ event, label, actor }) =>
    revisionSignal
      ? event === "labeled" &&
        label?.name === PENDING &&
        actor?.login !== "github-actions[bot]"
      : event === "reopened",
  );
  if (verifiedAt === -1 || invalidatedAt <= verifiedAt) return {};
  return { addPending: !labels.has(PENDING), removeVerified: true };
}

export function bugProblems(labels, body, projectPriority = null) {
  if (!labels.has("type:bug") && !labels.has("bug")) return [];

  const problems = [];
  if (!labels.has("type:bug"))
    problems.push("Add the canonical `type:bug` label.");
  const severity = [...labels].filter((label) => label.startsWith("severity:"));
  if (severity.length !== 1 || !severities.includes(severity[0])) {
    problems.push(
      "Set exactly one of `severity:high`, `severity:medium`, or `severity:low`.",
    );
  }
  const priority = [...labels].filter((label) => label.startsWith("priority:"));
  if (priority.length !== 1 || !priorities.includes(priority[0])) {
    problems.push(
      "Set exactly one of `priority:P0`, `priority:P1`, `priority:P2`, or `priority:P3`.",
    );
  } else if (projectPriority && priority[0] !== `priority:${projectPriority}`) {
    problems.push("Match the priority label to the Project Priority field.");
  }
  const auditOrigin =
    /^### Issue origin[ \t]*\r?\n(?:[ \t]*\r?\n)*audit[ \t]*(?:\r?\n|$)/.test(
      (body ?? "").trimStart(),
    );
  if (auditOrigin && !labels.has("source:audit")) {
    problems.push("Add `source:audit` for the recorded audit origin.");
  }
  return problems;
}

function reconcileWarning(api, endpoint, problems) {
  const comments = api("GET", `${endpoint}/comments`, undefined, true).filter(
    ({ user, body }) =>
      user?.login === "github-actions[bot]" &&
      body?.startsWith(`${warningMarker}\n`),
  );
  const warning = problems.length
    ? `${warningMarker}\n**Bug classification needs attention**\n\n${problems.map((problem) => `- ${problem}`).join("\n")}`
    : null;

  const [existing, ...duplicates] = comments;
  const commentPath = (id) =>
    `${endpoint.replace(/\/\d+$/, "")}/comments/${id}`;
  if (warning && !existing)
    api("POST", `${endpoint}/comments`, { body: warning });
  if (warning && existing && existing.body !== warning)
    api("PATCH", commentPath(existing.id), { body: warning });
  for (const { id } of warning ? duplicates : comments)
    api("DELETE", commentPath(id));
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
  const existing = new Set(
    api("GET", endpoint, undefined, true).map(({ name }) => name),
  );
  for (const [name, color, description] of policyLabels) {
    if (existing.has(name)) continue;
    try {
      api("POST", endpoint, { name, color, description });
    } catch (error) {
      // The setup run and issue runs can create the same label concurrently.
      if (
        !api("GET", endpoint, undefined, true).some(
          (label) => label.name === name,
        )
      )
        throw error;
    }
  }
}

export function reconcileIssue(api, repoPath, event) {
  const number = event.issue?.number;
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error("Expected a GitHub issue number");
  const endpoint = `${repoPath}/issues/${number}`;
  const issue = api("GET", endpoint);
  if (issue.pull_request) return;
  const labels = new Set(issue.labels.map(({ name }) => name));

  let changes = designChanges(event, labels);
  if (
    labels.has(VERIFIED) &&
    !labels.has(EXCLUDED) &&
    (event.action === "reopened" ||
      (event.label?.name === PENDING && labels.has(PENDING)))
  ) {
    changes = designChanges(
      event,
      labels,
      api("GET", `${endpoint}/events`, undefined, true),
    );
  }
  if (changes.addPending) {
    ensureLabels(api, repoPath);
    api("POST", `${endpoint}/labels`, { labels: [PENDING] });
  }
  if (changes.removeVerified)
    api("DELETE", `${endpoint}/labels/${encodeURIComponent(VERIFIED)}`);

  const problems = bugProblems(labels, issue.body);
  if (problems.length || issue.comments > 0)
    reconcileWarning(api, endpoint, problems);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH } =
    process.env;
  if (!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY ?? ""))
    throw new Error("Expected a GitHub repository");
  const repoPath = `repos/${GITHUB_REPOSITORY}`;
  if (GITHUB_EVENT_NAME === "push") ensureLabels(gh, repoPath);
  if (GITHUB_EVENT_NAME === "issues") {
    reconcileIssue(
      gh,
      repoPath,
      JSON.parse(readFileSync(GITHUB_EVENT_PATH, "utf8")),
    );
  }
}
