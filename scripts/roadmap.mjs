#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MODEL_CLASSES = ["luna", "terra", "sol"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const STATUSES = [
  "Inbox",
  "Backlog",
  "Ready",
  "In progress",
  "Blocked",
  "In review",
  "Done",
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArguments(values) {
  const [command, ...rest] = values;
  const flags = new Map();
  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) flags.set(key, true);
    else {
      flags.set(key, next);
      index += 1;
    }
  }
  return { command, flags, positionals };
}

function required(flags, name) {
  const value = flags.get(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required --${name}`);
  }
  return value.trim();
}

function runGh(args, input) {
  const result = spawnSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    input,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "GitHub command failed").trim());
  }
  return result.stdout.trim();
}

function routeClass(model) {
  const normalized = model.toLowerCase();
  return MODEL_CLASSES.find((candidate) => normalized === candidate || normalized.includes(`-${candidate}`));
}

export function validateRouting(labels, actualModel, actualEffort) {
  const modelLabels = labels.filter((label) => label.startsWith("model:"));
  const effortLabels = labels.filter((label) => label.startsWith("effort:"));
  if (modelLabels.length !== 1 || effortLabels.length !== 1) {
    throw new Error("Ready work requires exactly one model label and one effort label");
  }
  const expectedModel = modelLabels[0].slice("model:".length);
  const expectedEffort = effortLabels[0].slice("effort:".length);
  if (!MODEL_CLASSES.includes(expectedModel) || !EFFORTS.includes(expectedEffort)) {
    throw new Error("Issue has an unsupported model or effort label");
  }
  const actualClass = routeClass(actualModel);
  if (actualClass !== expectedModel || actualEffort !== expectedEffort) {
    throw new Error(
      `Profile mismatch: issue requires ${expectedModel}/${expectedEffort}; task is ${actualModel}/${actualEffort}`,
    );
  }
  return { expectedModel, expectedEffort };
}

export function latestClaim(comments) {
  const marker = /<!-- vera-claim (\{.+?\}) -->/g;
  let latest;
  for (const comment of comments) {
    for (const match of comment.body.matchAll(marker)) {
      latest = JSON.parse(match[1]);
    }
  }
  return latest;
}

export function assertClaimAvailable(comments) {
  const current = latestClaim(comments);
  if (current?.state === "active") {
    throw new Error(`Issue already claimed by ${current.task}`);
  }
  return current ?? null;
}

function issueNumber(parsed) {
  const value = parsed.positionals[0] ?? parsed.flags.get("issue");
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error("Provide a positive issue number");
  return number;
}

async function config() {
  return JSON.parse(await readFile(path.join(root, ".github", "vera-roadmap.json"), "utf8"));
}

function issueView(repository, number) {
  return JSON.parse(
    runGh([
      "issue", "view", String(number), "--repo", repository,
      "--json", "number,title,url,state,body,labels,comments",
    ]),
  );
}

function labelsOf(issue) {
  return issue.labels.map((label) => label.name);
}

function addToProject(settings, url) {
  runGh(["project", "item-add", String(settings.projectNumber), "--owner", settings.owner, "--url", url]);
}

function setStatus(settings, url, status) {
  if (!STATUSES.includes(status)) throw new Error(`Unsupported status: ${status}`);
  runGh([
    "project", "item-edit", String(settings.projectNumber), "--owner", settings.owner,
    "--url", url, "--field", "Status", "--value", status,
  ]);
}

function projectItem(settings, number) {
  const result = JSON.parse(
    runGh(["project", "item-list", String(settings.projectNumber), "--owner", settings.owner, "--limit", "500", "--format", "json"]),
  );
  return result.items.find((item) => item.content?.number === number && item.content?.repository === settings.repository);
}

function addComment(repository, number, body) {
  runGh(["issue", "comment", String(number), "--repo", repository, "--body-file", "-"], body);
}

function claimMarker(claim) {
  return `<!-- vera-claim ${JSON.stringify(claim)} -->`;
}

function acceptanceReady(body) {
  return /^## Acceptance criteria\s*$/im.test(body) && /- \[ \] |\n\d+\. /m.test(body);
}

async function linkSubIssue(settings, parentNumber, childNumber) {
  const parentId = runGh(["api", `repos/${settings.repository}/issues/${parentNumber}`, "--jq", ".node_id"]);
  const childId = runGh(["api", `repos/${settings.repository}/issues/${childNumber}`, "--jq", ".node_id"]);
  runGh([
    "api", "graphql", "-f",
    "query=mutation($parent:ID!,$child:ID!){addSubIssue(input:{issueId:$parent,subIssueId:$child}){issue{id}}}",
    "-f", `parent=${parentId}`, "-f", `child=${childId}`,
  ]);
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const settings = await config();
  const repository = settings.repository;
  if (!parsed.command || parsed.flags.has("help")) {
    console.log("Usage: npm run roadmap -- <inspect|create|claim|block|escalate|review|complete> [issue] [flags]");
    return;
  }

  if (parsed.command === "create") {
    const title = required(parsed.flags, "title");
    const bodyPath = required(parsed.flags, "body-file");
    const model = required(parsed.flags, "model");
    const effort = required(parsed.flags, "effort");
    const type = String(parsed.flags.get("type") ?? "implementation");
    if (!MODEL_CLASSES.includes(model) || !EFFORTS.includes(effort)) throw new Error("Unsupported model or effort");
    const body = await readFile(path.resolve(bodyPath), "utf8");
    if (!acceptanceReady(body)) throw new Error("Issue body needs a heading named 'Acceptance criteria' and a checklist or numbered criteria");
    const url = runGh([
      "issue", "create", "--repo", repository, "--title", title, "--body-file", bodyPath,
      "--label", `model:${model}`, "--label", `effort:${effort}`, "--label", `type:${type}`,
    ]);
    addToProject(settings, url);
    setStatus(settings, url, "Inbox");
    const number = Number(url.split("/").at(-1));
    if (parsed.flags.has("parent")) await linkSubIssue(settings, Number(parsed.flags.get("parent")), number);
    console.log(url);
    return;
  }

  const number = issueNumber(parsed);
  const issue = issueView(repository, number);
  const item = projectItem(settings, number);
  if (parsed.command === "inspect") {
    console.log(JSON.stringify({ issue: { ...issue, comments: undefined }, project: item ?? null, claim: latestClaim(issue.comments) ?? null }, null, 2));
    return;
  }
  if (!item) throw new Error("Issue is not on the configured roadmap project");

  if (parsed.command === "claim") {
    const model = required(parsed.flags, "model");
    const effort = required(parsed.flags, "effort");
    const task = required(parsed.flags, "task");
    const branch = required(parsed.flags, "branch");
    validateRouting(labelsOf(issue), model, effort);
    if (item.status !== "Ready") throw new Error(`Issue must be Ready before claim; current status is ${item.status ?? "unknown"}`);
    assertClaimAvailable(issue.comments);
    const claim = { state: "active", model, effort, task, branch, startedAt: new Date().toISOString() };
    addComment(repository, number, `${claimMarker(claim)}\nClaimed by task \`${task}\` on branch \`${branch}\` using \`${model}\` at \`${effort}\` effort.`);
    setStatus(settings, issue.url, "In progress");
    console.log(`Claimed ${issue.url}`);
    return;
  }

  const evidence = required(parsed.flags, "evidence");
  if (parsed.command === "block") {
    addComment(repository, number, `Blocked.\n\nConfirmed evidence: ${evidence}`);
    setStatus(settings, issue.url, "Blocked");
  } else if (parsed.command === "escalate") {
    const recommendedModel = required(parsed.flags, "recommend-model");
    const recommendedEffort = required(parsed.flags, "recommend-effort");
    if (!MODEL_CLASSES.includes(recommendedModel) || !EFFORTS.includes(recommendedEffort)) throw new Error("Unsupported recommended profile");
    runGh(["issue", "edit", String(number), "--repo", repository, "--add-label", "needs:model-escalation"]);
    const prior = latestClaim(issue.comments);
    const released = { ...(prior ?? {}), state: "released", releasedAt: new Date().toISOString() };
    addComment(repository, number, `${claimMarker(released)}\nModel escalation requested.\n\nConfirmed evidence: ${evidence}\n\nRecommended profile: \`${recommendedModel}/${recommendedEffort}\`. The steward must approve routing labels before a new claim.`);
    setStatus(settings, issue.url, "Blocked");
  } else if (parsed.command === "review") {
    addComment(repository, number, `Implementation is ready for acceptance review.\n\nEvidence: ${evidence}`);
    setStatus(settings, issue.url, "In review");
  } else if (parsed.command === "complete") {
    const acceptedBy = required(parsed.flags, "accepted-by");
    addComment(repository, number, `Accepted by ${acceptedBy}.\n\nAcceptance evidence: ${evidence}`);
    setStatus(settings, issue.url, "Done");
    runGh(["issue", "close", String(number), "--repo", repository, "--reason", "completed"]);
  } else {
    throw new Error(`Unknown command: ${parsed.command}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
