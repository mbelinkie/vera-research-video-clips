# Quote records and API (#77)

Expose project-scoped quote creation, editing, listing and deletion through the existing Library API. Preserve exact source text and separately store the latest display text, speaker and title, location, surrounding words, highlight position, citation override, Topics, note and logger. Quotes from the same article should reuse a source after removing tracking parameters while retaining meaningful URL parameters.

Boundaries: Library contracts, authorized cloud API and catalog, persistent cloud migrations and synthetic tests. Existing source and item consumers and records remain compatible. No browser UI, extension, acquisition, Timeline placement, or production data.

Failures: reject invalid or blank original text, unauthorized access, stale edits and cross-project access; avoid duplicate article sources under concurrent creation. Preserve original text when updating latest display text.

Acceptance: exercise quote CRUD including missing speakers, speaker without title, offline sources, tracking-parameter deduplication, authorization and original/display separation. Run focused tests followed by `npm run check`; retain results on the issue.
