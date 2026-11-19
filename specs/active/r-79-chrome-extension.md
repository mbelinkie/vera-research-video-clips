# Capture from Chrome into a Research project

The producer can close the Research workspace, highlight a passage in a signed-in Chrome tab, and log the exact quote and its two pictures to a visible, writable project. The toolbar, selection context menu and shortcut enter the same confirmation flow. The producer can also keep a still, save a page, register an audio link or queue a YouTube video.

## Boundaries

- Pair the unpacked extension once using the signed-in Research approval screen and its eight-digit challenge. Subsequent confirmations live inside the extension with all VERA tabs closed. Use a scoped, revocable installation key and existing project membership checks. Capture the current article text, bibliography and viewport pictures locally. Restore the original reading position.
- Preserve exact quote text and surrounding words. Collect optional speaker name, speaker title, Topics and note. Associate passage rectangles with the verified dimensions of a specific immutable picture.
- Store both original viewport and top pictures for Save page. Only an actual selection gets a highlight.
- Save the original still through the kept-copy service. Save audio records a source. The existing transcription batch service queues YouTube videos. Each deliberate submission can add a separate attributed comment, an explicitly checked YouTube playhead time, or both. Reuse the same project video and active transcription. Show the comments together on the queue and review entries. Each returned comment has a stable comment ID, source ID and nullable numeric `timecodeMs` measured from the start of the source, so a future marker can use the exact point without parsing display text. Zero means the beginning. Unchecked saves carry no position. Network retries preserve the original comment. Audio processing belongs to #83.
- Handle expired sessions, changes of active tab or document, blocked images, unavailable screenshots, read-only projects and retries explicitly. Keep private captures out of logs and test artifacts.
- Keep PDF selection, hosting changes, extension publication and the #75 producer design review outside this delivery.

## Verification

Start with strict payload, capture geometry, consent, membership, image integrity and replay tests. Exercise the unpacked extension on a disposable authenticated Chrome fixture, including both picture reads, and run the Research check suite. The original external acceptance requires a producer-authorized signed-in paywalled Chrome result, the four other actions, a green protected Test check and a merged PR. Record these outcomes separately.

## Local checkpoint, November 19

The paired capture flow and Research storage are implemented. The integration test saved three comments on one video and created one transcription job. It recovered a checked position of 490,012 ms, a timestamp-only position of 0 ms and a text-only entry with a null position through both the source comments API and the review inbox. The extension confirmation tests cover checked and unchecked saves. The local unit and integration suite reported 355 passing and three skipped tests. The web build and both migration checks passed.

Resume with the disposable Chrome fixture. Verify that the normal permission gesture allows each screenshot, that the passage rectangles align with the quote on the stored image, and that page, still, audio and YouTube actions work through Chrome. Review how Research records missing pictures and supports attaching a later capture to the original quote. The separate producer-authorized paywalled-page check remains open. Keep the issue in progress until the draft and evidence are ready.

The Chrome for Testing run paired on loopback and reached the authenticated synthetic article. Invoking the extension popup stopped before confirmation with “Capture failed.” An isolated run obtained the exact quote, three rectangles and two PNGs without a second article request. Reproduce the popup failure with the normal toolbar gesture and distinguish a fixture limitation from a production failure before signing off. The isolated result does not establish end-to-end acceptance.
