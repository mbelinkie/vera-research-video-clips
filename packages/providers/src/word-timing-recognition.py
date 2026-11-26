#!/usr/bin/env python3
"""Build a shared Timeline recognition artifact from locally recognised words."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import wave
from pathlib import Path
from typing import Any


LANGUAGE_TAG = re.compile(r"[a-z]{2,3}(-[A-Za-z0-9]{2,8})*")
INPUT_FIELDS = {"language", "provider", "model", "tokens"}
TOKEN_FIELDS = {"display", "startMs", "endMs"}


class InvalidArguments(Exception):
    """Raised without echoing command arguments that may contain private paths."""


class SanitizedArgumentParser(argparse.ArgumentParser):
    def error(self, _message: str) -> None:
        raise InvalidArguments


def _parser() -> argparse.ArgumentParser:
    parser = SanitizedArgumentParser(
        prog="word-timing-recognition",
        description="Create a recognition artifact from local speech output.",
    )
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    return parser


def _read_input(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError from error

    if not isinstance(payload, dict) or set(payload) != INPUT_FIELDS:
        raise ValueError

    language = payload["language"]
    provider = payload["provider"]
    model = payload["model"]
    tokens = payload["tokens"]
    if (
        not isinstance(language, str)
        or LANGUAGE_TAG.fullmatch(language) is None
        or not isinstance(provider, str)
        or not provider.strip()
        or not isinstance(model, str)
        or not model.strip()
        or not isinstance(tokens, list)
    ):
        raise ValueError

    checked_tokens: list[dict[str, Any]] = []
    for token in tokens:
        if not isinstance(token, dict) or set(token) != TOKEN_FIELDS:
            raise ValueError
        display = token["display"]
        start_ms = token["startMs"]
        end_ms = token["endMs"]
        if (
            not isinstance(display, str)
            or not display.strip()
            or isinstance(start_ms, bool)
            or not isinstance(start_ms, int)
            or isinstance(end_ms, bool)
            or not isinstance(end_ms, int)
            or start_ms < 0
            or end_ms <= start_ms
        ):
            raise ValueError
        checked_tokens.append(
            {
                "display": display,
                "startMs": start_ms,
                "endMs": end_ms,
            }
        )

    return {
        "language": language,
        "provider": provider.strip(),
        "model": model.strip(),
        "tokens": checked_tokens,
    }


def _audio_ref(path: Path) -> Any:
    from vera_word_timing.artifacts import AudioRef, file_hash

    try:
        with wave.open(str(path), "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            sample_rate = source.getframerate()
            duration_samples = source.getnframes()
    except (OSError, EOFError, wave.Error) as error:
        raise ValueError from error

    if (
        channels != 1
        or sample_width != 2
        or sample_rate != 16_000
        or duration_samples <= 0
    ):
        raise ValueError

    return AudioRef(
        path=path,
        original_hash=file_hash(path),
        sample_rate=sample_rate,
        duration_samples=duration_samples,
    )


def _build_artifact(audio_path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    from vera_word_timing.artifacts import (
        RecognizerInfo,
        Token,
        recognition_artifact,
        schema_errors,
    )

    audio = _audio_ref(audio_path)
    duration_ms = (
        audio.duration_samples * 1_000 + audio.sample_rate // 2
    ) // audio.sample_rate
    tokens = []
    for item in payload["tokens"]:
        if item["endMs"] > duration_ms:
            raise ValueError
        tokens.append(
            Token(
                item["display"],
                "word",
                item["startMs"] / 1_000,
                item["endMs"] / 1_000,
                "segment",
            )
        )

    artifact = recognition_artifact(
        audio,
        RecognizerInfo(
            "asr-local",
            payload["provider"],
            payload["model"],
            None,
        ),
        tokens,
        language=payload["language"],
        consent_policy=None,
    )
    if schema_errors(artifact):
        raise ValueError
    return artifact


def _write_output(path: Path, artifact: dict[str, Any]) -> None:
    temporary_path: Path | None = None
    try:
        encoded = json.dumps(artifact, ensure_ascii=False, indent=2) + "\n"
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=".recognition-",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(encoded)
        os.replace(temporary_path, path)
    except OSError as error:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise ValueError from error


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        output_path = args.out.resolve()
        if output_path in (args.audio.resolve(), args.input.resolve()):
            raise ValueError
        payload = _read_input(args.input)
        artifact = _build_artifact(args.audio, payload)
        _write_output(args.out, artifact)
    except Exception:
        print(
            "Could not create the local speech recognition artifact.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
