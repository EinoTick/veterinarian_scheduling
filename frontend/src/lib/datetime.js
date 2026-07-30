/** Local datetime helpers for forms ↔ API UTC contract. */

/** Format a Date for `<input type="datetime-local">` in local wall time. */
export function toLocalDatetimeValue(date = new Date()) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** True when a datetime-local value is before now (local interpretation). */
export function isPastLocalDatetime(value) {
  if (!value) return false;
  return new Date(value).getTime() < Date.now();
}

/**
 * Convert a datetime-local value (local wall time, no offset) to UTC ISO with Z.
 * Backend treats naive timestamps as UTC — always send an offset/Z from the SPA.
 */
export function localDatetimeToUtcIso(value) {
  if (!value) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

/** Format an ISO datetime string (UTC) for display in the viewer's local time. */
export function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
