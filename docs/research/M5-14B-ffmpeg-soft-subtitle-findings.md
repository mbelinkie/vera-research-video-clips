# M5-14B FFmpeg soft-subtitle findings

Verified 2026-08-20 against the installed FFmpeg 8.1.2/FFprobe 8.1.2 tools.

- FFmpeg documents MP4 and MOV as MOV/ISOBMFF-family muxers and documents
  per-stream metadata and disposition options in the [ffmpeg manual](https://ffmpeg.org/ffmpeg.html).
- The [codec documentation](https://ffmpeg.org/ffmpeg-codecs.html) identifies
  `mov_text` as 3GPP Timed Text. The [Matroska muxer mapping](https://ffmpeg.org/ffmpeg-formats.html#matroska) maps `S_TEXT/UTF8` to SubRip.
- Local discovery reported the `mov_text`, `srt`, and `subrip` encoders plus
  `mp4`, `mov`, and `matroska` muxers. The renderer therefore uses only the
  fixed mapping: MP4/MOV `mov_text`; MKV `srt` (FFprobe observes `subrip`).

No ambient codec is selected dynamically. Discovery only decides whether the
fixed selected mapping is eligible before source acquisition.
