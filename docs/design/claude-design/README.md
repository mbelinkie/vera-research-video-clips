# Claude Design UI review bundle

This folder is the sanitized handoff entry point for a design review of VERA
Research Video Clips. The repository remains the authoritative source for the
working React UI and product behavior; this bundle narrows the context Claude
Design should read first.

## Start here

1. Read [`CLAUDE-DESIGN-PROMPT.md`](./CLAUDE-DESIGN-PROMPT.md) and use it as
   the opening prompt.
2. Read [`UI-CONTEXT.md`](./UI-CONTEXT.md) for the audience, workflow,
   terminology, non-negotiable behavior, screen inventory, and source map.
3. Read [`SANITIZATION.md`](./SANITIZATION.md) before importing screenshots or
   any additional files.
4. If screenshots have not yet been added, follow
   [`screenshots/README.md`](./screenshots/README.md) to capture the required
   fictional fixture states.

## Review objective

Improve information hierarchy, navigation, density, transcript readability,
selection-to-clip actions, accessibility, and visual consistency without
changing the application's workflow or data semantics. Explore two or three
coherent directions before selecting one for a detailed interactive prototype.

## Expected output

- A concise usability and visual-hierarchy critique.
- Two or three distinct design directions using the existing product language.
- A high-fidelity interactive desktop prototype for the preferred direction.
- Responsive recommendations for narrower desktop windows; this is not a
  mobile-first product.
- Explicit designs for loading, empty, unavailable, conflict, offline-cached,
  and long-running job states.
- A handoff bundle containing design intent, component/state mapping, tokens,
  assets, and implementation notes. Do not directly edit the production repo.

## Repository

GitHub: `mbelinkie/vera-research-video-clips`

Development UI: `http://127.0.0.1:43112` after running `npm run dev`. Keep it
loopback-only. Do not publish or tunnel the development services for review.
