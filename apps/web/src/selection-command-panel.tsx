import type { Dispatch, SetStateAction } from "react";

import type {
  ExportPresetSnapshot,
  ExportSettingsPreview,
} from "@research-video/contracts";

const builtInPresetKey = "built-in:editing-mp4:v1";

type PresetOption = Readonly<{
  key: string;
  snapshot: ExportPresetSnapshot & { presetId: string };
  isDefault: boolean;
}>;

type SelectionCommandPanelProps = Readonly<{
  loggedPresetSelectionKey: string;
  exportOnlyPresetSelectionKey: string;
  projectPresetOptions: readonly PresetOption[];
  personalPresetOptions: readonly PresetOption[];
  presetDiscoveryMessage: string;
  loggedSettingsState: string;
  exportOnlySettingsState: string;
  loggedSettingsPreview: ExportSettingsPreview | undefined;
  exportOnlySettingsPreview: ExportSettingsPreview | undefined;
  overrideFields: Set<string>;
  selectedRendererCapabilityId: string;
  installedRendererIds: Set<string> | undefined;
  exportVideoCodec: "h264" | "hevc" | "prores";
  exportRateControlMode: "crf" | "bitrate" | "codec_default";
  exportVideoBitrate: number;
  exportCrf: number;
  exportMaxWidth: number | undefined;
  exportFrameRate: "source" | "23.976" | "24" | "25" | "29.97" | "30";
  exportAudioCodec: "aac" | "pcm_s16le";
  exportAudioBitrate: number | undefined;
  exportAudioSampleRate: "source" | "44100" | "48000";
  exportAudioChannels: "source" | "1" | "2";
  omitEnglishSubtitles: boolean;
  embedEnglishSubtitles: boolean;
  sourceLanguageClass: "confirmed_english" | "foreign";
  sourceRights: Readonly<{ youtubeVideoId: string }> | undefined;
  sourceRightsConfirmed: boolean;
  selectedVideoSnapshot: boolean;
  clipActionBusy: boolean;
  loggedClipId: string | undefined;
  loggedExportRequestId: string | undefined;
  exportOnlyRequestId: string | undefined;
  authorization: boolean;
  projectId: string;
  user: boolean;
  languageEvidenceReady: boolean;
  offlineCachedWorkspace: boolean;
  clipActionMessage: string | undefined;
  selectionError: string | undefined;
  setLoggedPresetKey: Dispatch<SetStateAction<string>>;
  setExportOnlyPresetKey: Dispatch<SetStateAction<string>>;
  setOverrideFields: Dispatch<SetStateAction<Set<string>>>;
  setExportContainer: Dispatch<SetStateAction<"mp4" | "mov" | "mkv">>;
  setExportVideoCodec: Dispatch<SetStateAction<"h264" | "hevc" | "prores">>;
  setExportAudioCodec: Dispatch<SetStateAction<"aac" | "pcm_s16le">>;
  setExportRateControlMode: Dispatch<
    SetStateAction<"crf" | "bitrate" | "codec_default">
  >;
  setExportVideoBitrate: Dispatch<SetStateAction<number>>;
  setExportCrf: Dispatch<SetStateAction<number>>;
  setExportMaxWidth: Dispatch<SetStateAction<number | undefined>>;
  setExportFrameRate: Dispatch<
    SetStateAction<"source" | "23.976" | "24" | "25" | "29.97" | "30">
  >;
  setExportAudioBitrate: Dispatch<SetStateAction<number | undefined>>;
  setExportAudioSampleRate: Dispatch<
    SetStateAction<"source" | "44100" | "48000">
  >;
  setExportAudioChannels: Dispatch<SetStateAction<"source" | "1" | "2">>;
  setOmitEnglishSubtitles: Dispatch<SetStateAction<boolean>>;
  setEmbedEnglishSubtitles: Dispatch<SetStateAction<boolean>>;
  setSourceRightsConfirmed: Dispatch<SetStateAction<boolean>>;
  queueClipOnly: () => Promise<unknown>;
  requestLoggedExport: () => Promise<void>;
  requestExportOnly: () => Promise<void>;
  copySelectionText: () => Promise<void>;
}>;

