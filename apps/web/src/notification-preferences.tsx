import { useEffect, useState } from "react";

import type {
  DesktopNotificationPreferences,
  DesktopNotificationSupportStatus,
} from "@research-video/contracts";

import { desktopBridge } from "./api-client.ts";

export function NotificationPreferencesPanel({
  signedIn,
}: Readonly<{ signedIn: boolean }>) {
  const [support, setSupport] = useState<DesktopNotificationSupportStatus>();
  const [preferences, setPreferences] =
    useState<DesktopNotificationPreferences>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) {
      setSupport({ available: false, reason: "browser_runtime" });
      setPreferences(undefined);
      return;
    }
    let active = true;
    void bridge
      .getNotificationSupport()
      .then(async (status) => {
        if (!active) return;
        setSupport(status);
        if (status.available && signedIn) {
          const loaded = await bridge.getNotificationPreferences();
          if (active) setPreferences(loaded);
        } else {
          setPreferences(undefined);
        }
      })
      .catch(() => {
        if (active) {
          setSupport({ available: false, reason: "unsupported_platform" });
          setPreferences(undefined);
        }
      });
    return () => {
      active = false;
    };
  }, [signedIn]);

  async function update(enabled: boolean) {
    const bridge = desktopBridge();
    if (!bridge) return;
    setBusy(true);
    setMessage("");
    try {
      const updated = await bridge.updateNotificationPreferences({ enabled });
      setPreferences(updated);
      setMessage(
        enabled
          ? "Desktop workflow and direct-mention notifications are on for this account."
          : "Desktop notifications are off.",
      );
    } catch {
      setMessage("Desktop notification preferences could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  const unavailable =
    support?.reason === "browser_runtime"
      ? "Native notifications are unavailable in browser development."
      : support && !support.available
        ? "Native notifications are unavailable on this device."
        : !signedIn
          ? "Sign in to manage account-scoped desktop notifications."
          : "Checking desktop notification support…";

  return (
    <section
      className="notification-preferences"
      aria-label="Desktop notifications"
    >
      <strong>Desktop notifications</strong>
      {support?.available && signedIn && preferences ? (
        <>
          <label>
            <input
              type="checkbox"
              checked={preferences.enabled}
              disabled={busy}
              onChange={(event) => void update(event.target.checked)}
            />{" "}
            Workflow outcomes and direct mentions
          </label>
          <small>
            Off by default. Events older than the time you enable this setting
            are not replayed.
          </small>
        </>
      ) : (
        <small>{unavailable}</small>
      )}
      {message ? <small role="status">{message}</small> : null}
    </section>
  );
}
