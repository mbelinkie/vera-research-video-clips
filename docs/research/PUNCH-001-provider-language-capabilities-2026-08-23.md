# PUNCH-001 provider language capability references

Checked: 2026-08-23

## Amazon Translate

Primary reference:

- <https://docs.aws.amazon.com/translate/latest/dg/what-is-languages.html>

The supported-language table is the authoritative initial capability source for
the configured Amazon Translate text adapter. It lists Korean (`ko`) and English
(`en`) but not Dzongkha (`dz`). The adapter must preflight both normalized source
and target codes before sending transcript text. Unsupported pairs remain an
actionable local/catalog state and must not reach the AWS sender.

## whisper.cpp / Whisper

Primary references:

- <https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md>
- <https://github.com/ggml-org/whisper.cpp/blob/master/src/whisper.cpp>
- <https://github.com/openai/whisper/blob/main/whisper/tokenizer.py>

The CLI accepts `-l/--language` and `auto`; whisper.cpp validates explicit
languages through its compiled language map. The current upstream map includes
Korean (`ko`) but not Dzongkha (`dz`). The local adapter should therefore expose
a deterministic capability check before source-media acquisition and pass a
confirmed hint only when its normalized primary code exists in that map.

The provider capability is not universal or permanent. Keep the list/version
behind the adapter and update this record when the pinned runtime changes.
