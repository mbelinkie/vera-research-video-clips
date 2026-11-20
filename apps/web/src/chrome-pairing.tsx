import React, { useState } from "react";
import { z } from "zod";
import { cloudFetch } from "./browser-api.ts";
import { captureSession } from "./capture-session.ts";

export function ChromePairing() {
  const requestId = z.uuid().safeParse(location.hash.slice(1));
  const [session, setSession] =
    useState<Awaited<ReturnType<typeof captureSession>>>();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function load() {
    try {
      setSession(await captureSession());
      setMessage("");
    } catch {
      setSession(undefined);
      setMessage(
        "Sign in to Research or reconnect to the managed app, then retry.",
      );
    }
  }
  React.useEffect(() => {
    void load();
  }, []);
  const manage = location.search === "?chrome-connections";
  async function approve(event: React.FormEvent) {
    event.preventDefault();
    if (
      busy ||
      !session ||
      window.top !== window.self ||
      (!manage && !requestId.success)
    )
      return;
    setBusy(true);
    try {
      const current = await captureSession();
      if (
        current.authorization !== session.authorization ||
        current.csrfToken !== session.csrfToken
      ) {
        setSession(current);
        throw new Error(
          "Your session changed. Review the account and confirm again.",
        );
      }
      const response = await cloudFetch(
        "/cloud-api/api/extension-connections",
        manage
          ? { method: "DELETE" }
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ requestId: requestId.data, code }),
            },
        current,
      );
      if (!response.ok)
        throw new Error(
          manage
            ? "Unable to disconnect. Check your sign-in and try again."
            : "Check the eight-digit code. Connections expire after five minutes.",
        );
      setDone(true);
      setMessage(
        manage
          ? "Chrome connections disconnected."
          : "Connected. You can close this window and save from Chrome.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Research is unavailable.");
    } finally {
      setBusy(false);
    }
  }
  if (window.top !== window.self) return null;
  return (
    <main className="chrome-pair">
      <h1>
        {manage ? "Disconnect Chrome extensions" : "Connect Chrome to VERA"}
      </h1>
      {!done && (
        <>
          {session ? (
            <form onSubmit={(e) => void approve(e)}>
              <p>
                Signed in as <strong>{session.account}</strong>.
              </p>
              {manage ? (
                <p>
                  Disconnecting ends every Chrome capture connection for this
                  account.
                </p>
              ) : (
                <>
                  <p>
                    Enter the code shown in your VERA extension. This lets that
                    installation save captures and queue videos in projects you
                    can edit for 30 days.
                  </p>
                  <label>
                    Connection code
                    <input
                      required
                      autoFocus
                      inputMode="numeric"
                      pattern="[0-9]{8}"
                      maxLength={8}
                      autoComplete="off"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                </>
              )}
              <button
                disabled={
                  busy || (!manage && (!requestId.success || code.length !== 8))
                }
              >
                {manage ? "Disconnect all extensions" : "Connect extension"}
              </button>
            </form>
          ) : (
            <>
              <a href="/" target="_blank" rel="noreferrer">
                Open Research to sign in
              </a>{" "}
              <button onClick={() => void load()}>Retry connection</button>
            </>
          )}
        </>
      )}
      <p role="status">{message}</p>
    </main>
  );
}
