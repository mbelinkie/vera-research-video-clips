export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`Invalid timestamp: ${seconds}`);
  }
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remainingSeconds = total % 60;
  const secondsText = String(remainingSeconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secondsText}`
    : `${minutes}:${secondsText}`;
}
