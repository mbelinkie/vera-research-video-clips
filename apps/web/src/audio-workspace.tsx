import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import {
  AudioAssetManifestSchema,
  AudioFileImportSchema,
  AudioRoleSchema,
  AudioSpeechTranscriptSchema,
  AudioUrlImportSchema,
  CreateItemRequestSchema,
  LibraryItemSchema,
  LibrarySourceSchema,
  MaxAudioBytes,
  type LibrarySource,
} from "@research-video/contracts";
import {
  deriveTranscriptSelection,
  normalizeGeneratedTranscript,
  type TranscriptSelectionBoundary,
} from "@research-video/transcript";
import {
  AudioPlayer,
  audioRoles,
  audioTime,
  type AudioRange,
  type AudioRole,
} from "./audio-player.tsx";
import { prepareLocalAudio } from "./audio-waveform.ts";
import {
  researchError,
  useResearchMutation,
  useResearchRead,
} from "./research-catalog.tsx";
import {
  jsonWrite,
  listItems,
  projectPath,
  readResearch,
  ResearchRequestError,
  verifyItem,
  verifySource,
  type ResearchRequest,
} from "./research-library-data.ts";
import { VirtualTranscript } from "./virtual-transcript.tsx";

const acceptAudio = "audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm";

async function originalChecksum(file: File) {
  if (file.size === 0 || file.size > MaxAudioBytes)
    throw new Error("Select a nonempty audio file of 50 MiB or less.");
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function previewBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]!);
    reader.onerror = () =>
      reject(new Error("The audio preview could not be read."));
    reader.readAsDataURL(blob);
  });
}

