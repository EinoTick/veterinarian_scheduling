/**
 * Capability matrix for system roles.
 * Clinical roles (Vet, Tech…) are orthogonal — they describe the job, not ACL.
 *
 * USER          — front-desk / clinical staff: book, view schedules, manage clients
 * CLINIC_ADMIN  — clinic settings, catalog, users, rules, override audit
 * SYSTEM_ADMIN  — all clinics, create clinics, global clinical roles
 */
export const SYSTEM_ROLES = ["USER", "CLINIC_ADMIN", "SYSTEM_ADMIN"];

export const CAPABILITIES = {
  book: ["USER", "CLINIC_ADMIN", "SYSTEM_ADMIN"],
  viewSchedules: ["USER", "CLINIC_ADMIN", "SYSTEM_ADMIN"],
  manageClients: ["USER", "CLINIC_ADMIN", "SYSTEM_ADMIN"],
  manageCatalog: ["CLINIC_ADMIN", "SYSTEM_ADMIN"], // resources, services, rules, users
  viewOverrideAudit: ["CLINIC_ADMIN", "SYSTEM_ADMIN"],
  manageClinicSettings: ["CLINIC_ADMIN", "SYSTEM_ADMIN"],
  createClinic: ["SYSTEM_ADMIN"],
  manageClinicalRoles: ["CLINIC_ADMIN", "SYSTEM_ADMIN"],
  authorizeOverride: ["CLINIC_ADMIN", "SYSTEM_ADMIN"],
};

export function can(role, capability) {
  const allowed = CAPABILITIES[capability];
  if (!allowed) return false;
  return allowed.includes(role);
}

export function isAdminRole(role) {
  return role === "CLINIC_ADMIN" || role === "SYSTEM_ADMIN";
}

/** Common IANA zones for clinic settings (server still validates any IANA name). */
export const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Helsinki",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];
