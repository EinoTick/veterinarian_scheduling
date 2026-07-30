/**
 * Shared domain constants. Single source of truth for values that were
 * previously hand-duplicated across several components — keeps them in sync
 * when a new presence type / role / status is added.
 */

export const PRESENCE_TYPES = ["IN_ROOM", "IN_BUILDING", "REMOTE"];

export const PRESENCE_TYPE_LABELS = {
  IN_ROOM: "In Room",
  IN_BUILDING: "In Building",
  REMOTE: "Remote",
};

export const PRESENCE_TYPE_COLORS = {
  IN_ROOM: "#3b82f6",
  IN_BUILDING: "#8b5cf6",
  REMOTE: "#10b981",
};

export const PRESENCE_TYPE_OPTIONS = PRESENCE_TYPES.map((value) => ({
  value,
  label: PRESENCE_TYPE_LABELS[value],
}));

export const ROLE_BADGE_VARIANT = {
  SYSTEM_ADMIN: "destructive",
  CLINIC_ADMIN: "default",
  USER: "secondary",
};

export const APPOINTMENT_STATUS_VARIANT = {
  scheduled: "secondary",
  completed: "success",
  cancelled: "outline",
  no_show: "destructive",
};