function RoleField({
  value,
  label,
  onChange,
  disabled,
}: {
  value: AudioRole | "";
  label: string;
  onChange(value: AudioRole | ""): void;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value ? AudioRoleSchema.parse(event.target.value) : "",
          )
        }
        disabled={disabled}
      >
        <option value="">No role</option>
        {Object.entries(audioRoles).map(([role, title]) => (
          <option key={role} value={role}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AudioIntake({
  request,
  projectId,
  mode,
  onCreated,
  onCancel,
}: {
  request: ResearchRequest;
  projectId: string;
  mode: "file" | "url";
  onCreated(sourceId: string, file?: File): void;
  onCancel(): void;
}) {
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<AudioRole | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const write = useResearchMutation();
  const key = useRef(crypto.randomUUID());

  async function save(event: FormEvent) {
    event.preventDefault();
    if (write.current) return;
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setError("");
    try {
      const fields = {
        title: title.trim(),
        role: role || undefined,
        idempotencyKey: key.current,
      };
      let input;
      if (mode === "file" && file) {
        const originalSha256 = await originalChecksum(file);
        const { preview, ...analysis } = await prepareLocalAudio(file);
        input = AudioFileImportSchema.parse({
          ...fields,
          ...analysis,
          originalSha256,
          previewBase64: await previewBase64(preview),
        });
      } else {
        input = AudioUrlImportSchema.parse({ ...fields, url: url.trim() });
      }
      controller.signal.throwIfAborted();
      const source = verifySource(
        await readResearch(
          request,
          `${projectPath(projectId)}/audio/from-${mode}`,
          LibrarySourceSchema,
          { ...jsonWrite("POST", input), signal: controller.signal },
        ),
        projectId,
      );
      if (!controller.signal.aborted) onCreated(source.id, file);
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(
          researchError(
            caught,
            "Check the audio address and source name, then try again.",
          ),
        );
    } finally {
      write.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const changed = () => {
    key.current = crypto.randomUUID();
  };
  return (
    <form
      className="research-detail research-intake audio-form"
      onSubmit={(event) => void save(event)}
    >
      {mode === "file" ? (
        <>
          <label>
            Audio file
            <input
              required
              type="file"
              accept={acceptAudio}
              disabled={busy}
              onChange={(event) => {
                const selected = event.currentTarget.files?.[0];
                setFile(selected);
                setTitle(
                  selected?.name.replace(/\.[^.]+$/u, "").slice(0, 500) ?? "",
                );
                changed();
              }}
            />
          </label>
          <p>
            Research shares a short preview and waveform. The original stays on
            this device.
          </p>
        </>
      ) : (
        <label>
          Audio URL
          <input
            type="url"
            required
            value={url}
            disabled={busy}
            onChange={(event) => {
              setUrl(event.target.value);
              changed();
            }}
          />
        </label>
      )}
      <label>
        Source name{" "}
        <input
          required
          maxLength={500}
          value={title}
          disabled={busy}
          onChange={(event) => {
            setTitle(event.target.value);
            changed();
          }}
        />
      </label>
      <RoleField
        label="Source role"
        value={role}
        onChange={(value) => {
          setRole(value);
          changed();
        }}
        disabled={busy}
      />
      <div className="research-toolbar">
        <button type="submit" disabled={busy}>
          {busy ? "Adding audio…" : "Add audio"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

const transcriptResponse = z.object({
  transcript: AudioSpeechTranscriptSchema.nullable(),
});
const itemPageSize = 30;
type Selection = AudioRange & { text?: string | undefined };

export function AudioWorkspace({
  request,
  source,
  canWrite,
  localSpeech,
  file,
  onRelinked,
  onSourceChange,
  onLogged,
}: {
  request: ResearchRequest;
  source: LibrarySource;
  canWrite: boolean;
  localSpeech: boolean;
  file: File | undefined;
  onRelinked(file: File): void;
  onSourceChange(source: LibrarySource): void;
  onLogged(): void;
}) {
  const { id, projectId } = source;
  const sourceRole = AudioRoleSchema.safeParse(
    "role" in source.details ? source.details.role : undefined,
  ).data;
  const project = projectPath(projectId);
  const path = `${project}/audio/${id}`;
  const transcriptPath = `${path}/transcript`;
  const player = useRef<HTMLAudioElement>(null);
  const key = useRef(crypto.randomUUID());
  const topicsList = useId();
  const wordAnchor = useRef<TranscriptSelectionBoundary | undefined>(undefined);
  const [range, setRange] = useState<Selection>();
  const [name, setName] = useState("");
  const [role, setRole] = useState<AudioRole | "">();
  const [topics, setTopics] = useState("");
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [transcriptRefresh, setTranscriptRefresh] = useState(0);
  const [sourceRetry, setSourceRetry] = useState(0);
  const [relinkError, setRelinkError] = useState("");
  const [relinking, setRelinking] = useState(false);
  const [busy, setBusy] = useState<"save" | "role" | "speech">();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const write = useResearchMutation();
  const relinkRequest = useResearchMutation();
  const loadManifest = useCallback(
    (signal: AbortSignal) =>
      readResearch(request, path, AudioAssetManifestSchema, { signal }),
    [request, path],
  );
  const { data: manifest, error: manifestError } = useResearchRead(
    loadManifest,
    true,
    sourceRetry,
  );
  const readTranscript = useCallback(
    async (signal: AbortSignal) => {
      const { transcript } = await readResearch(
        request,
        transcriptPath,
        transcriptResponse,
        { signal },
      );
      return transcript
        ? normalizeGeneratedTranscript({
            videoId: id,
            language: transcript.language,
            model: transcript.model,
            provider: "whisper.cpp",
            segments: transcript.segments,
          })
        : null;
    },
    [id, request, transcriptPath],
  );
  const transcript = useResearchRead(
    readTranscript,
    Boolean(manifest),
    transcriptRefresh,
  );
  const loadSelections = useCallback(
    (signal: AbortSignal) =>
      listItems(
        request,
        projectId,
        new URLSearchParams({
          kind: "audio",
          sourceId: id,
          limit: String(itemPageSize),
          offset: String(page * itemPageSize),
        }),
        signal,
      ),
    [id, page, projectId, request],
  );
  const selections = useResearchRead(loadSelections, true, refresh);
  const loadTopics = useCallback(
    (signal: AbortSignal) =>
      readResearch(request, `${project}/clip-tags`, z.array(z.string()), {
        signal,
      }),
    [project, request],
  );
  const { data: existingTopics } = useResearchRead(
    loadTopics,
    canWrite,
    refresh,
  );

  function editRange(next: Selection) {
    key.current = crypto.randomUUID();
    setRange(next);
  }
  const selection = range ?? { startMs: 0, endMs: manifest?.durationMs ?? 0 };
  async function relink(selected: File) {
    if (manifest?.origin.kind !== "file" || relinkRequest.current) return;
    const controller = new AbortController();
    relinkRequest.current = controller;
    setRelinkError("");
    setRelinking(true);
    try {
      if ((await originalChecksum(selected)) !== manifest.origin.originalSha256)
        throw new Error("This file does not match the original recording.");
      if (!controller.signal.aborted) onRelinked(selected);
    } catch (caught) {
      if (!controller.signal.aborted)
        setRelinkError(
          researchError(caught, "The original could not be relinked."),
        );
    } finally {
      relinkRequest.current = null;
      if (!controller.signal.aborted) setRelinking(false);
    }
  }

  async function mutate(
    action: "save" | "role" | "speech",
    work: (signal: AbortSignal) => Promise<void>,
  ) {
    if (write.current) return;
    const controller = new AbortController();
    write.current = controller;
    setBusy(action);
    setError("");
    setMessage("");
    try {
      await work(controller.signal);
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(researchError(caught, "Check the selection and try again."));
    } finally {
      write.current = null;
      if (!controller.signal.aborted) setBusy(undefined);
    }
  }

  function transcribe() {
    if (!manifest) return;
    void mutate("speech", async (signal) => {
      let input:
        | { mode: "url" }
        | {
            mode: "file" | "kept_audio";
            transcript: z.infer<typeof AudioSpeechTranscriptSchema>;
          } = { mode: "url" };
      if (localSpeech) {
        const fileOrigin = manifest.origin.kind === "file";
        let original: Blob | undefined = file;
        if (!fileOrigin) {
          const response = await request(`${path}/playback`, { signal });
          if (!response.ok) throw new Error("The kept audio is unavailable.");
          original = await response.blob();
        }
        if (!original) return;
        try {
          input = {
            mode: fileOrigin ? "file" : "kept_audio",
            transcript: await readResearch(
              request,
              transcriptPath,
              AudioSpeechTranscriptSchema,
              {
                method: "POST",
                headers: { "content-type": "application/octet-stream" },
                body: original,
                signal,
              },
              "local",
            ),
          };
        } catch (error) {
          if (
            fileOrigin ||
            !(error instanceof ResearchRequestError) ||
            error.status !== 503
          )
            throw error;
        }
      } else if (manifest.origin.kind === "file") {
        return;
      }
      signal.throwIfAborted();
      await readResearch(request, transcriptPath, AudioSpeechTranscriptSchema, {
        ...jsonWrite("POST", input),
        signal,
      });
      if (!signal.aborted) setTranscriptRefresh((value) => value + 1);
    });
  }

  function seek(ms: number) {
    if (
      player.current &&
      manifest &&
      ms <= (file ? manifest.durationMs : manifest.playbackDurationMs)
    ) {
      player.current.currentTime = ms / 1000;
    }
  }
  function selectWords(
    anchor: TranscriptSelectionBoundary,
    focus: TranscriptSelectionBoundary,
  ) {
    if (!transcript.data || !manifest) return;
    const passage = deriveTranscriptSelection({
      transcript: transcript.data,
      anchor,
      focus,
      sourceDurationMs: manifest.durationMs,
    });
    editRange({
      startMs: passage.exportStartMs,
      endMs: passage.exportEndMs,
      text: passage.text,
    });
    setRole("speech");
    seek(passage.exportStartMs);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void mutate("save", async (signal) => {
      const result = CreateItemRequestSchema.safeParse({
        kind: "audio",
        sourceId: id,
        idempotencyKey: key.current,
        content: {
          title: name.trim(),
          ...selection,
          role: (role ?? sourceRole) || undefined,
        },
        topics: topics
          .split(",")
          .map((topic) => topic.trim())
          .filter(Boolean),
      });
      if (!manifest || !result.success || selection.endMs > manifest.durationMs)
        throw new Error(
          "Enter a name, valid in and out points, and Topics of up to 80 characters.",
        );
      verifyItem(
        await readResearch(request, `${project}/items`, LibraryItemSchema, {
          ...jsonWrite("POST", result.data),
          signal,
        }),
        projectId,
        id,
      );
      if (signal.aborted) return;
      key.current = crypto.randomUUID();
      setName("");
      setPage(0);
      setRefresh((value) => value + 1);
      setMessage("Audio selection saved.");
      onLogged();
    });
  }

  const validRange =
    selection.startMs >= 0 &&
    selection.startMs < selection.endMs &&
    selection.endMs <= (manifest?.durationMs ?? 0);
  return (
    <section
      className="research-detail audio-workspace"
      aria-label="Audio workspace"
    >
      {!manifest &&
        (manifestError ? (
          <p role="alert">
            {manifestError}{" "}
            <button
              type="button"
              onClick={() => setSourceRetry(sourceRetry + 1)}
            >
              Try again
            </button>
          </p>
        ) : (
          <p role="status">Loading waveform…</p>
        ))}
      {manifest && (
        <>
          <AudioPlayer
            request={request}
            path={path}
            manifest={manifest}
            player={player}
            file={file}
            range={validRange ? selection : undefined}
          />
          {manifest.origin.kind === "file" && (
            <>
              <label>
                {file ? "Relink original again" : "Relink original"}
                <input
                  type="file"
                  accept={acceptAudio}
                  disabled={relinking || Boolean(busy)}
                  onChange={(event) => {
                    const original = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (original) void relink(original);
                  }}
                />
              </label>
              {file && <p className="muted">Original linked on this device.</p>}
              {relinking && <p role="status">Verifying original…</p>}
              {relinkError && <p role="alert">{relinkError}</p>}
            </>
          )}
          {canWrite && (
            <RoleField
              label="Source role"
              value={sourceRole ?? ""}
              disabled={Boolean(busy)}
              onChange={(value) => {
                void mutate("role", async (signal) => {
                  const updated = verifySource(
                    await readResearch(
                      request,
                      `${project}/sources/${id}`,
                      LibrarySourceSchema,
                      {
                        ...jsonWrite("PATCH", {
                          expectedVersion: source.version,
                          details: {
                            ...source.details,
                            role: value || undefined,
                          },
                        }),
                        signal,
                      },
                    ),
                    projectId,
                    id,
                  );
                  if (!signal.aborted) onSourceChange(updated);
                });
              }}
            />
          )}
          {(sourceRole === "speech" || transcript.data) && (
            <section aria-label="Speech transcript" className="audio-speech">
              <h3>Speech transcript</h3>
              {transcript.error && (
                <p role="alert">
                  {transcript.error}{" "}
                  <button
                    type="button"
                    onClick={() => setTranscriptRefresh(transcriptRefresh + 1)}
                  >
                    Try again
                  </button>
                </p>
              )}
              {transcript.data ? (
                <>
                  <p className="muted">
                    Approximate cue timing. Click a word, then Shift-click
                    another to select a passage. Adjust in and out as needed.
                  </p>
                  <VirtualTranscript
                    segments={transcript.data.segments}
                    tokens={transcript.data.tokens}
                    follow={false}
                    wrapCues
                    {...(canWrite
                      ? {
                          onWordSelect: (
                            word: TranscriptSelectionBoundary,
                            extend: boolean,
                          ) => {
                            if (!extend || !wordAnchor.current)
                              wordAnchor.current = word;
                            selectWords(wordAnchor.current, word);
                          },
                        }
                      : {})}
                    onFollowSuspended={() => {}}
                    onSeek={seek}
                    onSelect={canWrite ? selectWords : () => {}}
                  />
                </>
              ) : (
                transcript.loaded &&
                canWrite &&
                (manifest.origin.kind === "file" && !localSpeech ? (
                  <p>
                    Open this source in Research on your workstation to
                    transcribe the original.
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={
                      Boolean(busy) ||
                      (manifest.origin.kind === "file" && !file)
                    }
                    onClick={transcribe}
                  >
                    {busy === "speech"
                      ? "Transcribing…"
                      : "Transcribe speech and share with project"}
                  </button>
                ))
              )}
              {transcript.loaded && !transcript.data && !canWrite && (
                <p>No transcript yet.</p>
              )}
            </section>
          )}
          {canWrite && (
            <form className="audio-form" onSubmit={save}>
              <h3>New audio selection</h3>
              <label>
                Selection name{" "}
                <input
                  required
                  maxLength={500}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    key.current = crypto.randomUUID();
                  }}
                />
              </label>
              <div className="audio-bounds">
                {(["startMs", "endMs"] as const).map((bound, index) => (
                  <div key={bound}>
                    <label>
                      {index ? "Out (seconds)" : "In (seconds)"}
                      <input
                        type="number"
                        min="0"
                        max={manifest.durationMs / 1000}
                        step="0.001"
                        required
                        value={
                          Number.isNaN(selection[bound])
                            ? ""
                            : selection[bound] / 1000
                        }
                        onChange={(event) =>
                          editRange({
                            ...selection,
                            [bound]: Math.round(
                              event.target.valueAsNumber * 1000,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const audio = player.current;
                        if (audio && audio.readyState > 0)
                          editRange({
                            ...selection,
                            [bound]: Math.min(
                              manifest.durationMs,
                              Math.round(audio.currentTime * 1000),
                            ),
                          });
                      }}
                    >
                      {index ? "Set out from player" : "Set in from player"}
                    </button>
                  </div>
                ))}
              </div>
              {selection.text && <blockquote>{selection.text}</blockquote>}
              <RoleField
                label="Selection role"
                value={role ?? sourceRole ?? ""}
                onChange={(value) => {
                  setRole(value);
                  key.current = crypto.randomUUID();
                }}
              />
              <label>
                Topics (comma-separated)
                <input
                  value={topics}
                  list={topicsList}
                  onChange={(event) => {
                    setTopics(event.target.value);
                    key.current = crypto.randomUUID();
                  }}
                />
                <datalist id={topicsList}>
                  {existingTopics?.map((topic) => (
                    <option key={topic} value={topic} />
                  ))}
                </datalist>
              </label>
              <button type="submit" disabled={Boolean(busy) || !validRange}>
                {busy === "save" ? "Saving…" : "Save selection"}
              </button>
            </form>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <section aria-label="Saved audio selections">
        <h3>Saved selections</h3>
        {selections.error && (
          <p role="alert">
            {selections.error}{" "}
            <button type="button" onClick={() => setRefresh(refresh + 1)}>
              Try again
            </button>
          </p>
        )}
        {selections.data?.length === 0 && (
          <p className="muted">No selections yet.</p>
        )}
        {Boolean(selections.data?.length) && (
          <ul className="audio-selections">
            {selections.data?.map(
              (item) =>
                item.kind === "audio" && (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        editRange({
                          startMs: item.content.startMs,
                          endMs: item.content.endMs,
                          text: item.content.text,
                        });
                        seek(item.content.startMs);
                      }}
                    >
                      {item.content.title ?? "Audio selection"}
                    </button>
                    <span>
                      {audioTime(item.content.startMs)}–
                      {audioTime(item.content.endMs)}
                      {item.content.role
                        ? ` · ${audioRoles[item.content.role]}`
                        : ""}
                    </span>
                    {item.content.text && <p>{item.content.text}</p>}
                    {item.topics.length > 0 && (
                      <p className="research-topics">
                        {item.topics.join(" · ")}
                      </p>
                    )}
                  </li>
                ),
            )}
          </ul>
        )}
        {(page > 0 || selections.data?.length === itemPageSize) && (
          <div className="research-pagination">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              type="button"
              disabled={
                selections.data?.length !== itemPageSize || page >= 3333
              }
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
