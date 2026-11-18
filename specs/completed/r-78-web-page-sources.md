# Web page sources

Research #78 implements the accepted Research Sources spec §4.2 for web page details and text. Both import paths write the existing project Library source with its existing authorization and citation editing rules. The extension supplies HTML and metadata as data. Pasted URLs use the Mac agent and the Timeline policy described in `apps/local-agent/src/web-page/README.md`.

The source retains an actionable extraction outcome and remains usable for typed quotes. Citation values keep their provenance and missing metadata remains blank. The optional web page details use the existing JSON column, so old source records remain valid and there is no database migration.

The integration fixtures cover normal article import, missing authors and date, extension metadata without refetch, correction and confirmation, blocked and unreadable source records, typed quotes and project write permissions. The guard fixtures check DNS admission, redirects, peer verification and the deadline using synthetic transports with no sockets.
