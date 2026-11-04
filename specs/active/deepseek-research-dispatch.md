# #426 — Research hosted DeepSeek validation and mock fixture

- Status: active
- Task/thread: #426 Research repo slice

## User-visible outcome

The Research repository has a GitHub-hosted, read-only `issue_comment` workflow
that checks exact `/deepseek dispatch` requests through the shared pinned
Script-to-Timeline validator. A synthetic Research fixture supports one-file
mock-mode proof with a deterministic host check and no provider access.

## Scope and boundaries

- Add a Research-only dispatch workflow with read-only `contents` and `issues`
  permissions, exact repository/issue/comment filters, and pinned action and
  trusted-validator revisions.
- Add a read-only PR check that proves the baseline fixture is rejected and an
  isolated copy of the expected mock output passes the frozen host check.
- Keep all hosted work on GitHub-hosted runners. It validates public state only
  and does not call a provider, access private Mac state, or forward work.
- Pass the shared validator the fixed `0.25` USD task ceiling, without requiring
  a Research repository Actions variable.
- Add one synthetic JSON candidate file and a host-side check for its exact
  mock output.

## Handoff and current limitation

The initial immutable validator pin is `ec355268f6aba4dbf9fe253282d534f6452a37d3`,
the current Script-to-Timeline `main` revision. Its validator
hard-codes Script-to-Timeline and rejects the Research repository. It is a
fail-closed placeholder only; replace it with the immutable Script-to-Timeline
commit that lands the two-repository allowlist before this workflow can validate
a real Research request or this slice is ready for delivery.

Before this change Research had no `.github/workflows`, Actions checks, or
classic branch protection. The README's documented project check is
`npm run check`; this adds a focused PR check for the synthetic mock contract.

## Non-goals

- No live Research model call, dispatch event, private adapter, task/receipt/
  cursor state, secrets, or spend.
- No hosted checkout or execution of issue/PR content.
- No generic repository routing or workflow variable that can select a code
  revision.

## Acceptance criteria

- Only a newly created exact dispatch comment on a non-PR issue in
  `mbelinkie/vera-research-video-clips` reaches the validation job.
- A PR run has a separate `verify-mock-fixture` check, with `contents: read`
  only, and does not expose a persisted checkout credential to PR code.
- The workflow requests only read access, checks out the shared validator at a
  fixed commit, and never calls the private adapter or provider.
- The trusted-validator SHA is updated to the merged two-repository allowlist
  before delivery or any real Research event test.
- `node scripts/verify-research-mock-candidate.mjs` passes when the sole target
  file has the frozen mock output: `status: "mock-verified"`.

## Failure states

- Missing variables, invalid approval, stale issue/comment/review data, or a
  validator mismatch fails closed without forwarding work.
- The placeholder validator rejects Research until the parent supplies the
  post-merge immutable SHA.
- The synthetic check fails if the fixture is missing, malformed, or differs
  from the frozen output.

## Verification plan

1. Inspect workflow permissions, exact event filter, immutable action pins, and
   shared validator pin.
2. Run the PR test which confirms the baseline fixture is rejected and the
   expected mock output passes in an isolated temporary copy.
3. Parse the workflow YAML, check the new script's Node syntax, and run
   `git diff --check`.
4. Record that a real Research Actions event and Mac mock proof remain parent
   integration steps after the trusted validator update.

## Local verification

- `npm ci` succeeded. `npm run check` passed Prettier and TypeScript, then had
  four existing 15-second PGlite test timeouts under the parallel Vitest run
  (17 files passed, 1 skipped; 97 tests passed, 4 failed). Build and migration
  stages were not reached.
- All four timeout files passed when rerun at one worker. The dedicated
  `node --test tests/deepseek-mock-candidate.test.mjs` also passed (1 test).
- The mock test confirmed the baseline `draft` fixture is rejected and the
  expected `mock-verified` output passes in an isolated temporary copy. Its
  checker uses only local Node assertions and file reading.
- Node syntax validation and `git diff --check` passed. The workflow YAML parsed;
  static checks covered the exact Research event filter, read-only permissions,
  pinned actions, immutable validator SHA, and fixed `0.25` task cap.
- GitHub shows no Actions runs or commit statuses for the current Research main
  revision, and the repository had no tracked `.github/workflows` before this
  change. The parent confirmed that classic branch protection is absent; the
  new named PR check will report results but is not currently a merge gate.
