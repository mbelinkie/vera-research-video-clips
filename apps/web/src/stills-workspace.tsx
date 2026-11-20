import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiErrorSchema,
  LibraryItemSchema,
  LibrarySourceSchema,
  type LibraryItem,
  type LibrarySource,
  type Project,
} from "@research-video/contracts";

import { cloudFetch } from "./browser-api.ts";
import {
  containedImageRect,
  drawnCrop,
  minimumPointerCrop,
  movedCrop,
  normalizedPoint,
  resizedCrop,
  type Corner,
  type Crop,
  type Point,
  type Rect,
} from "./still-crop-geometry.ts";

type StillsWorkspaceProps = {
  authorization: string;
  browserSession?: boolean;
  csrfToken?: string | undefined;
  onAuthUnavailable: (() => void) | undefined;
  projectId: string;
  projects: readonly Project[];
};

type ImportMode = "url" | "file" | "page_picture";
type Draft = {
  title: string;
  topics: string;
  credit: string;
  licence: string;
  usageNote: string;
  pageUrl: string;
  altText: string;
  originalUrl: string;
  url: string;
};

type AssetState = {
  itemId?: string;
  displayUrl?: string;
  loading: boolean;
  unavailable: boolean;
};

type CropGesture = {
  pointerId: number;
  mode: "draw" | "move" | "resize";
  corner?: Corner;
  start: Point;
  original: Crop;
  minimum: Point;
  previewUrl: string;
  targetId: string;
  projectId: string;
};

function rasterBounds(image: HTMLImageElement): Rect | undefined {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight)
    return undefined;
  const box = image.getBoundingClientRect();
  return containedImageRect(
    { left: box.left, top: box.top, width: box.width, height: box.height },
    { width: image.naturalWidth, height: image.naturalHeight },
  );
}

const emptyCrop: Crop = { x: 0, y: 0, width: 1, height: 1 };

function emptyDraft(): Draft {
  return {
    title: "",
    topics: "",
    credit: "",
    licence: "",
    usageNote: "",
    pageUrl: "",
    altText: "",
    originalUrl: "",
    url: "",
  };
}

function splitTopics(value: string) {
  return value
    .split(/[,\n]/u)
    .map((topic) => topic.trim())
    .filter(Boolean);
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function safeExternalUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function sourceUrl(source: LibrarySource | undefined) {
  if (!source) return undefined;
  const bibliography = source.bibliography as {
    url?: { value?: string };
  };
  if (bibliography.url?.value) return safeExternalUrl(bibliography.url.value);
  const details = source.details as {
    submittedUrl?: string;
    originalUrl?: string;
    pageUrl?: string;
  };
  return safeExternalUrl(
    details.submittedUrl ?? details.originalUrl ?? details.pageUrl,
  );
}

function sourceLabel(source: LibrarySource | undefined) {
  if (!source) return undefined;
  const bibliography = source.bibliography as {
    title?: { value?: string };
  };
  return bibliography.title?.value ?? source.kind.replace(/_/gu, " ");
}

function itemTitle(item: LibraryItem) {
  return item.kind === "still"
    ? (item.content.title ?? "Untitled still")
    : "Still";
}

function cropError(crop: Crop) {
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite))
    return "Crop coordinates must be numbers.";
  if (crop.width <= 0 || crop.height <= 0)
    return "Crop width and height must be greater than zero.";
  if (
    crop.x < 0 ||
    crop.y < 0 ||
    crop.x + crop.width > 1 ||
    crop.y + crop.height > 1
  )
    return "Crop must stay within the image (0–1 normalized coordinates).";
  return undefined;
}

function readList<T>(
  payload: unknown,
  schema: { array: () => { parse: (value: unknown) => T[] } },
) {
  const list =
    Array.isArray(payload) || payload === undefined || payload === null
      ? payload
      : typeof payload === "object" && "items" in payload
        ? payload.items
        : payload;
  return schema.array().parse(list ?? []);
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => undefined);
  const parsed = ApiErrorSchema.safeParse(payload);
  return parsed.success ? parsed.data.error.message : fallback;
}

function StillThumbnail({
  authorization,
  browserSession,
  csrfToken,
  item,
  onAuthUnavailable,
  projectId,
}: {
  authorization: string;
  browserSession: boolean;
  csrfToken: string | undefined;
  item: LibraryItem;
  onAuthUnavailable: (() => void) | undefined;
  projectId: string;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const response = await cloudFetch(
          `/cloud-api/api/projects/${projectId}/stills/${item.id}/assets/thumbnail`,
          { signal: controller.signal },
          {
            authorization,
            csrfToken,
            onUnavailable: browserSession ? onAuthUnavailable : undefined,
          },
        );
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error();
        objectUrl = URL.createObjectURL(blob);
        if (active) setThumbnailUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      } catch (error) {
        if (active && !(error instanceof Error && error.name === "AbortError"))
          setUnavailable(true);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    authorization,
    browserSession,
    csrfToken,
    item.id,
    onAuthUnavailable,
    projectId,
  ]);

  if (thumbnailUrl)
    return <img className="stills-thumbnail-image" src={thumbnailUrl} alt="" />;
  return (
    <span
      className="stills-thumbnail-fallback"
      aria-label={unavailable ? "Thumbnail unavailable" : "Loading thumbnail"}
    >
      {unavailable ? "Unavailable" : "Loading"}
    </span>
  );
}

