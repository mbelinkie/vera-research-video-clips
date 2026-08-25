# Screenshot capture checklist

No production or live-project screenshots belong here. Capture only
deterministic fictional fixture states and verify them against
[`../SANITIZATION.md`](../SANITIZATION.md).

The automated in-app capture was unavailable when this bundle was assembled,
so the image files below must be captured from a fresh local fixture before the
bundle is imported. Do not publish or tunnel the development server.

## Required filenames

- `01-add-and-worklist.png`
- `02-transcript-workspace.png`
- `03-selected-passage-actions.png`
- `04-review-inbox.png`
- `05-logged-clips.png`
- `06-project-settings.png`

## Capture recipe

1. Run `npm run dev` and open `http://127.0.0.1:43112` locally.
2. Use fixture identities and data only. The preferred vocabulary is in
   [`../UI-CONTEXT.md`](../UI-CONTEXT.md).
3. Use a normal desktop window large enough to show the intended hierarchy;
   keep the same dimensions for all six images.
4. Clear the development credential field after connecting and before every
   capture.
5. Capture the full application window without unrelated desktop content.
6. Inspect every image at full resolution using the sanitization checklist.

For the transcript and selected-passage states, use a deterministic local or
mocked transcript. Never load a private shared transcript merely to make the UI
look populated.
