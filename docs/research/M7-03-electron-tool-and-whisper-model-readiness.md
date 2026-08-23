# M7-03 Electron tool and Whisper model readiness research

Accessed: 2026-08-23

The repository pins Electron `43.4.1`. This record captures version-sensitive
primary-source constraints for M7-03 first-run readiness. It does not approve a
production Whisper model, tool binary, provider, download host, or release
channel.

## Electron desktop boundary

`dialog.showOpenDialog` is a main-process API. Its filters only constrain the
Finder presentation; the application must still validate a selected result. A
parent `BrowserWindow` makes the dialog a macOS sheet.

- [Electron dialog](https://www.electronjs.org/docs/latest/api/dialog)

The selection flow must pass only a typed picker intent over the preload bridge.
The main process owns canonical-path containment, regular-file and executable
validation, file identity checks before and after probing, child-process
argument arrays, and stored readiness state. `securityScopedBookmarks` applies
only to macOS App Store builds and does not replace these checks for this local
non-MAS application.

Electron's context isolation documentation requires a deliberately narrow
`contextBridge` API. Electron 29 and later cannot transfer `ipcRenderer` over
the bridge; raw `send`, `invoke`, or `on` exposure would still be unsafe. Every
IPC handler must validate both its input and the sender. The renderer must not
receive a raw filesystem path, process handle, command, argument list, token,
or arbitrary URL capability.

- [Electron contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)
- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)

`safeStorage` recommends asynchronous encryption/decryption APIs. On macOS,
they use Keychain and can require user interaction. Readiness must check
availability after app readiness and fail closed if protection is unavailable or
temporarily unavailable; refresh tokens have no plaintext renderer, URL, log,
environment, or SQLite fallback.

- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

For an app-owned model download, `net.fetch` uses Chromium's networking stack
but ignores `RequestInit.integrity` and, by default, can access `file:` and
custom protocols. Parse and allowlist an HTTPS URL before fetching, retain a
redirect policy, and verify the downloaded bytes independently. `session.downloadURL`
does not perform page-origin security checks, so it is not an authorization or
integrity mechanism.

- [Electron session and net APIs](https://www.electronjs.org/docs/latest/api/session)

Download into an app-owned staging directory; stream a SHA-256 while measuring
bytes; compare both with the pinned values; atomically promote only after a
match; preserve a prior valid version; and delete only the staging object on
cancellation or failure. Electron network integrity options are insufficient
for this purpose.

## Tool probe contracts

All probes must use an exact, canonicalized selected executable, argument
arrays, a constrained working directory/environment, timeout, and bounded
stdout/stderr capture. They must not inherit a user shell, run through a shell,
or accept renderer-provided arguments. Revalidate file identity before launch.
An executable selected by a user remains untrusted code; a successful probe
establishes capability, not safety or provider authorization.

### FFmpeg and FFprobe

FFmpeg documents `-version`, `-buildconf`, `-formats`, `-codecs`, `-encoders`,
`-filters`, and detailed `-h encoder=...` / `-h filter=...` capability help.
Those capabilities are build-dependent, so readiness must test the exact
features required by the selected fixed presets rather than infer them from a
version string.

- [FFmpeg command documentation](https://ffmpeg.org/ffmpeg.html)

Recommended argument arrays:

```text
["-hide_banner", "-version"]
["-hide_banner", "-encoders"]
["-hide_banner", "-filters"]
["-hide_banner", "-muxers"]
["-hide_banner", "-h", "encoder=<required-encoder>"]
["-hide_banner", "-h", "filter=<required-filter>"]
```

FFprobe documents `-show_program_version`, `-show_library_versions`, JSON
output, and selective structured output. It is the appropriate later fixture
inspection boundary; its actual result is input and build dependent.

- [FFprobe documentation](https://ffmpeg.org/ffprobe.html)

Recommended argument arrays:

```text
["-v", "error", "-show_program_version", "-show_library_versions", "-of", "json"]
["-version"]
[
  "-v",
  "error",
  "-show_format",
  "-show_streams",
  "-show_entries",
  "format=duration:stream=index,codec_type,codec_name",
  "-of",
  "json",
  "<verified-fixture-path>"
]
```

The first array is the structured version probe; the second is a compatibility
fallback. The third is not a health probe: it is a later, fixture-backed media
verification call after the path has been independently validated.

### yt-dlp

yt-dlp documents `--version`, `--help`, `--list-extractors`, `--simulate`, and
`--ignore-config`. It explicitly says ordinary stdout is not a stable embedding
interface and advises structured options such as `-J`, `--print`, and
`--progress-template` when output is consumed by another program. It also
normally loads portable, home, user, and system configuration files, hence a
health probe must pass `--ignore-config`.

- [yt-dlp README and CLI options](https://github.com/yt-dlp/yt-dlp/blob/master/README.md)

Recommended no-source argument arrays:

```text
["--ignore-config", "--version"]
["--ignore-config", "--help"]
["--ignore-config", "--list-extractors"]
```

The extractor list is an optional static inventory, not evidence that a source
can be legally or technically acquired. Any `-J` or `--simulate` call against a
source remains source-specific live access and requires the M7 authorization at
that time. yt-dlp's release channels and external extractor behavior change
frequently; record the exact observed version and maintain an explicit update
policy rather than treating any installed version as durable support.

### whisper.cpp and model files

The upstream project documents macOS Intel and Arm support, `whisper-cli -h`,
and CLI `--model`/`--file` options. The CLI documentation lists flac, mp3, ogg,
and wav as supported audio formats; the quick-start route separately notes a
16-bit WAV constraint. M7 must retain the existing controlled audio conversion
boundary rather than turn a help probe into a transcription guarantee.

- [whisper.cpp README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md)
- [whisper-cli documentation](https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md)
- [whisper.cpp model catalog](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md)

Recommended capability probe:

```text
["--help"]
```

Accept only an exit-success response that contains the required `--model` and
`--file` capability forms for the pinned workflow. The consulted upstream CLI
documentation does not define a stable `--version` contract. A best-effort
version response may be displayed as diagnostic information but cannot be a
readiness requirement; persist the canonical selected path, file identity or
hash, and observed capability result instead.

**No production Whisper model URL, expected size, or SHA-256 is approved by
this record.** The upstream model catalog labels its 40-hex values as `SHA`;
they are not SHA-256 values and cannot satisfy M7's SHA-256 requirement. Once a
separate authorized model choice exists, record the immutable artifact URL and
revision, expected byte count, independently obtained 64-hex SHA-256,
provenance, retrieval date, and applicable license before enabling a download.
Do not invoke the upstream download script from the application because M7
requires app-owned staging, cancellation, verification, and atomic promotion.

## Remaining uncertainty

- FFmpeg/FFprobe builds expose different codecs, muxers, filters, and behavior;
  a version string is never sufficient.
- yt-dlp static extractor support neither grants rights nor guarantees present
  provider behavior.
- whisper.cpp's documented interface and model catalog are upstream-main
  material and can change; recheck this record for an Electron, tool, or model
  policy upgrade.
- Electron documentation is `latest` while the repository pins `43.4.1`; check
  the pinned-version API documentation before upgrading Electron or relying on
  a newly introduced API.
