# Save YouTube reasons and moments from Chrome

[Research #101](https://github.com/mbelinkie/vera-research-video-clips/issues/101) extends the delivered Chrome intake. A researcher chooses a writable project, adds a video or edits its reason, and can save multiple points worth revisiting from the same source.

- General mode opens unchecked. The optional reason has a 200-character limit and comes from the chosen project's source. Saving is explicit and records the last editor.
- Checking Timecode samples the original YouTube tab once. Mode switches preserve the reason draft, moment draft, and frozen playhead. An unreadable playhead leaves general capture available. A failed save leaves the current draft available for retry.
- Check the sender and original document in Chrome. Continue using the existing temporary tab access and scoped extension connection. Prefill must follow the currently selected project's membership and ignore late responses from another selection.
- Preserve the existing YouTube queue and canonical project source. Write the reason or point alongside the submission receipt in the same transaction. Normalize the video identity before checking a retry. An unchanged replay must return the same source without reapplying an older reason or creating another moment.
- The point bookmark implementation referenced by #32 was absent on Research main. Persist the minimum source-linked point, elapsed milliseconds, optional note, author and creation time. Read both records with project authority, including on a source with no Library items. The receipt opens that exact project source and its moments can seek the player.
- Preserve the quote, still, page and audio paths and existing video comments. Leave broader bookmark editing, source comment threads, Library items for moments, clip logging, exports and #75 placement outside this spec.

Run the contract, extension confirmation and catalog/route tests first. Cover new and existing sources, reason clearing and attribution, canonical URL aliases, project isolation, replay after a newer edit, frozen playhead and draft restoration, and unavailable playback. Verify the normal flow in real Chrome with a disposable managed project and authorized fixture. Run Research's full check and the protected GitHub Test workflow. Leave External acceptance on the issue.

Chrome defines the temporary access grant and the document ID returned by script injection. [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) · [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-InjectionResult)