export function SelectionCommandPanel(props: SelectionCommandPanelProps) {
  const {
    loggedPresetSelectionKey,
    exportOnlyPresetSelectionKey,
    projectPresetOptions,
    personalPresetOptions,
    presetDiscoveryMessage,
    loggedSettingsState,
    exportOnlySettingsState,
    loggedSettingsPreview,
    exportOnlySettingsPreview,
    overrideFields,
    selectedRendererCapabilityId,
    installedRendererIds,
    exportVideoCodec,
    exportRateControlMode,
    exportVideoBitrate,
    exportCrf,
    exportMaxWidth,
    exportFrameRate,
    exportAudioCodec,
    exportAudioBitrate,
    exportAudioSampleRate,
    exportAudioChannels,
    omitEnglishSubtitles,
    embedEnglishSubtitles,
    sourceLanguageClass,
    sourceRights,
    sourceRightsConfirmed,
    selectedVideoSnapshot,
    clipActionBusy,
    loggedClipId,
    loggedExportRequestId,
    exportOnlyRequestId,
    authorization,
    projectId,
    user,
    languageEvidenceReady,
    offlineCachedWorkspace,
    clipActionMessage,
    selectionError,
    setLoggedPresetKey,
    setExportOnlyPresetKey,
    setOverrideFields,
    setExportContainer,
    setExportVideoCodec,
    setExportAudioCodec,
    setExportRateControlMode,
    setExportVideoBitrate,
    setExportCrf,
    setExportMaxWidth,
    setExportFrameRate,
    setExportAudioBitrate,
    setExportAudioSampleRate,
    setExportAudioChannels,
    setOmitEnglishSubtitles,
    setEmbedEnglishSubtitles,
    setSourceRightsConfirmed,
    queueClipOnly,
    requestLoggedExport,
    requestExportOnly,
    copySelectionText,
  } = props;

  return (
    <>
      <section className="preset-picker" aria-label="Conversion preset picker">
        <div className="export-settings-grid">
          <label>
            Logged export preset
            <select
              value={loggedPresetSelectionKey}
              onChange={(event) => setLoggedPresetKey(event.target.value)}
            >
              {projectPresetOptions.length ? (
                <optgroup label="Project presets">
                  {projectPresetOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.snapshot.name} v{option.snapshot.presetVersion}
                      {option.isDefault ? " — project default" : ""}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {personalPresetOptions.length ? (
                <optgroup label="Personal presets">
                  {personalPresetOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.snapshot.name} v{option.snapshot.presetVersion}
                      {option.isDefault ? " — personal default" : ""}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <option value={builtInPresetKey}>
                Editing MP4 v1 — built-in fallback
              </option>
            </select>
          </label>
          <label>
            Export-only preset
            <select
              value={exportOnlyPresetSelectionKey}
              onChange={(event) => setExportOnlyPresetKey(event.target.value)}
            >
              {personalPresetOptions.length ? (
                <optgroup label="Personal presets">
                  {personalPresetOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.snapshot.name} v{option.snapshot.presetVersion}
                      {option.isDefault ? " — personal default" : ""}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <option value={builtInPresetKey}>
                Editing MP4 v1 — built-in fallback
              </option>
            </select>
          </label>
        </div>
        <p className="form-message" role="status">
          {presetDiscoveryMessage}
        </p>
        <p className="muted">
          Logged settings: {loggedSettingsState}. Export-only settings:{" "}
          {exportOnlySettingsState}. Preset versions are resolved by the
          authoritative service and creation must match this preview.
        </p>
        {loggedSettingsPreview ? (
          <p className="muted" data-testid="logged-settings-summary">
            Logged provenance: Editing application v1
            {loggedSettingsPreview.snapshot.base === "application_default"
              ? " → application base selected"
              : loggedSettingsPreview.snapshot.contextDefault
                ? ` → project default ${loggedSettingsPreview.snapshot.contextDefault.name} v${loggedSettingsPreview.snapshot.contextDefault.presetVersion}`
                : " → no project default"}
            {loggedSettingsPreview.snapshot.selectedPreset
              ? ` → selected ${loggedSettingsPreview.snapshot.selectedPresetScope} ${loggedSettingsPreview.snapshot.selectedPreset.name} v${loggedSettingsPreview.snapshot.selectedPreset.presetVersion}`
              : " → no explicit preset"}
            {loggedSettingsPreview.snapshot.overrideFields.length
              ? ` → overrides ${loggedSettingsPreview.snapshot.overrideFields.join(", ")}`
              : " → no overrides"}
            . Effective:{" "}
            {loggedSettingsPreview.snapshot.settings.container.toUpperCase()} /{" "}
            {loggedSettingsPreview.snapshot.settings.videoCodec.toUpperCase()} /{" "}
            {loggedSettingsPreview.snapshot.settings.frameRate} fps. Sidecars:{" "}
            {loggedSettingsPreview.effectiveSubtitlePolicy.requiredSidecars.join(
              " + ",
            ) || "omitted for confidently English"}
            .
          </p>
        ) : null}
        {exportOnlySettingsPreview ? (
          <p className="muted" data-testid="export-only-settings-summary">
            Export-only provenance: Editing application v1
            {exportOnlySettingsPreview.snapshot.base === "application_default"
              ? " → application base selected"
              : exportOnlySettingsPreview.snapshot.contextDefault
                ? ` → personal default ${exportOnlySettingsPreview.snapshot.contextDefault.name} v${exportOnlySettingsPreview.snapshot.contextDefault.presetVersion}`
                : " → no personal default"}
            {exportOnlySettingsPreview.snapshot.selectedPreset
              ? ` → selected personal ${exportOnlySettingsPreview.snapshot.selectedPreset.name} v${exportOnlySettingsPreview.snapshot.selectedPreset.presetVersion}`
              : " → no explicit preset"}
            {exportOnlySettingsPreview.snapshot.overrideFields.length
              ? ` → overrides ${exportOnlySettingsPreview.snapshot.overrideFields.join(", ")}`
              : " → no overrides"}
            . Effective:{" "}
            {exportOnlySettingsPreview.snapshot.settings.container.toUpperCase()}{" "}
            /{" "}
            {exportOnlySettingsPreview.snapshot.settings.videoCodec.toUpperCase()}{" "}
            / {exportOnlySettingsPreview.snapshot.settings.frameRate} fps.
            Sidecars:{" "}
            {exportOnlySettingsPreview.effectiveSubtitlePolicy.requiredSidecars.join(
              " + ",
            ) || "omitted for confidently English"}
            .
          </p>
        ) : null}
        {[
          ...(loggedSettingsPreview?.issues ?? []),
          ...(exportOnlySettingsPreview?.issues ?? []),
        ].map((issue, index) => (
          <p
            className="form-message error"
            key={`${issue.field}:${issue.code}:${index}`}
          >
            {issue.field}: {issue.message}
          </p>
        ))}
      </section>
      <details className="export-settings-panel">
        <summary>Per-export overrides</summary>
        <p className="muted">
          {overrideFields.size
            ? `Overrides: ${[...overrideFields].join(", ")}`
            : "No overrides; the resolved base is used unchanged."}
          {overrideFields.size ? (
            <button
              type="button"
              className="handle-button"
              onClick={() => setOverrideFields(new Set())}
            >
              Reset all overrides
            </button>
          ) : null}
        </p>
        <div className="export-settings-grid">
          <label>
            Rendering family
            <select
              value={selectedRendererCapabilityId}
              onChange={(event) => {
                const rendererCapabilityId = event.target.value;
                setOverrideFields(
                  (current) =>
                    new Set([
                      ...current,
                      "container",
                      "videoCodec",
                      "videoRateControl",
                      "audioCodec",
                      "audioKilobitsPerSecond",
                    ]),
                );
                if (rendererCapabilityId === "h264_mp4") {
                  setExportContainer("mp4");
                  setExportVideoCodec("h264");
                  setExportAudioCodec("aac");
                  if (exportRateControlMode === "codec_default")
                    setExportRateControlMode("crf");
                  return;
                }
                if (rendererCapabilityId === "hevc_mkv") {
                  setExportContainer("mkv");
                  setExportVideoCodec("hevc");
                  setExportAudioCodec("aac");
                  if (exportRateControlMode === "codec_default")
                    setExportRateControlMode("crf");
                  return;
                }
                setExportContainer("mov");
                setExportVideoCodec("prores");
                setExportAudioCodec("pcm_s16le");
                setExportRateControlMode("codec_default");
                setExportAudioBitrate(undefined);
              }}
            >
              <option value="h264_mp4">
                MP4 · H.264 High · AAC
                {installedRendererIds && !installedRendererIds.has("h264_mp4")
                  ? " — unavailable for local export-only"
                  : ""}
              </option>
              <option value="hevc_mkv">
                MKV · HEVC Main · AAC
                {installedRendererIds && !installedRendererIds.has("hevc_mkv")
                  ? " — unavailable for local export-only"
                  : ""}
              </option>
              <option value="prores_mov">
                MOV · ProRes 422 · PCM
                {installedRendererIds && !installedRendererIds.has("prores_mov")
                  ? " — unavailable for local export-only"
                  : ""}
              </option>
            </select>
          </label>
          <label>
            Rate control
            <select
              value={exportRateControlMode}
              disabled={exportVideoCodec === "prores"}
              onChange={(event) => {
                setOverrideFields((current) =>
                  new Set(current).add("videoRateControl"),
                );
                setExportRateControlMode(
                  event.target.value as "crf" | "bitrate",
                );
              }}
            >
              {exportVideoCodec === "prores" ? (
                <option value="codec_default">Codec fixed</option>
              ) : (
                <>
                  <option value="crf">CRF</option>
                  <option value="bitrate">Target bitrate</option>
                </>
              )}
            </select>
          </label>
          <label>
            {exportRateControlMode === "bitrate"
              ? "Video bitrate (kbps)"
              : exportRateControlMode === "crf"
                ? "Quality (CRF)"
                : "Codec profile"}
            <input
              type="number"
              min={exportRateControlMode === "bitrate" ? 500 : 0}
              max={exportRateControlMode === "bitrate" ? 200_000 : 51}
              disabled={exportRateControlMode === "codec_default"}
              value={
                exportRateControlMode === "bitrate"
                  ? exportVideoBitrate
                  : exportRateControlMode === "crf"
                    ? exportCrf
                    : ""
              }
              placeholder="ProRes 422"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isInteger(value)) return;
                if (
                  exportRateControlMode === "crf" &&
                  value >= 0 &&
                  value <= 51
                )
                  setExportCrf(value);
                if (
                  exportRateControlMode === "bitrate" &&
                  value >= 500 &&
                  value <= 200_000
                )
                  setExportVideoBitrate(value);
                setOverrideFields((current) =>
                  new Set(current).add("videoRateControl"),
                );
              }}
            />
          </label>
          <label>
            Maximum width
            <select
              value={exportMaxWidth ?? "source"}
              onChange={(event) => {
                setOverrideFields((current) =>
                  new Set(current).add("maxWidth"),
                );
                if (event.target.value === "source") {
                  setExportMaxWidth(undefined);
                  return;
                }
                setExportMaxWidth(Number(event.target.value));
              }}
            >
              <option value="source">Source</option>
              <option value="640">640</option>
              <option value="1280">1280</option>
              <option value="1920">1920</option>
              <option value="3840">3840</option>
            </select>
          </label>
          <label>
            Frame rate
            <select
              value={exportFrameRate}
              onChange={(event) => (
                setOverrideFields((current) =>
                  new Set(current).add("frameRate"),
                ),
                setExportFrameRate(
                  event.target.value as
                    "source" | "23.976" | "24" | "25" | "29.97" | "30",
                )
              )}
            >
              <option value="source">Source</option>
              <option value="23.976">23.976</option>
              <option value="24">24</option>
              <option value="25">25</option>
              <option value="29.97">29.97</option>
              <option value="30">30</option>
            </select>
          </label>
          <label>
            {exportAudioCodec === "aac"
              ? "AAC audio (kbps)"
              : "PCM audio bitrate"}
            <select
              value={exportAudioBitrate ?? "default"}
              disabled={exportAudioCodec !== "aac"}
              onChange={(event) => {
                setOverrideFields((current) =>
                  new Set(current).add("audioKilobitsPerSecond"),
                );
                if (event.target.value === "default") {
                  setExportAudioBitrate(undefined);
                  return;
                }
                setExportAudioBitrate(Number(event.target.value));
              }}
            >
              {exportAudioCodec === "aac" ? (
                <>
                  <option value="default">Adapter default</option>
                  <option value="96">96</option>
                  <option value="128">128</option>
                  <option value="192">192</option>
                  <option value="256">256</option>
                  <option value="320">320</option>
                </>
              ) : (
                <option value="default">Not applicable</option>
              )}
            </select>
          </label>
          <label>
            Audio sample rate
            <select
              value={exportAudioSampleRate}
              onChange={(event) => {
                setOverrideFields((current) =>
                  new Set(current).add("audioSampleRate"),
                );
                setExportAudioSampleRate(
                  event.target.value as "source" | "44100" | "48000",
                );
              }}
            >
              <option value="source">Source</option>
              <option value="44100">44.1 kHz</option>
              <option value="48000">48 kHz</option>
            </select>
          </label>
          <label>
            Audio channels
            <select
              value={exportAudioChannels}
              onChange={(event) => {
                setOverrideFields((current) =>
                  new Set(current).add("audioChannels"),
                );
                setExportAudioChannels(
                  event.target.value as "source" | "1" | "2",
                );
              }}
            >
              <option value="source">Source</option>
              <option value="1">Mono</option>
              <option value="2">Stereo</option>
            </select>
          </label>
        </div>
        {installedRendererIds ? (
          <p className="muted">
            Export-only availability reflects this local worker. Logged export
            availability remains canonical until a worker is registered for
            delivery.
          </p>
        ) : null}
        <label className="export-checkbox">
          <input
            type="checkbox"
            checked={omitEnglishSubtitles}
            disabled={sourceLanguageClass !== "confirmed_english"}
            onChange={(event) => {
              setOverrideFields((current) =>
                new Set(current).add("omitSubtitleFilesForConfirmedEnglish"),
              );
              setOmitEnglishSubtitles(event.target.checked);
            }}
          />
          Omit subtitle files for confirmed-English videos
        </label>
        {sourceLanguageClass !== "confirmed_english" ? (
          <p className="muted">
            Omission is ineligible here: foreign, mixed, and unknown sources
            always require original + English sidecars. A saved true preference
            remains inert in the immutable settings.
          </p>
        ) : null}
        <label className="export-checkbox">
          <input
            type="checkbox"
            checked={embedEnglishSubtitles}
            disabled={exportOnlySettingsState !== "ready"}
            onChange={(event) => {
              setOverrideFields((current) =>
                new Set(current).add("embedEnglishSubtitleTrack"),
              );
              setEmbedEnglishSubtitles(event.target.checked);
            }}
          />
          Embed an English soft-subtitle track
        </label>
        {exportOnlySettingsState !== "ready" ? (
          <p className="muted">
            Resolve an eligible local renderer before enabling English soft
            subtitles.
          </p>
        ) : null}
      </details>
      <p className="muted">
        Export source: YouTube video ID{" "}
        {sourceRights?.youtubeVideoId ?? "unavailable"}
      </p>
      <label className="export-checkbox">
        <input
          type="checkbox"
          checked={sourceRightsConfirmed}
          disabled={!selectedVideoSnapshot}
          onChange={(event) => setSourceRightsConfirmed(event.target.checked)}
        />
        I confirm I am authorized to process this exact YouTube source for
        export.
      </label>
      <div className="selection-actions">
        <button
          type="button"
          className="primary-action"
          disabled={
            clipActionBusy ||
            Boolean(loggedClipId) ||
            !authorization ||
            !projectId ||
            !user ||
            !selectedVideoSnapshot ||
            !languageEvidenceReady ||
            offlineCachedWorkspace
          }
          onClick={() => void queueClipOnly()}
        >
          {loggedClipId ? "Logged" : "Queue / log only"}
        </button>
        <button
          type="button"
          disabled={
            clipActionBusy ||
            Boolean(loggedExportRequestId) ||
            !authorization ||
            !projectId ||
            !user ||
            !selectedVideoSnapshot ||
            !languageEvidenceReady ||
            offlineCachedWorkspace ||
            !sourceRightsConfirmed ||
            loggedSettingsState !== "ready"
          }
          onClick={() => void requestLoggedExport()}
        >
          {loggedExportRequestId ? "Export queued" : "Export + log"}
        </button>
        <button
          type="button"
          disabled={
            clipActionBusy ||
            Boolean(exportOnlyRequestId) ||
            !selectedVideoSnapshot ||
            !sourceRightsConfirmed ||
            exportOnlySettingsState !== "ready"
          }
          onClick={() => void requestExportOnly()}
        >
          {exportOnlyRequestId ? "Export-only queued" : "Export only"}
        </button>
        <button type="button" onClick={() => void copySelectionText()}>
          Copy
        </button>
      </div>
      <span className="selection-action-help">
        Queue-only starts no media work. Export-only creates no project research
        record.
      </span>
      <p className="form-message" role="status">
        {clipActionMessage ??
          (!projectId
            ? "Choose a visible project before logging this selection."
            : "Ready to log this selection without exporting it.")}
      </p>
      <p className={selectionError ? "form-message error" : "form-message"}>
        {selectionError ??
          "Export padding is adjustable; the transcript selection remains unchanged."}
      </p>
    </>
  );
}
