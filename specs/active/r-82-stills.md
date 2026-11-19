# Research #82 — Retained Library stills

An editor can save a public image URL, an image supplied from their browser, or a crop of a screenshot from an existing web-page source to the visible project's Library. Each still has a full-resolution kept copy, a browser-safe preview, a thumbnail, title, Topics, credit and licence or usage note, and links to its provenance. Authorized previews and build consumers read only version-pinned, verified private bytes. A failed source URL has no effect on saved images.

Use the existing Library contracts, project authorization, Topics, idempotency, and private object store. Add trusted still-specific creation and byte delivery, an additive cloud migration, and a project-scoped still workspace. Share the public URL guard with the existing web-page reader. Use normalized crop coordinates on oriented pixels. Keep existing sources and items readable, including older stills without kept assets.

Reject unsupported, oversized or corrupt images, unsafe URLs, out-of-bounds crops, insufficient access and mismatched idempotency replays. A failed import leaves no visible item. Missing or corrupt retained bytes get an explicit unavailable state. Copying never confers usage permission.

The first slice is an authorized file import in a disposable project, with display and thumbnail verified from the private store. Extend the same path to safe URL inputs, supplied page screenshots and crops of saved stills. This issue excludes the full workspace redesign, extension UI, automatic screenshot capture, Timeline placement and Resolve. The producer-approved Research Sources specification and the prep brief on issue #82 define the linked behavior.

Start with synthetic media and focused still API tests. Confirm authorization before fetch, project isolation, failure and replay behavior, verified retained bytes after the source disappears, pixel crop and provenance, and existing Library compatibility. Verify the browser workflow with synthetic data, the additive migration, and `npm run check` before protected delivery.
