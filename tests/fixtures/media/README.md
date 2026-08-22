# Synthetic media fixtures

`synthetic-4s.mp4` and `synthetic-32s.mp4` are generated locally from FFmpeg's
color and sine sources. They contain no third-party media or speech and are safe
for deterministic, redistributable tests. The longer fixture is paired with
repository-authored bilingual transcript text only to test immutable transcript
snapshots, subtitle policy, trimming, packaging, and cleanup; it is not evidence
of acoustic language detection or transcription accuracy.

The generated media and the authored fixture text are dedicated to the public
domain under CC0-1.0. `synthetic-32s.fixture.json` records the committed long
fixture's digest, expected media properties, exact gate bounds, and paired
transcript fixture.

Regenerate it with:

```bash
npm run fixture:media
```

Regeneration can vary encoded bytes across FFmpeg versions. After an intentional
regeneration, inspect the media with FFprobe and update the committed SHA-256 in
`synthetic-32s.fixture.json` in the same reviewed change.
