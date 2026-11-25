import {
  languagesEquivalent,
  type ClipSelection,
  type NormalizedTranscript,
  type TranscriptSelection,
} from "@research-video/contracts";
import { buildClipLanguageEvidence } from "@research-video/transcript";

/** The transcript evidence a clip selection carries, if any. */
export function transcriptEvidenceSelection(
  selection: ClipSelection | undefined,
): TranscriptSelection | undefined {
  if (!selection) return undefined;
  return selection.selectionType === "player_time_range"
    ? selection.transcriptAttachment
    : selection;
}

/**
 * Hosted browser sessions load only the published English track. Exact
 * language evidence is therefore available when that track is also the native
 * track (English-native video). Translated English tracks need the native
 * track, which the hosted API does not serve, so they are reported unavailable.
 */
export function hostedNativeEnglishTrack(
  transcript: NormalizedTranscript | undefined,
): NormalizedTranscript | undefined {
  if (
    !transcript ||
    transcript.track.sourceTrackId ||
    !languagesEquivalent(transcript.track.language, "en")
  )
    return undefined;
  return transcript;
}

export function hostedClipLanguageEvidence(
  transcript: NormalizedTranscript,
  evidence: TranscriptSelection,
) {
  return buildClipLanguageEvidence({
    original: transcript,
    english: transcript,
    startMs: evidence.transcriptStartMs,
    endMs: evidence.transcriptEndMs,
  });
}
