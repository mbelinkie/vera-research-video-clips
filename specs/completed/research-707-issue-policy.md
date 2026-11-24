# Research issue policy

[Timeline #707](https://github.com/mbelinkie/vera-script-to-timeline/issues/707) is
the shared implementation brief. Design filers should see pending shipped
verification, and bug filers should see the current classification problems
before requesting Ready or claiming work.

Use one repo-local GitHub Issues workflow, the existing Timeline roadmap
commands where available, and a short manual filing and readiness guide.
Keep issue text as data. Keep classifiers and verification evidence under
human control. Product behavior, pilot deployment, and project data are outside
this change.

A delayed or duplicate event must preserve later verification and converge
on one current bug warning. Check synthetic GitHub events and repeated label
setup first, then run the normal Research Check.

## Completion record

- Design enrollment landed in `b3ef2f3`. Bug warnings and the manual
  Ready/claim procedure landed in `03420bb`.
- The workflow calls `scripts/issue-policy.mjs` on issue events and sets up the
  label catalog on main. `scripts/issue-policy.test.mjs` exercises the policy
  without contacting GitHub. `AGENTS.md` links to the shared filing and
  verification procedures.
- All eight issue fixtures passed. Local formatting and type checks, the web
  build, and both migration checks passed. The full local test pass first
  encountered a symlinked macOS temp path. With the real path the affected
  media tests passed, and the one cloud API test that timed out in the full
  run passed in isolation. The protected GitHub Check is linked in the PR.
- Research uses the GitHub Project for manual Ready and claim. Issue-event
  behavior was exercised with synthetic fixtures. Follow the shared register
  when recording shipped product evidence.

[Research PR #128](https://github.com/mbelinkie/vera-research-video-clips/pull/128)
