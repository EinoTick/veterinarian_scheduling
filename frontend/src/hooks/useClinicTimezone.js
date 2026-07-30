import { useEffect, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/context/CatalogContext";
import { normalizeClinicTz } from "@/lib/datetime";

/**
 * Resolve the IANA timezone for scheduling UI.
 * SYSTEM_ADMIN: selected clinic (or UTC until chosen).
 * Everyone else: their clinic from catalog /auth/me.
 */
export function useClinicTimezone(selectedClinicId = null) {
  const { user } = useAuth();
  const { clinics, ensure } = useCatalog();

  useEffect(() => {
    ensure(["clinics"]).catch(() => {});
  }, [ensure]);

  return useMemo(() => {
    const isSysAdmin = user?.system_role === "SYSTEM_ADMIN";
    if (isSysAdmin && selectedClinicId) {
      const c = clinics.find((x) => String(x.id) === String(selectedClinicId));
      if (c?.timezone) return normalizeClinicTz(c.timezone);
    }
    if (!isSysAdmin && user?.clinic_id) {
      const c = clinics.find((x) => x.id === user.clinic_id);
      if (c?.timezone) return normalizeClinicTz(c.timezone);
      if (user.clinic_timezone) return normalizeClinicTz(user.clinic_timezone);
    }
    if (user?.clinic_timezone) return normalizeClinicTz(user.clinic_timezone);
    return "UTC";
  }, [user, clinics, selectedClinicId]);
}