export function StillsWorkspace({
  authorization,
  browserSession = false,
  csrfToken,
  onAuthUnavailable,
  projectId,
  projects,
}: StillsWorkspaceProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [pageSources, setPageSources] = useState<LibrarySource[]>([]);
  const [loadedSources, setLoadedSources] = useState<LibrarySource[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [importMode, setImportMode] = useState<ImportMode>("url");
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [file, setFile] = useState<File>();
  const [filePreviewUrl, setFilePreviewUrl] = useState<string>();
  const [pageSourceId, setPageSourceId] = useState("");
  const [crop, setCrop] = useState<Crop>(emptyCrop);
  const [cropTargetId, setCropTargetId] = useState("");
  const cropPreviewRef = useRef<HTMLDivElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const cropSurfaceRef = useRef<HTMLDivElement>(null);
  const cropGesture = useRef<CropGesture | null>(null);
  const [cropLayout, setCropLayout] = useState<{
    url: string;
    bounds: Rect;
  }>();
  const [formBusy, setFormBusy] = useState(false);
  const [formMessage, setFormMessage] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [assetState, setAssetState] = useState<AssetState>({
    loading: false,
    unavailable: false,
  });
  const [selectedSource, setSelectedSource] = useState<LibrarySource>();
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<Draft>(() => emptyDraft());
  const [editBusy, setEditBusy] = useState(false);
  const [editMessage, setEditMessage] = useState<string>();
  const pendingWrite = useRef<AbortController | null>(null);
  const lastSave = useRef<{
    intent: string;
    file: File | undefined;
    key: string;
  } | null>(null);
  useEffect(() => () => pendingWrite.current?.abort(), []);
  const currentContext = useRef({ projectId, authorization });
  currentContext.current = { projectId, authorization };

  const selectedItem = items.find((item) => item.id === selectedItemId);
  const selectedProject = projects.find((project) => project.id === projectId);
  const canWrite = Boolean(projectId && authorization);
  const selectedItemSource = selectedItem
    ? (loadedSources.find((source) => source.id === selectedItem.sourceId) ??
      pageSources.find((source) => source.id === selectedItem.sourceId))
    : undefined;
  const selectedPreviewUrl = assetState.displayUrl;
  const cropTarget = items.find((item) => item.id === cropTargetId);
  const cropPreviewUrl = cropTargetId
    ? assetState.itemId === cropTargetId && !assetState.loading
      ? selectedPreviewUrl
      : undefined
    : filePreviewUrl;
  const cropBounds =
    cropPreviewUrl && cropLayout?.url === cropPreviewUrl
      ? cropLayout.bounds
      : undefined;
  const currentSourceForForm = pageSources.find(
    (source) => source.id === pageSourceId,
  );
  const pageSourceUrl = sourceUrl(currentSourceForForm);
  const normalizedCropError = cropError(crop);
  const formTitle = cropTarget ? "Crop a saved still" : "Save a new still";

  useEffect(() => {
    setItems([]);
    setPageSources([]);
    setLoadedSources([]);
    setSelectedItemId("");
    setSelectedSource(undefined);
    setAssetState({ loading: false, unavailable: false });
    setCropTargetId("");
    setFormMessage(undefined);
    setFormError(undefined);
    setLoading(false);
    if (!open || !projectId || !authorization) return;
    const controller = new AbortController();
    const expected = { projectId, authorization };
    setLoading(true);
    void (async () => {
      try {
        const auth = {
          authorization,
          csrfToken,
          onUnavailable: browserSession ? onAuthUnavailable : undefined,
        };
        const [itemResponse, sourceResponse] = await Promise.all([
          cloudFetch(
            `/cloud-api/api/projects/${projectId}/items?kind=still&limit=100&offset=0`,
            { signal: controller.signal },
            auth,
          ),
          cloudFetch(
            `/cloud-api/api/projects/${projectId}/sources?kind=web_page&limit=100&offset=0`,
            { signal: controller.signal },
            auth,
          ),
        ]);
        if (!itemResponse.ok)
          throw new Error(
            await responseError(itemResponse, "Unable to load saved stills."),
          );
        if (!sourceResponse.ok)
          throw new Error(
            await responseError(sourceResponse, "Unable to load page sources."),
          );
        const nextItems = readList(
          itemResponse ? await itemResponse.json() : [],
          LibraryItemSchema,
        );
        const nextSources = readList(
          sourceResponse ? await sourceResponse.json() : [],
          LibrarySourceSchema,
        );
        if (
          controller.signal.aborted ||
          currentContext.current.projectId !== expected.projectId ||
          currentContext.current.authorization !== expected.authorization
        )
          return;
        setItems(nextItems.filter((item) => item.kind === "still"));
        setPageSources(
          nextSources.filter((source) => source.kind === "web_page"),
        );
        setLoadError(undefined);
      } catch (error) {
        if (
          !controller.signal.aborted &&
          currentContext.current.projectId === expected.projectId
        )
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load saved stills.",
          );
      } finally {
        if (
          !controller.signal.aborted &&
          currentContext.current.projectId === expected.projectId
        )
          setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [
    authorization,
    browserSession,
    csrfToken,
    onAuthUnavailable,
    open,
    projectId,
  ]);

  useEffect(() => {
    if (!file) {
      setFilePreviewUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setFilePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    setEditing(false);
    setEditMessage(undefined);
    if (!selectedItem || selectedItem.kind !== "still") {
      setSelectedSource(undefined);
      setAssetState({ loading: false, unavailable: false });
      return;
    }
    setEditDraft({
      ...emptyDraft(),
      title: selectedItem.content.title ?? "",
      credit: selectedItem.content.credit ?? "",
      licence: selectedItem.content.licence ?? "",
      usageNote: selectedItem.content.usageNote ?? "",
      topics: selectedItem.topics.join(", "),
    });
    const knownSource =
      loadedSources.find((source) => source.id === selectedItem.sourceId) ??
      pageSources.find((source) => source.id === selectedItem.sourceId);
    setSelectedSource(knownSource);
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    setAssetState({
      itemId: selectedItem.id,
      loading: true,
      unavailable: false,
    });
    void (async () => {
      try {
        const response = await cloudFetch(
          `/cloud-api/api/projects/${projectId}/stills/${selectedItem.id}/assets/display`,
          { signal: controller.signal },
          {
            authorization,
            csrfToken,
            onUnavailable: browserSession ? onAuthUnavailable : undefined,
          },
        );
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error();
        objectUrl = URL.createObjectURL(blob);
        if (active)
          setAssetState({
            itemId: selectedItem.id,
            displayUrl: objectUrl,
            loading: false,
            unavailable: false,
          });
        else URL.revokeObjectURL(objectUrl);
      } catch (error) {
        if (active && !(error instanceof Error && error.name === "AbortError"))
          setAssetState({
            itemId: selectedItem.id,
            loading: false,
            unavailable: true,
          });
      }
      if (!knownSource && active) {
        try {
          const response = await cloudFetch(
            `/cloud-api/api/projects/${projectId}/sources/${selectedItem.sourceId}`,
            { signal: controller.signal },
            {
              authorization,
              csrfToken,
              onUnavailable: browserSession ? onAuthUnavailable : undefined,
            },
          );
          if (response.ok && active) {
            const source = LibrarySourceSchema.parse(await response.json());
            setSelectedSource(source);
            setLoadedSources((current) => [
              ...current.filter((candidate) => candidate.id !== source.id),
              source,
            ]);
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
        }
      }
    })();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    authorization,
    browserSession,
    csrfToken,
    loadedSources,
    onAuthUnavailable,
    pageSources,
    projectId,
    selectedItem,
  ]);

  const formPreviewAlt =
    draft.altText.trim() || draft.title.trim() || "Still preview";
  const provenanceSource = selectedSource ?? selectedItemSource;
  const selectedSourceLink = sourceUrl(provenanceSource);
  const provenanceDetails = provenanceSource?.details;
  const selectedPageLink = safeExternalUrl(
    provenanceDetails && "pageUrl" in provenanceDetails
      ? provenanceDetails.pageUrl
      : undefined,
  );
  const selectedSourceName = sourceLabel(selectedSource ?? selectedItemSource);

  const measureCropPreview = useCallback(() => {
    const image = cropImageRef.current;
    const preview = cropPreviewRef.current;
    const raster = image && rasterBounds(image);
    if (!preview || !raster || !cropPreviewUrl) {
      setCropLayout(undefined);
      return;
    }
    const outer = preview.getBoundingClientRect();
    // Absolute children are positioned from the preview's padding edge, not
    // its outer border. The raster is also letterboxed *within* the img.
    const bounds = {
      left: raster.left - outer.left - preview.clientLeft,
      top: raster.top - outer.top - preview.clientTop,
      width: raster.width,
      height: raster.height,
    };
    setCropLayout((previous) =>
      previous?.url === cropPreviewUrl &&
      previous.bounds.left === bounds.left &&
      previous.bounds.top === bounds.top &&
      previous.bounds.width === bounds.width &&
      previous.bounds.height === bounds.height
        ? previous
        : { url: cropPreviewUrl, bounds },
    );
  }, [cropPreviewUrl]);

  useEffect(() => {
    measureCropPreview();
    const image = cropImageRef.current;
    const preview = cropPreviewRef.current;
    if (!image || !preview || !cropPreviewUrl) return;
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measureCropPreview);
    observer?.observe(image);
    observer?.observe(preview);
    window.addEventListener("resize", measureCropPreview);
    window.addEventListener("scroll", measureCropPreview, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureCropPreview);
      window.removeEventListener("scroll", measureCropPreview, true);
    };
  }, [cropPreviewUrl, measureCropPreview]);

  function abandonCropGesture() {
    const active = cropGesture.current;
    cropGesture.current = null;
    if (active && cropSurfaceRef.current?.hasPointerCapture(active.pointerId))
      cropSurfaceRef.current.releasePointerCapture(active.pointerId);
  }

  // Never let a captured pointer from the previous saved item/asset update the
  // next item's crop. If the same draft loses its asset, restore its snapshot.
  useEffect(() => {
    const active = cropGesture.current;
    if (
      active &&
      (active.previewUrl !== cropPreviewUrl ||
        active.targetId !== cropTargetId ||
        active.projectId !== projectId)
    ) {
      abandonCropGesture();
      if (active.targetId === cropTargetId && active.projectId === projectId)
        setCrop(active.original);
    }
  }, [cropPreviewUrl, cropTargetId, projectId]);

  useEffect(
    () => () => {
      // No state update after unmount, and no pointer capture left behind.
      const active = cropGesture.current;
      cropGesture.current = null;
      if (active && cropSurfaceRef.current?.hasPointerCapture(active.pointerId))
        cropSurfaceRef.current.releasePointerCapture(active.pointerId);
    },
    [],
  );

  function gestureCrop(
    active: CropGesture,
    event: React.PointerEvent<HTMLDivElement>,
  ): Crop | undefined {
    const image = cropImageRef.current;
    const raster = image && rasterBounds(image);
    const point =
      raster && normalizedPoint({ x: event.clientX, y: event.clientY }, raster);
    if (!point) return undefined;
    if (active.mode === "draw")
      return drawnCrop(active.start, point, active.minimum);
    if (active.mode === "move")
      return movedCrop(active.original, {
        x: point.x - active.start.x,
        y: point.y - active.start.y,
      });
    return active.corner
      ? resizedCrop(active.original, active.corner, point, active.minimum)
      : undefined;
  }

  function currentCropGesture(active: CropGesture) {
    return (
      active.previewUrl === cropPreviewUrl &&
      active.targetId === cropTargetId &&
      active.projectId === projectId
    );
  }

  function handleCropPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      cropGesture.current ||
      formBusy ||
      !cropPreviewUrl ||
      !cropBounds
    )
      return;
    const image = cropImageRef.current;
    const raster = image && rasterBounds(image);
    const start =
      raster && normalizedPoint({ x: event.clientX, y: event.clientY }, raster);
    const minimum =
      raster &&
      image &&
      minimumPointerCrop(
        { width: image.naturalWidth, height: image.naturalHeight },
        raster,
      );
    if (!start || !minimum) return;

    const target = event.target instanceof HTMLElement ? event.target : null;
    const cornerName =
      target?.closest<HTMLElement>("[data-crop-corner]")?.dataset.cropCorner;
    const corner = (["nw", "ne", "sw", "se"] as string[]).includes(
      cornerName ?? "",
    )
      ? (cornerName as Corner)
      : undefined;
    const inside = Boolean(target?.closest(".stills-crop-box"));
    const full =
      crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
    const mode = corner
      ? "resize"
      : full || !inside || Boolean(cropError(crop))
        ? "draw"
        : "move";
    const active: CropGesture = {
      pointerId: event.pointerId,
      mode,
      ...(corner ? { corner } : {}),
      start,
      original: crop,
      minimum,
      previewUrl: cropPreviewUrl,
      targetId: cropTargetId,
      projectId,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    cropGesture.current = active;
    event.preventDefault();
  }

  function handleCropPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const active = cropGesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!currentCropGesture(active)) {
      abandonCropGesture();
      return;
    }
    const next = gestureCrop(active, event);
    if (next) {
      setCrop(next);
      setFormError(undefined);
    } else if (active.mode === "draw") {
      // A transient tiny drag must never replace the original valid selection.
      setCrop(active.original);
    }
  }

  function finishCropPointer(
    event: React.PointerEvent<HTMLDivElement>,
    commit: boolean,
  ) {
    const active = cropGesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!currentCropGesture(active)) {
      abandonCropGesture();
      return;
    }
    const next = commit ? gestureCrop(active, event) : undefined;
    abandonCropGesture();
    setCrop(next ?? active.original);
    if (next) setFormError(undefined);
  }

  function resetForm() {
    abandonCropGesture();
    lastSave.current = null;
    setDraft(emptyDraft());
    setFile(undefined);
    setPageSourceId("");
    setCrop(emptyCrop);
    setCropTargetId("");
    setFormMessage(undefined);
    setFormError(undefined);
    setImportMode("url");
  }

  function updateDraft(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFormError(undefined);
    setFormMessage(undefined);
  }

  function updateCrop(field: keyof Crop, rawValue: string) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    abandonCropGesture();
    setCrop((current) => ({
      ...current,
      [field]: Math.min(1, Math.max(0, value)),
    }));
    setFormError(undefined);
  }

  function openCrop(item: LibraryItem) {
    if (item.kind !== "still") return;
    abandonCropGesture();
    setSelectedItemId(item.id);
    setCropTargetId(item.id);
    setImportMode("page_picture");
    setDraft({
      ...emptyDraft(),
      title: `${item.content.title ?? "Still"} crop`,
      credit: item.content.credit ?? "",
      licence: item.content.licence ?? "",
      usageNote: item.content.usageNote ?? "",
      topics: item.topics.join(", "),
    });
    setCrop(emptyCrop);
    setFormError(undefined);
    setFormMessage(undefined);
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    abandonCropGesture();
    const next = event.currentTarget.files?.[0];
    setFile(next);
    setFormError(undefined);
    setFormMessage(undefined);
  }

  async function saveNewStill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingWrite.current) return;
    if (!canWrite) {
      setFormError(
        "Choose a visible project and connect before saving a still.",
      );
      return;
    }
    if (!draft.title.trim()) {
      setFormError("Add a title for this still.");
      return;
    }
    if (cropTarget && normalizedCropError) {
      setFormError(normalizedCropError);
      return;
    }
    if (!cropTarget && importMode !== "url" && !file) {
      setFormError("Choose one image file to continue.");
      return;
    }
    if (!cropTarget && importMode === "page_picture" && !pageSourceId) {
      setFormError("Choose the existing web-page source for this picture.");
      return;
    }
    setFormBusy(true);
    setFormError(undefined);
    setFormMessage(undefined);
    const controller = new AbortController();
    pendingWrite.current = controller;
    const intent = JSON.stringify({
      importMode,
      draft,
      cropTargetId,
      crop,
      pageSourceId,
    });
    const previous = lastSave.current;
    const idempotencyKey =
      previous?.intent === intent && previous.file === file
        ? previous.key
        : crypto.randomUUID();
    lastSave.current = { intent, file, key: idempotencyKey };
    const metadata = {
      idempotencyKey,
      title: draft.title.trim(),
      ...(splitTopics(draft.topics).length
        ? { topics: splitTopics(draft.topics) }
        : {}),
      ...(optionalText(draft.credit)
        ? { credit: optionalText(draft.credit) }
        : {}),
      ...(optionalText(draft.licence)
        ? { licence: optionalText(draft.licence) }
        : {}),
      ...(optionalText(draft.usageNote)
        ? { usageNote: optionalText(draft.usageNote) }
        : {}),
      ...(optionalText(draft.pageUrl)
        ? { pageUrl: optionalText(draft.pageUrl) }
        : {}),
      ...(optionalText(draft.altText)
        ? { altText: optionalText(draft.altText) }
        : {}),
    };
    try {
      let response: Response;
      if (cropTarget) {
        const { pageUrl: _pageUrl, ...cropMetadata } = metadata;
        response = await cloudFetch(
          `/cloud-api/api/projects/${projectId}/stills/${cropTarget.id}/crop`,
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify({ ...cropMetadata, crop }),
          },
          {
            authorization,
            csrfToken,
            onUnavailable: browserSession ? onAuthUnavailable : undefined,
          },
        );
      } else if (importMode === "url") {
        response = await cloudFetch(
          `/cloud-api/api/projects/${projectId}/stills/from-url`,
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify({ ...metadata, url: draft.url.trim() }),
          },
          {
            authorization,
            csrfToken,
            onUnavailable: browserSession ? onAuthUnavailable : undefined,
          },
        );
      } else {
        const body = new FormData();
        body.append(
          "metadata",
          JSON.stringify(
            importMode === "page_picture"
              ? { ...metadata, sourceId: pageSourceId, crop }
              : {
                  ...metadata,
                  ...(optionalText(draft.originalUrl)
                    ? { originalUrl: optionalText(draft.originalUrl) }
                    : {}),
                },
          ),
        );
        body.append("image", file!);
        response = await cloudFetch(
          `/cloud-api/api/projects/${projectId}/stills/${importMode === "page_picture" ? "from-page-picture" : "from-file"}`,
          {
            method: "POST",
            headers: { accept: "application/json" },
            signal: controller.signal,
            body,
          },
          {
            authorization,
            csrfToken,
            onUnavailable: browserSession ? onAuthUnavailable : undefined,
          },
        );
      }
      if (!response.ok)
        throw new Error(
          await responseError(response, "Unable to save this still."),
        );
      const created = LibraryItemSchema.parse(await response.json());
      if (created.kind !== "still")
        throw new Error("The still response was invalid.");
      setItems((current) => [
        created,
        ...current.filter((item) => item.id !== created.id),
      ]);
      setLoadedSources((current) =>
        current.filter((source) => source.id !== created.sourceId),
      );
      setSelectedItemId(created.id);
      resetForm();
      setFormMessage("Still saved to the selected project.");
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        setFormError(
          error instanceof Error ? error.message : "Unable to save this still.",
        );
    } finally {
      pendingWrite.current = null;
      setFormBusy(false);
    }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      pendingWrite.current ||
      !selectedItem ||
      selectedItem.kind !== "still" ||
      !canWrite
    )
      return;
    const controller = new AbortController();
    pendingWrite.current = controller;
    setEditBusy(true);
    setEditMessage(undefined);
    try {
      const response = await cloudFetch(
        `/cloud-api/api/projects/${projectId}/items/${selectedItem.id}`,
        {
          method: "PATCH",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expectedVersion: selectedItem.version,
            topics: splitTopics(editDraft.topics),
            content: {
              ...(optionalText(editDraft.title)
                ? { title: optionalText(editDraft.title) }
                : {}),
              ...(optionalText(editDraft.credit)
                ? { credit: optionalText(editDraft.credit) }
                : {}),
              ...(optionalText(editDraft.licence)
                ? { licence: optionalText(editDraft.licence) }
                : {}),
              ...(optionalText(editDraft.usageNote)
                ? { usageNote: optionalText(editDraft.usageNote) }
                : {}),
            },
          }),
        },
        {
          authorization,
          csrfToken,
          onUnavailable: browserSession ? onAuthUnavailable : undefined,
        },
      );
      if (!response.ok)
        throw new Error(
          await responseError(response, "Unable to update this still."),
        );
      const updated = LibraryItemSchema.parse(await response.json());
      if (updated.kind !== "still")
        throw new Error("The still response was invalid.");
      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditing(false);
      setEditMessage("Still metadata updated.");
    } catch (error) {
      setEditMessage(
        error instanceof Error ? error.message : "Unable to update this still.",
      );
    } finally {
      pendingWrite.current = null;
      setEditBusy(false);
    }
  }

  const formSourceHint = useMemo(() => {
    if (importMode !== "page_picture" || !currentSourceForForm)
      return undefined;
    return pageSourceUrl
      ? `Source URL: ${pageSourceUrl}`
      : sourceLabel(currentSourceForForm);
  }, [currentSourceForForm, importMode, pageSourceUrl]);

  return (
    <section className="stills-workspace" aria-labelledby="stills-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Project library</p>
          <h2 id="stills-title">Stills</h2>
        </div>
        <div className="action-row">
          <span className="status">
            {selectedProject ? selectedProject.name : "No project selected"}
          </span>
          <button
            type="button"
            disabled={formBusy || editBusy}
            onClick={() => {
              if (open) resetForm();
              setOpen(!open);
            }}
          >
            {open ? "Close stills" : "Open stills"}
          </button>
        </div>
      </div>

      {!open ? (
        <p className="form-message">
          Open the stills workspace to review retained images and import a new
          one.
        </p>
      ) : !projectId ? (
        <p className="form-message">
          Select a visible project in the transcription queue to manage saved
          stills.
        </p>
      ) : !authorization ? (
        <p className="form-message">
          Connect a session before loading this project’s stills.
        </p>
      ) : (
        <>
          <div className="stills-layout">
            <div className="stills-library-panel">
              <div className="panel-heading">
                <span>Saved stills</span>
                <span className="precision">
                  {loading ? "Loading" : `${items.length} saved`}
                </span>
              </div>
              {loadError ? (
                <p className="form-message error" role="alert">
                  {loadError}
                </p>
              ) : null}
              {items.length ? (
                <div className="stills-list" aria-label="Saved stills">
                  {items.map((item) => (
                    <button
                      className={
                        item.id === selectedItemId
                          ? "stills-list-item selected"
                          : "stills-list-item"
                      }
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (cropTargetId && cropTargetId !== item.id)
                          resetForm();
                        setSelectedItemId(item.id);
                      }}
                      aria-pressed={item.id === selectedItemId}
                    >
                      <StillThumbnail
                        authorization={authorization}
                        browserSession={browserSession}
                        csrfToken={csrfToken}
                        item={item}
                        onAuthUnavailable={onAuthUnavailable}
                        projectId={projectId}
                      />
                      <span>
                        <strong>{itemTitle(item)}</strong>
                        <small>
                          {item.kind === "still" && item.content.credit
                            ? item.content.credit
                            : "No credit supplied"}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="stills-empty">
                  No retained stills in this project yet.
                </p>
              )}
            </div>

            <div className="stills-detail-panel">
              {selectedItem && selectedItem.kind === "still" ? (
                <>
                  <div className="stills-preview-frame">
                    {selectedPreviewUrl ? (
                      <img
                        src={selectedPreviewUrl}
                        alt={selectedItem.content.title ?? "Saved still"}
                      />
                    ) : (
                      <span>
                        {assetState.loading
                          ? "Loading saved preview…"
                          : "Saved preview unavailable"}
                      </span>
                    )}
                  </div>
                  <p className="rights-statement">
                    Saved copy; permission to use this image is not verified.
                  </p>
                  <div className="stills-detail-heading">
                    <div>
                      <p className="eyebrow">Saved still</p>
                      <h3>{itemTitle(selectedItem)}</h3>
                    </div>
                    <div className="action-row">
                      <button
                        type="button"
                        onClick={() => openCrop(selectedItem)}
                        disabled={
                          !canWrite || !assetState.displayUrl || formBusy
                        }
                      >
                        Crop this still
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing((value) => !value)}
                        disabled={!canWrite}
                      >
                        {editing ? "Cancel edit" : "Edit metadata"}
                      </button>
                    </div>
                  </div>
                  {editing ? (
                    <form
                      className="stills-edit-form"
                      onSubmit={(event) => void saveEdit(event)}
                    >
                      <label>
                        Title
                        <input
                          value={editDraft.title}
                          onChange={(event) =>
                            setEditDraft((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Topics
                        <input
                          value={editDraft.topics}
                          onChange={(event) =>
                            setEditDraft((current) => ({
                              ...current,
                              topics: event.target.value,
                            }))
                          }
                          placeholder="topic, person, theme"
                        />
                      </label>
                      <label>
                        Credit
                        <input
                          value={editDraft.credit}
                          onChange={(event) =>
                            setEditDraft((current) => ({
                              ...current,
                              credit: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Licence
                        <input
                          value={editDraft.licence}
                          onChange={(event) =>
                            setEditDraft((current) => ({
                              ...current,
                              licence: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        Usage note
                        <textarea
                          rows={3}
                          value={editDraft.usageNote}
                          onChange={(event) =>
                            setEditDraft((current) => ({
                              ...current,
                              usageNote: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <div className="action-row">
                        <button
                          className="primary-action"
                          type="submit"
                          disabled={editBusy}
                        >
                          {editBusy ? "Saving…" : "Save metadata"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <dl className="stills-metadata">
                      <div>
                        <dt>Topics</dt>
                        <dd>
                          {selectedItem.topics.length
                            ? selectedItem.topics.join(", ")
                            : "None"}
                        </dd>
                      </div>
                      <div>
                        <dt>Credit</dt>
                        <dd>{selectedItem.content.credit ?? "Not supplied"}</dd>
                      </div>
                      <div>
                        <dt>Licence</dt>
                        <dd>
                          {selectedItem.content.licence ?? "Not supplied"}
                        </dd>
                      </div>
                      <div>
                        <dt>Usage note</dt>
                        <dd>
                          {selectedItem.content.usageNote ?? "Not supplied"}
                        </dd>
                      </div>
                    </dl>
                  )}
                  {editMessage ? (
                    <p className="form-message" role="status">
                      {editMessage}
                    </p>
                  ) : null}
                  <div className="stills-provenance">
                    <strong>Provenance</strong>
                    <span>
                      {selectedSource?.kind?.replace(/_/gu, " ") ??
                        "Source record"}{" "}
                      · source {selectedItem.sourceId}
                    </span>
                    {selectedSourceName ? (
                      <span>{selectedSourceName}</span>
                    ) : null}
                    {selectedSourceLink ? (
                      <a
                        href={selectedSourceLink}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open source link
                      </a>
                    ) : null}
                    {selectedPageLink &&
                    selectedPageLink !== selectedSourceLink ? (
                      <a
                        href={selectedPageLink}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open containing page
                      </a>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="stills-empty-detail">
                  <h3>Select a saved still</h3>
                  <p>
                    Choose a thumbnail to inspect the kept preview, metadata and
                    provenance.
                  </p>
                </div>
              )}
            </div>
          </div>

          <form
            className="stills-import-panel"
            onSubmit={(event) => void saveNewStill(event)}
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Retain an image</p>
                <h3>{formTitle}</h3>
              </div>
              {cropTarget ? (
                <button
                  type="button"
                  className="quiet-button"
                  onClick={resetForm}
                >
                  Cancel crop
                </button>
              ) : null}
            </div>
            {!cropTarget ? (
              <div
                className="stills-mode-tabs"
                role="tablist"
                aria-label="Still import method"
              >
                {(["url", "file", "page_picture"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={importMode === mode}
                    className={importMode === mode ? "selected" : ""}
                    onClick={() => {
                      setImportMode(mode);
                      setFormError(undefined);
                      setFormMessage(undefined);
                    }}
                  >
                    {mode === "url"
                      ? "Public image URL"
                      : mode === "file"
                        ? "Upload file"
                        : "Page picture"}
                  </button>
                ))}
              </div>
            ) : null}
            {!cropTarget && importMode === "url" ? (
              <label>
                Public image URL
                <input
                  type="url"
                  required
                  value={draft.url}
                  onChange={(event) => updateDraft("url", event.target.value)}
                  placeholder="https://example.org/image.jpg"
                />
              </label>
            ) : null}
            {!cropTarget && importMode !== "url" ? (
              <label>
                Image file
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFile}
                />
              </label>
            ) : null}
            {!cropTarget && importMode === "file" ? (
              <label>
                Original image URL (optional)
                <input
                  type="url"
                  value={draft.originalUrl}
                  onChange={(event) =>
                    updateDraft("originalUrl", event.target.value)
                  }
                />
              </label>
            ) : null}
            {!cropTarget && importMode === "page_picture" ? (
              <label>
                Existing web-page source
                <select
                  required
                  value={pageSourceId}
                  onChange={(event) => {
                    setPageSourceId(event.target.value);
                    const selected = pageSources.find(
                      (source) => source.id === event.target.value,
                    );
                    const url = sourceUrl(selected);
                    if (url)
                      setDraft((current) => ({
                        ...current,
                        pageUrl: current.pageUrl || url,
                      }));
                  }}
                >
                  <option value="">Choose a source</option>
                  {pageSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {sourceLabel(source) ?? source.id}
                    </option>
                  ))}
                </select>
                {formSourceHint ? <span>{formSourceHint}</span> : null}
              </label>
            ) : null}
            <div className="stills-form-grid">
              <label>
                Title
                <input
                  required
                  value={draft.title}
                  onChange={(event) => updateDraft("title", event.target.value)}
                />
              </label>
              <label>
                Topics
                <input
                  value={draft.topics}
                  onChange={(event) =>
                    updateDraft("topics", event.target.value)
                  }
                  placeholder="topic, person, theme"
                />
              </label>
              <label>
                Credit
                <input
                  value={draft.credit}
                  onChange={(event) =>
                    updateDraft("credit", event.target.value)
                  }
                />
              </label>
              <label>
                Licence
                <input
                  value={draft.licence}
                  onChange={(event) =>
                    updateDraft("licence", event.target.value)
                  }
                />
              </label>
              <label>
                Page URL (optional)
                <input
                  type="url"
                  value={draft.pageUrl}
                  onChange={(event) =>
                    updateDraft("pageUrl", event.target.value)
                  }
                />
              </label>
              <label>
                Alt text (optional)
                <input
                  value={draft.altText}
                  onChange={(event) =>
                    updateDraft("altText", event.target.value)
                  }
                />
              </label>
            </div>
            <label>
              Usage note (optional)
              <textarea
                rows={3}
                value={draft.usageNote}
                onChange={(event) =>
                  updateDraft("usageNote", event.target.value)
                }
                placeholder="Context, intended use or rights reminder"
              />
            </label>
            {importMode === "page_picture" || cropTarget ? (
              <div className="stills-crop-editor">
                <div className="stills-crop-preview" ref={cropPreviewRef}>
                  {cropPreviewUrl ? (
                    <>
                      <img
                        ref={cropImageRef}
                        src={cropPreviewUrl}
                        alt={formPreviewAlt}
                        onLoad={measureCropPreview}
                        onError={() => setCropLayout(undefined)}
                      />
                      {cropBounds ? (
                        <div
                          ref={cropSurfaceRef}
                          className="stills-crop-surface"
                          aria-hidden="true"
                          style={{
                            left: cropBounds.left,
                            top: cropBounds.top,
                            width: cropBounds.width,
                            height: cropBounds.height,
                            pointerEvents: formBusy ? "none" : undefined,
                          }}
                          onPointerDown={handleCropPointerDown}
                          onPointerMove={handleCropPointerMove}
                          onPointerUp={(event) =>
                            finishCropPointer(event, true)
                          }
                          onPointerCancel={(event) =>
                            finishCropPointer(event, false)
                          }
                          onLostPointerCapture={(event) =>
                            finishCropPointer(event, false)
                          }
                        >
                          <div
                            className="stills-crop-box"
                            data-full={
                              crop.x === 0 &&
                              crop.y === 0 &&
                              crop.width === 1 &&
                              crop.height === 1
                            }
                            style={{
                              left: `${crop.x * 100}%`,
                              top: `${crop.y * 100}%`,
                              width: `${crop.width * 100}%`,
                              height: `${crop.height * 100}%`,
                            }}
                          >
                            {(["nw", "ne", "sw", "se"] as const).map(
                              (corner) => (
                                <span
                                  className="stills-crop-handle"
                                  data-crop-corner={corner}
                                  key={corner}
                                />
                              ),
                            )}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span>
                      {cropTarget
                        ? assetState.loading
                          ? "Loading saved still preview…"
                          : "Saved still preview unavailable."
                        : "Choose an image to preview the crop."}
                    </span>
                  )}
                </div>
                <div
                  className="stills-crop-coordinates"
                  aria-describedby="stills-crop-help"
                >
                  <p id="stills-crop-help">
                    Drag on the image to draw a crop, drag inside to move, or
                    drag a corner to resize. Coordinates are normalized to the
                    oriented image; use arrow keys or type values from 0 to 1.
                  </p>
                  {(["x", "y", "width", "height"] as const).map((field) => (
                    <label key={field}>
                      {field === "x"
                        ? "Left (x)"
                        : field === "y"
                          ? "Top (y)"
                          : field === "width"
                            ? "Width"
                            : "Height"}
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={crop[field]}
                        onChange={(event) =>
                          updateCrop(field, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <p className="rights-statement">
              Saved copy; permission to use this image is not verified.
            </p>
            {formError ? (
              <p className="form-message error" role="alert">
                {formError}
              </p>
            ) : null}
            {formMessage ? (
              <p className="form-message" role="status">
                {formMessage}
              </p>
            ) : null}
            <div className="action-row">
              <button
                className="primary-action"
                type="submit"
                disabled={
                  formBusy ||
                  !canWrite ||
                  Boolean(
                    normalizedCropError &&
                    (importMode === "page_picture" || cropTarget),
                  )
                }
              >
                {formBusy
                  ? "Saving…"
                  : cropTarget
                    ? "Save cropped still"
                    : "Save new still"}
              </button>
              <button type="button" onClick={resetForm} disabled={formBusy}>
                Cancel
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
