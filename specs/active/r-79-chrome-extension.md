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

## Verification and handoff

The local full check passed with 358 tests passing and three skipped. Formatting, type checking, the web build and both migration checks passed. The opt-in browser test passed against a fresh managed Research server.

- The source comments API, transcription queue and review inbox preserve the same source ID, stable comment IDs and optional elapsed milliseconds. A text-only entry, a comment at 490,012 ms and a timestamp-only entry at 0 ms produced one source and one transcription job. The confirmation tests exercise both positions of the timecode checkbox.
- Chrome for Testing paired with a disposable managed Research server, closed all VERA tabs, opened the actual toolbar popup on a synthetic authenticated article, canceled once and saved a wrapped quote. Research returned both immutable PNG revisions. Their checksums and bytes matched the submitted pictures, and every stored passage rectangle overlapped the painted words. The proof also checked the original scroll position and one article request. A second Save page reused the same source. The fixture pregrants the loopback Research server permission. The separate article host receives the normal temporary toolbar grant.
- Chrome can save available text and pictures after a screenshot failure. Research lists the missing roles on the receipt. A later explicit picture repair code adds missing pictures to the same quote or page. Project, original author, URL, kind and exact quote are checked before attaching pictures. Tests verify original item identity, preservation of the existing revision and replay.
- Headed Chrome for Testing 153 loaded the original unpacked manifest in a fresh profile. Chrome displayed its native permission prompt and granted only the loopback Research origin after Allow. Eight-digit pairing succeeded, and capture worked after the Research tabs closed.
- The native selection menu saved the exact quote with both pictures. The page menu and Control+Shift+U saved both pictures without a highlight and reused the page source. Control+Shift+Y opened the quote confirmation with the selected text and both pictures in a fresh source tab.
- The still menu preserved the image URL, page URL and alt text. The kept original matched the captured bytes. The audio link menu registered an audio source for the selected file URL.
- Two native YouTube menu saves on a disposable watch page produced one video source and one transcription batch. The source and batch returned the same two distinct attributed comments. Research stored 8,122 ms for the checked playhead. The unchecked submission omitted the position and Research returned null. The fixture supplied local playback and a synthetic metadata response for its video ID.
- The Producer saved a quote from a signed-in paywalled article and confirmed Chrome returned to the same reading position. The local Research project returned the saved quote, title, URL, byline and both verified picture revisions. The headline was visible in the top picture and the saved highlight covered the quote in the passage picture.
- A complete quote save now closes its confirmation window after briefly showing the receipt. An incomplete picture save keeps the receipt open so the repair code can be copied. Merge remains pending. The source marker editor remains a separate product decision.
