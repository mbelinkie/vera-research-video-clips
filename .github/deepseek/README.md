# DeepSeek attempts

Free ChatGPT grooming plus cheap DeepSeek attempts, to take load off Codex.
None of it needs babysitting.

```
Prep board ──one click──▶ ChatGPT grooms the issue ──vera_launch_deepseek──▶ label `deepseek`
      ▲                                                                          │
      └────────── draft PR + notes for Codex ◀── DeepSeek agent on a GitHub runner ┘
```

## How it works

1. **Launch.** Add the label `deepseek` (cheap Flash model) or `deepseek-pro` (V4 Pro, for
   harder tasks) to an issue. Usually the ChatGPT grooming chat does this through the
   VERA Mac Bridge tool `vera_launch_deepseek`. That tool first posts the groomed brief as
   a comment marked `<!-- vera-deepseek-brief -->`. You can also add the label by hand,
   or run the workflow manually from the Actions tab.
2. **Run.** `.github/workflows/deepseek.yml` starts on a fresh GitHub runner. It installs
   dependencies (`setup.sh`), builds a prompt from the issue, its comments and the brief
   (`job.mjs prompt`), and runs the Claude Code agent program against DeepSeek's
   Anthropic-compatible API. DeepSeek does all the thinking; no Anthropic account or
   tokens are used. The agent reads code, edits, runs focused tests and iterates.
3. **Result.** The job commits whatever the agent produced to `deepseek/issue-<n>-<run>`
   and opens a **draft PR** whose description is the agent's handoff notes (summary,
   changes, tests run, what is left, notes for Codex). The issue gets a result comment
   and the label `deepseek-done`, or `deepseek-failed` if there was nothing usable.

Each issue gets its own runner, so many attempts can run at once. A second launch on
the same issue waits for the first to finish.

## Prep board (Script-to-Timeline repo)

`npm run prep`, or double-click `Open VERA Prep Board.command`, opens a local board at
http://127.0.0.1:51750/. It lists open issues from both Projects in Queue Order, grouped as
**To groom → DeepSeek running → Ready for Codex / Needs a look**.

- **Groom in ChatGPT** opens chatgpt.com with the grooming prompt (`chat-prompt.md`) and
  also copies it, in case you'd rather paste it into the desktop app. Chat grooms the
  issue, asks only Producer questions, and launches DeepSeek through the Mac Bridge.
- **DeepSeek now**, or tick several issues and click **Send checked to DeepSeek**, skips
  grooming and runs Flash on the issues as written. The jobs run in parallel.
- **Open in Codex** opens a new Codex chat with a review-and-finish prompt for the draft PR.

## Limits and safety

- The hard spending cap is the prepaid balance on the DeepSeek account. Each job is also
  capped at 200 agent turns and 80 minutes. The cost shown on the PR is an estimate at
  DeepSeek's peak rates.
- Only the repository owner's label starts a job.
- The agent never sees a GitHub token. The checkout keeps no credentials, and the job
  pushes from a separate step after the agent has exited.
- Edits under `.github/workflows` are discarded.
- Nothing merges automatically. DeepSeek PRs are drafts for Codex to review and finish.

## One-time setup (Producer)

Add the repository secret `DEEPSEEK_API_KEY` (Settings → Secrets and variables →
Actions → New repository secret). The labels are created automatically on first use.

## Files

- `.github/workflows/deepseek.yml`: the job
- `.github/deepseek/job.mjs`: label, prompt and PR helper (Node standard library only)
- `.github/deepseek/setup.sh`: repository-specific dependency install
