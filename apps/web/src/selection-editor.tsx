import type { ReactNode } from "react";

import type {
  ProjectSummary,
  TranscriptSelection,
} from "@research-video/contracts";

function formatPreciseTime(milliseconds: number) {
  return `${(milliseconds / 1_000).toFixed(3)}s`;
}

type SelectionEditorProps = Readonly<{
  selection: TranscriptSelection;
  currentMs: number;
  authorizationAvailable: boolean;
  projects: readonly ProjectSummary[];
  projectId: string;
  creatingProject: boolean;
  newProjectName: string;
  newProjectDescription: string;
  newProjectKind: "personal" | "shared";
  projectBusy: boolean;
  projectMessage: string | undefined;
  clipNotes: string;
  clipTags: string;
  logged: boolean;
  previewingSelection: boolean;
  commandPanel: ReactNode;
  onClear: () => void;
  onCreatingProjectChange: (creating: boolean) => void;
  onProjectChange: (projectId: string) => void;
  onNewProjectNameChange: (name: string) => void;
  onNewProjectDescriptionChange: (description: string) => void;
  onNewProjectKindChange: (kind: "personal" | "shared") => void;
  onCreateProject: () => void;
  onClipNotesChange: (notes: string) => void;
  onClipTagsChange: (tags: string) => void;
  onExportBoundChange: (bound: "start" | "end", value: string) => void;
  onTogglePreview: () => void;
  onAddExportHandles: () => void;
  onSetExportBoundFromPlayhead: (bound: "start" | "end") => void;
}>;

export function SelectionEditor({
  selection,
  currentMs,
  authorizationAvailable,
  projects,
  projectId,
  creatingProject,
  newProjectName,
  newProjectDescription,
  newProjectKind,
  projectBusy,
  projectMessage,
  clipNotes,
  clipTags,
  logged,
  previewingSelection,
  commandPanel,
  onClear,
  onCreatingProjectChange,
  onProjectChange,
  onNewProjectNameChange,
  onNewProjectDescriptionChange,
  onNewProjectKindChange,
  onCreateProject,
  onClipNotesChange,
  onClipTagsChange,
  onExportBoundChange,
  onTogglePreview,
  onAddExportHandles,
  onSetExportBoundFromPlayhead,
}: SelectionEditorProps) {
  return (
    <section className="selection-panel" aria-label="Clip selection">
      <div className="selection-heading">
        <div>
          <p className="eyebrow">Selected passage</p>
          <strong>{selection.timingPrecision} bounds</strong>
        </div>
        <button type="button" className="quiet-button" onClick={onClear}>
          Clear
        </button>
      </div>
      <blockquote>{selection.text}</blockquote>
      <div className="selection-project">
        <div className="selection-project-heading">
          <label htmlFor="selection-project">Logging project</label>
          <button
            type="button"
            className="quiet-button"
            disabled={!authorizationAvailable || logged}
            onClick={() => onCreatingProjectChange(!creatingProject)}
          >
            {creatingProject ? "Cancel new project" : "New project"}
          </button>
        </div>
        <select
          id="selection-project"
          value={projectId}
          disabled={projects.length === 0 || logged}
          onChange={(event) => onProjectChange(event.target.value)}
        >
          <option value="">Choose a project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {creatingProject ? (
          <div className="quick-project-form">
            <label>
              Project name
              <input
                value={newProjectName}
                maxLength={160}
                onChange={(event) => onNewProjectNameChange(event.target.value)}
              />
            </label>
            <label>
              Project kind
              <select
                aria-label="New project kind"
                value={newProjectKind}
                onChange={(event) =>
                  onNewProjectKindChange(
                    event.target.value as "personal" | "shared",
                  )
                }
              >
                <option value="personal">Personal</option>
                <option value="shared">Shared</option>
              </select>
            </label>
            <label>
              Description (optional)
              <textarea
                value={newProjectDescription}
                maxLength={2_000}
                rows={2}
                onChange={(event) =>
                  onNewProjectDescriptionChange(event.target.value)
                }
              />
            </label>
            <button
              type="button"
              className="handle-button"
              disabled={projectBusy || !newProjectName.trim()}
              onClick={onCreateProject}
            >
              Create and select project
            </button>
          </div>
        ) : null}
        <p className="form-message" role="status">
          {projectMessage ??
            (authorizationAvailable
              ? projects.length
                ? "Logging actions will show this destination explicitly."
                : "Connect below to load projects, or create one here."
              : "Connect a development session below to choose or create a logging project.")}
        </p>
      </div>
      <div className="clip-research-fields">
        <label>
          Notes / intended use
          <textarea
            rows={3}
            maxLength={20_000}
            value={clipNotes}
            disabled={logged}
            onChange={(event) => onClipNotesChange(event.target.value)}
            placeholder="How might this clip support the essay?"
          />
        </label>
        <label>
          Clip tags
          <input
            value={clipTags}
            disabled={logged}
            onChange={(event) => onClipTagsChange(event.target.value)}
            placeholder="topic, person, argument"
          />
          <span>Separate reusable project tags with commas.</span>
        </label>
      </div>
      <p className="immutable-bounds">
        Transcript selection: {formatPreciseTime(selection.transcriptStartMs)}–
        {formatPreciseTime(selection.transcriptEndMs)}
      </p>
      <div className="export-bounds">
        <label>
          Export start (seconds)
          <input
            type="number"
            min="0"
            step="0.1"
            disabled={logged}
            value={(selection.exportStartMs / 1_000).toFixed(3)}
            onChange={(event) =>
              onExportBoundChange("start", event.target.value)
            }
          />
        </label>
        <label>
          Export end (seconds)
          <input
            type="number"
            min="0.001"
            step="0.1"
            disabled={logged}
            value={(selection.exportEndMs / 1_000).toFixed(3)}
            onChange={(event) => onExportBoundChange("end", event.target.value)}
          />
        </label>
      </div>
      <div className="selection-controls">
        <button
          type="button"
          className="handle-button"
          onClick={onTogglePreview}
        >
          {previewingSelection ? "Stop preview" : "Loop preview"}
        </button>
        <button
          type="button"
          className="handle-button"
          disabled={logged}
          onClick={onAddExportHandles}
        >
          Add 0.5s handles
        </button>
        <button
          type="button"
          className="handle-button"
          disabled={
            logged ||
            currentMs > selection.transcriptStartMs ||
            currentMs >= selection.exportEndMs
          }
          onClick={() => onSetExportBoundFromPlayhead("start")}
        >
          Set start from playhead
        </button>
        <button
          type="button"
          className="handle-button"
          disabled={
            logged ||
            currentMs < selection.transcriptEndMs ||
            currentMs <= selection.exportStartMs
          }
          onClick={() => onSetExportBoundFromPlayhead("end")}
        >
          Set end from playhead
        </button>
      </div>
      {commandPanel}
    </section>
  );
}
