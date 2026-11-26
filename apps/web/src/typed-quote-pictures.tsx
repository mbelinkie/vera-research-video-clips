import { useEffect, useState } from "react";

import { researchCloudFetch as cloudFetch } from "./research-library-data.ts";

export type PictureOwner = "source" | "quote";

export type PictureAuth = {
  authorization: string;
  csrfToken?: string | undefined;
  onUnavailable?: (() => void) | undefined;
};

export function picturePath(projectId: string, kind: PictureOwner, id: string) {
  return `/cloud-api/api/projects/${projectId}/library-reference-pictures/${kind}/${id}`;
}

export async function getPictureRevision(
  path: string,
  auth: PictureAuth,
  signal: AbortSignal,
) {
  const response = await cloudFetch(path, { signal, cache: "no-store" }, auth);
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Unable to read picture version (${response.status}).`);
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("revisionId" in body) ||
    typeof body.revisionId !== "string"
  )
    throw new Error("Invalid retained picture version.");
  return body.revisionId;
}

export async function uploadPicture(
  path: string,
  file: File,
  auth: PictureAuth,
  signal: AbortSignal,
) {
  // The server independently verifies the image MIME, bytes, dimensions and versions.
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Use a JPEG, PNG or WebP picture no larger than 20 MiB.");
  const expectedRevisionId = await getPictureRevision(path, auth, signal);
  const body = new FormData();
  body.set("metadata", JSON.stringify({ expectedRevisionId }));
  body.set("image", file);
  const response = await cloudFetch(
    path,
    { method: "POST", body, signal },
    auth,
  );
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined);
    const detail =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : `Picture upload failed (${response.status}).`;
    throw new Error(
      response.status === 409
        ? `Picture conflict: ${detail} Reload before retrying.`
        : detail,
    );
  }
}

/** Only project-authorized cloudFetch reads are turned into local blob URLs. */
export function ReferencePicturePicker({
  label,
  file,
  onFileChange,
  projectId,
  kind,
  ownerId,
  auth,
  refreshKey,
  disabled,
}: {
  label: string;
  file: File | undefined;
  onFileChange: (file: File | undefined) => void;
  projectId: string;
  kind: PictureOwner;
  ownerId?: string | undefined;
  auth: PictureAuth;
  refreshKey: number;
  disabled: boolean;
}) {
  const [preview, setPreview] = useState<string>();
  const [readError, setReadError] = useState<string>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    setReadError(undefined);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (file) return;
    setPreview(undefined);
    setReadError(undefined);
    if (!ownerId) return;
    const controller = new AbortController();
    let url: string | undefined;
    void (async () => {
      try {
        const path = picturePath(projectId, kind, ownerId);
        const revision = await getPictureRevision(
          path,
          auth,
          controller.signal,
        );
        if (!revision || controller.signal.aborted) return;
        const response = await cloudFetch(
          `${path}/display`,
          { signal: controller.signal, cache: "no-store" },
          auth,
        );
        if (!response.ok)
          throw new Error(
            `Unable to display retained picture (${response.status}).`,
          );
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type))
          throw new Error("Retained picture has an unsupported format.");
        url = URL.createObjectURL(blob);
        setPreview(url);
      } catch (error) {
        if (!controller.signal.aborted)
          setReadError(
            error instanceof Error
              ? error.message
              : "Picture could not be loaded.",
          );
      }
    })();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [
    file,
    ownerId,
    projectId,
    kind,
    auth.authorization,
    auth.csrfToken,
    auth.onUnavailable,
    refreshKey,
    retry,
  ]);

  return (
    <div className="typed-quotes-picture">
      <label>
        {label} (optional)
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          onChange={(event) => {
            onFileChange(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      {preview && <img src={preview} alt={`${label} preview`} />}
      {file && <p className="muted">Pending upload: {file.name}</p>}
      {readError && (
        <p role="alert">
          {readError}{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry picture preview
          </button>
        </p>
      )}
    </div>
  );
}
