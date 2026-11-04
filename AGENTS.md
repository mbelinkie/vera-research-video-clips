# Agent guide

Read `PROJECT_GUIDE.md` for how this project is built and verified.

Delivery: branch from `main`, run `npm run check`, open a PR with
`Closes #<issue>`, and turn on auto-merge (`gh pr merge --auto --merge`). The
`Check` workflow must pass before anything lands on `main`; `main` cannot be
force-pushed or deleted.

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
