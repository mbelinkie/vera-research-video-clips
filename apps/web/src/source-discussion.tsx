import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { z } from "zod";
import {
  SourceDiscussionCountSchema,
  SourceDiscussionPageSchema,
} from "@research-video/contracts";
import {
  commentLabel,
  researchError,
  useResearchMutation,
  useResearchRead,
} from "./research-catalog.tsx";
import {
  jsonWrite,
  projectPath,
  readResearch,
  type ResearchRequest,
} from "./research-library-data.ts";

const countMapSchema = z.record(z.uuid(), SourceDiscussionCountSchema);
const emptyCount = { total: 0, unread: 0 };

export function getDiscussionCounts(
  request: ResearchRequest,
  projectId: string,
  ids: string[],
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ ids: ids.join(",") });
  return readResearch(
    request,
    `${projectPath(projectId)}/source-discussion-counts?${query}`,
    countMapSchema,
    { signal },
  );
}

export function SourceDiscussion({
  request,
  projectId,
  sourceId,
  refresh,
  onChanged,
}: {
  request: ResearchRequest;
  projectId: string;
  sourceId: string;
  refresh: number;
  onChanged(): void;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [savedCount, setSavedCount] =
    useState<z.infer<typeof SourceDiscussionCountSchema>>();
  const write = useResearchMutation();
  const draftKey = useRef(crypto.randomUUID());
  const loadedUnread = useRef(new Set<string>());
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const base = `${projectPath(projectId)}/sources/${sourceId}/discussion`;
  const loadCounts = useCallback(
    async (signal: AbortSignal) => {
      const counts = await getDiscussionCounts(
        request,
        projectId,
        [sourceId],
        signal,
      );
      return counts[sourceId] ?? emptyCount;
    },
    [projectId, request, sourceId],
  );
  const loadPage = useCallback(
    (signal: AbortSignal) =>
      readResearch(
        request,
        `${base}?offset=${offset}`,
        SourceDiscussionPageSchema,
        { signal },
      ),
    [base, offset, request],
  );
  const count = useResearchRead(loadCounts, true, refresh, true);
  const page = useResearchRead(loadPage, open, retry, true);

  useEffect(() => {
    if (count.data) setSavedCount(count.data);
  }, [count.data]);
  useEffect(() => {
    if (!open) return;
    for (const comment of page.data?.comments ?? []) {
      if (comment.unread) loadedUnread.current.add(comment.id);
    }
  }, [open, page.data]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);

  function start() {
    setOffset(0);
    setError(undefined);
    setOpen(true);
  }

  async function close() {
    if (write.current) return;
    const unread = [...loadedUnread.current];
    if (unread.length) {
      const controller = new AbortController();
      write.current = controller;
      setBusy(true);
      try {
        for (let index = 0; index < unread.length; index += 50) {
          const counts = await readResearch(
            request,
            `${base}/read`,
            countMapSchema,
            {
              ...jsonWrite("POST", unread.slice(index, index + 50)),
              signal: controller.signal,
            },
          );
          if (controller.signal.aborted) return;
          setSavedCount(counts[sourceId] ?? emptyCount);
        }
        loadedUnread.current.clear();
        onChanged();
      } catch (caught) {
        if (!controller.signal.aborted)
          setError(researchError(caught, "Unable to update unread comments."));
        return;
      } finally {
        write.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  }

  async function reply(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || !page.data?.canReply || write.current) return;
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      await readResearch(request, base, z.object({ id: z.uuid() }), {
        ...jsonWrite("POST", { id: draftKey.current, body: draft }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setDraft("");
      draftKey.current = crypto.randomUUID();
      setRetry((value) => value + 1);
      onChanged();
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(researchError(caught, "Unable to post your reply."));
    } finally {
      write.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        ref={trigger}
        aria-haspopup="dialog"
        onClick={start}
      >
        {savedCount?.total ? commentLabel(savedCount) : "Comments"}
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="research-discussion"
          aria-labelledby={heading}
          onCancel={(event) => {
            event.preventDefault();
            void close();
          }}
        >
          <div className="section-heading">
            <h3 id={heading}>Source comments</h3>
            <button type="button" disabled={busy} onClick={() => void close()}>
              Close comments
            </button>
          </div>
          {page.error && (
            <p role="alert">
              {page.error}{" "}
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Try again
              </button>
            </p>
          )}
          {!page.data && !page.error && <p role="status">Loading comments…</p>}
          {page.data?.comments.length === 0 && <p>No comments yet.</p>}
          <ul className="research-rows">
            {page.data?.comments.map((comment) => (
              <li key={comment.id} className="research-comment">
                <div>
                  <strong>{comment.authorName}</strong>{" "}
                  {comment.unread && <span className="research-new">New</span>}
                  <time dateTime={comment.createdAt}>
                    {new Date(comment.createdAt).toLocaleDateString()}
                  </time>
                </div>
                <p>{comment.body}</p>
              </li>
            ))}
          </ul>
          {!!(offset || page.data?.more) && (
            <div className="research-pagination">
              <button
                type="button"
                disabled={!offset}
                onClick={() => setOffset((value) => value - 50)}
              >
                Previous comments
              </button>
              <button
                type="button"
                disabled={!page.data?.more || offset >= 100000}
                onClick={() => setOffset((value) => value + 50)}
              >
                More comments
              </button>
            </div>
          )}
          {page.data?.canReply && (
            <form onSubmit={(event) => void reply(event)}>
              <label>
                Reply{" "}
                <textarea
                  maxLength={2000}
                  value={draft}
                  disabled={busy}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    draftKey.current = crypto.randomUUID();
                  }}
                />
              </label>
              <button type="submit" disabled={busy || !draft.trim()}>
                Post reply
              </button>
            </form>
          )}
          {error && <p role="alert">{error}</p>}
        </dialog>
      )}
    </>
  );
}
