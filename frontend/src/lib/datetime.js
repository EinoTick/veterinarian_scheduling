/**
 * Clinic-timezone-aware datetime helpers (Luxon).
 *
 * Storage/API contract remains UTC with Z. Forms and calendars use the
 * clinic's IANA timezone for wall-clock entry and display.
 */
import { DateTime } from "luxon";

const LOCAL_FMT = "yyyy-MM-dd'T'HH:mm";

export function normalizeClinicTz(tz) {
  if (!tz || typeof tz !== "string") return "UTC";
  return DateTime.now().setZone(tz).isValid ? tz : "UTC";
}

/** Now as datetime-local value in the clinic zone. */
export function toClinicDatetimeValue(date = new Date(), clinicTz = "UTC") {
  const zone = normalizeClinicTz(clinicTz);
  return DateTime.fromJSDate(date instanceof Date ? date : new Date(date), { zone: "utc" })
    .setZone(zone)
    .toFormat(LOCAL_FMT);
}

/** True when a datetime-local wall time in clinic TZ is before "now" there. */
export function isPastClinicDatetime(value, clinicTz = "UTC") {
  if (!value) return false;
  const zone = normalizeClinicTz(clinicTz);
  const dt = DateTime.fromFormat(value, LOCAL_FMT, { zone });
  if (!dt.isValid) return false;
  return dt < DateTime.now().setZone(zone);
}

/**
 * Convert a datetime-local value (clinic wall time) to UTC ISO with Z.
 */
export function clinicDatetimeToUtcIso(value, clinicTz = "UTC") {
  if (!value) return value;
  const zone = normalizeClinicTz(clinicTz);
  const dt = DateTime.fromFormat(value, LOCAL_FMT, { zone });
  if (!dt.isValid) return value;
  return dt.toUTC().toISO({ suppressMilliseconds: false });
}

/** Convert a UTC ISO string to datetime-local value in clinic zone. */
export function utcIsoToClinicDatetimeValue(iso, clinicTz = "UTC") {
  if (!iso) return "";
  const zone = normalizeClinicTz(clinicTz);
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(zone);
  if (!dt.isValid) return "";
  return dt.toFormat(LOCAL_FMT);
}

/** Format UTC ISO for display in the clinic timezone. */
export function formatInClinic(iso, clinicTz = "UTC") {
  if (!iso) return "—";
  const zone = normalizeClinicTz(clinicTz);
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(zone);
  if (!dt.isValid) return "—";
  return dt.toLocaleString(DateTime.DATETIME_MED);
}

/** @deprecated Prefer clinic-aware helpers; kept for gradual migration. */
export function toLocalDatetimeValue(date = new Date()) {
  return toClinicDatetimeValue(date, DateTime.local().zoneName);
}

/** @deprecated Prefer isPastClinicDatetime */
export function isPastLocalDatetime(value) {
  return isPastClinicDatetime(value, DateTime.local().zoneName);
}

/** @deprecated Prefer clinicDatetimeToUtcIso */
export function localDatetimeToUtcIso(value) {
  return clinicDatetimeToUtcIso(value, DateTime.local().zoneName);
}

/** Inclusive start of a YYYY-MM-DD calendar day in clinic TZ → UTC ISO. */
export function clinicDayStartIso(dateStr, clinicTz = "UTC") {
  const zone = normalizeClinicTz(clinicTz);
  return DateTime.fromISO(dateStr, { zone }).startOf("day").toUTC().toISO();
}

/** Exclusive end (next midnight) of a YYYY-MM-DD day in clinic TZ → UTC ISO. */
export function clinicDayEndExclusiveIso(dateStr, clinicTz = "UTC") {
  const zone = normalizeClinicTz(clinicTz);
  return DateTime.fromISO(dateStr, { zone }).plus({ days: 1 }).startOf("day").toUTC().toISO();
}

/** Today as YYYY-MM-DD in clinic TZ. */
export function clinicTodayDateInput(clinicTz = "UTC") {
  return DateTime.now().setZone(normalizeClinicTz(clinicTz)).toISODate();
}

/** Format in viewer local time (fallback when clinic TZ is unavailable). */
export function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
