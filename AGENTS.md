# Agent guide

Read `PROJECT_GUIDE.md` for how this project is built and verified.

## Branches and delivery

- Start each issue from current `origin/main`. Push the first commit and open
  a draft PR targeting `main` with `Closes #<issue>` when an issue exists.
  Bring reviewed drafts up to date with `main` before delivery.
- Deploy each pilot from a recorded commit already on `main`. Send pilot fixes
  through their own PRs to `main`, then advance the deployment to a new commit.
- Run `npm run check` and enable auto-merge
  (`gh pr merge --auto --merge`) once the PR is ready. Verify the PR merged into
  `main` before marking the code delivered. The required `Check` must pass,
  and `main` is protected from deletion and force pushes. After merge, clean
  up the branch and worktree once any unique local work is preserved.
- Review each open PR by day seven. Merge it when ready, split it into a
  smaller PR to `main`, or record the blocker, owner, and next review date
  in the PR. Review overdue PRs at the start of the next work session. Close
  superseded or abandoned PRs after preserving their unique work and linking
  its location.

## "Work on the next prepped ticket"

When Matthew says this (or something like it), find the highest-priority open
issue, in either VERA repository, that has a finished DeepSeek draft (label
`deepseek-done`), isn't already In progress or In review, and has no unfinished
dependencies. The easiest way is to run `npm run prep -- --next` in a
Script-to-Timeline checkout (mbelinkie/vera-script-to-timeline).

The issue carries a groomed brief comment (from ChatGPT) and a DeepSeek draft
PR, or a pushed `deepseek/issue-<n>-<run>` branch linked from its result
comment. His request is the go-ahead for that ticket. Start your branch from
DeepSeek's branch, review the draft against the brief and the issue, fix and
finish it, and deliver it as usual. Close DeepSeek's draft PR once yours
supersedes it. See `.github/deepseek/README.md`.
