# Quote records and API (#77)

Expose project-scoped quote creation, editing, listing and deletion through the existing Library API. Preserve exact source text and separately store the latest display text, speaker and title, location, surrounding words, highlight position, citation override, Topics, note and logger. Quotes from the same article should reuse a source after removing tracking parameters while retaining meaningful URL parameters.

Boundaries: Library contracts, authorized cloud API and catalog, persistent cloud migrations and synthetic tests. Existing source and item consumers and records remain compatible. No browser UI, extension, acquisition, Timeline placement, or production data.

Failures: reject invalid or blank original text, unauthorized access, stale edits and cross-project access; avoid duplicate article sources under concurrent creation. Preserve original text when updating latest display text.

Acceptance: exercise quote CRUD including missing speakers, speaker without title, offline sources, tracking-parameter deduplication, authorization and original/display separation. Run focused tests followed by `npm run check`; retain results on the issue.

## Implementation and verification

Commit `4bc1afe` extends the Library contracts, catalog, and Cloud API. Quote content preserves `text` as the exact original. A separate versioned update records the latest display text. Article matching uses the project's current web source URLs and ignores recognized tracking keys. Duplicate legacy records retain their IDs and item links. Migration `0054_library_source_reuse` keeps additional source create retry records when a capture reuses a source. The pilot snapshot and synthetic import include the new table.

- The focused Library API and cloud migration suites passed all six tests.
- A disposable PostgreSQL 16 database passed simultaneous source creation across two connections, including differently cased spellings of the same project UUID, and the race between a capture and a URL edit.
- Synthetic PGlite to PostgreSQL import preserved one source, one quote, its Topic assignment, and one source reuse receipt with row equality.
- `TMPDIR=/private/tmp npm run check` passed on Node 24.19.0 with 273 tests passed and three opt-in tests skipped. Formatting, typechecking, the web build, and local and cloud migrations passed. The physical temp path satisfies the existing media tests on macOS.

Article matching scans the addressed project's web sources and reuses one stable record if legacy duplicates exist. The extension and editor can use the API independently of this change. Protected CI and merge evidence are tracked in PR #87.
