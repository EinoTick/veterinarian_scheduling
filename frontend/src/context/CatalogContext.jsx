/**
 * Shared clinic reference data (services, staff, resources, roles, rules, clinics, clients).
 * Deduplicates in-flight fetches so modals/pages do not hammer the API on every open.
 *
 * Failures are NOT cached as empty arrays — the next ensure() retries.
 * Per-key generation tokens ignore stale responses after invalidate / session change.
 * Failed keys are reported via `errors` / `lastError` so callers can surface them.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";

const CatalogContext = createContext(null);

const EMPTY = Object.freeze([]);

const PATHS = {
  services: "/api/services",
  staff: "/api/staff",
  resources: "/api/resources",
  roles: "/api/roles",
  rules: "/api/rules",
  clinics: "/api/clinics",
  clients: "/api/clients",
};

const ALL_KEYS = Object.keys(PATHS);

function emptyGens() {
  return Object.fromEntries(ALL_KEYS.map((k) => [k, 0]));
}

export function CatalogProvider({ children }) {
  const { apiFetch, user } = useAuth();
  const cacheRef = useRef({
    services: null,
    staff: null,
    resources: null,
    roles: null,
    rules: null,
    clinics: null,
    clients: null,
  });
  const inflightRef = useRef({});
  const keyGenRef = useRef(emptyGens());
  const [version, setVersion] = useState(0);
  const [errors, setErrors] = useState({});
  const userKey = user ? `${user.id}:${user.system_role}:${user.clinic_id ?? ""}` : null;

  const clearKeys = useCallback((keys) => {
    for (const k of keys) {
      keyGenRef.current[k] = (keyGenRef.current[k] ?? 0) + 1;
      cacheRef.current[k] = null;
      delete inflightRef.current[k];
    }
    setErrors((prev) => {
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
    setVersion((n) => n + 1);
  }, []);

  useEffect(() => {
    clearKeys(ALL_KEYS);
  }, [userKey, clearKeys]);

  const fetchKey = useCallback(
    async (key) => {
      if (cacheRef.current[key] != null) return cacheRef.current[key];
      if (inflightRef.current[key]) return inflightRef.current[key];

      const myGen = keyGenRef.current[key];
      const promise = (async () => {
        try {
          const r = await apiFetch(PATHS[key]);
          if (myGen !== keyGenRef.current[key]) {
            return cacheRef.current[key] ?? EMPTY;
          }
          if (!r.ok) {
            throw new Error(`Failed to load ${key}`);
          }
          const data = await r.json();
          if (myGen !== keyGenRef.current[key]) {
            return cacheRef.current[key] ?? EMPTY;
          }
          const list = Array.isArray(data) ? data : [];
          cacheRef.current[key] = list;
          setErrors((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          });
          setVersion((n) => n + 1);
          return list;
        } catch (err) {
          if (myGen === keyGenRef.current[key]) {
            setErrors((prev) => ({
              ...prev,
              [key]: err?.message || `Failed to load ${key}`,
            }));
            setVersion((n) => n + 1);
          }
          throw err;
        } finally {
          if (inflightRef.current[key] === promise) {
            delete inflightRef.current[key];
          }
        }
      })();

      inflightRef.current[key] = promise;
      return promise;
    },
    [apiFetch]
  );

  const ensure = useCallback(
    async (keys = ALL_KEYS) => {
      const wanted = keys.filter((k) => PATHS[k]);
      const results = await Promise.allSettled(wanted.map((k) => fetchKey(k)));
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) {
        const msg = failed.map((r) => r.reason?.message || "catalog load failed").join("; ");
        throw new Error(msg || "Failed to load catalog.");
      }
      return cacheRef.current;
    },
    [fetchKey]
  );

  const invalidate = useCallback(
    (keys = null) => {
      clearKeys(keys == null ? ALL_KEYS : keys.filter((k) => PATHS[k]));
    },
    [clearKeys]
  );

  const dismissErrors = useCallback(() => setErrors({}), []);

  const forClinic = useCallback((items, clinicId) => {
    if (clinicId == null || clinicId === "") return items ?? EMPTY;
    const cid = Number(clinicId);
    return (items ?? EMPTY).filter((x) => x.clinic_id === cid);
  }, []);

  const value = useMemo(() => {
    const snap = cacheRef.current;
    const failedKeys = Object.keys(errors);
    return {
      services: snap.services ?? EMPTY,
      staff: snap.staff ?? EMPTY,
      resources: snap.resources ?? EMPTY,
      roles: snap.roles ?? EMPTY,
      rules: snap.rules ?? EMPTY,
      clinics: snap.clinics ?? EMPTY,
      clients: snap.clients ?? EMPTY,
      ensure,
      invalidate,
      forClinic,
      errors,
      lastError: failedKeys.length
        ? `Could not load: ${failedKeys.join(", ")}`
        : null,
      dismissErrors,
      ready: {
        services: snap.services != null,
        staff: snap.staff != null,
        resources: snap.resources != null,
        roles: snap.roles != null,
        rules: snap.rules != null,
        clinics: snap.clinics != null,
        clients: snap.clients != null,
      },
    };
  }, [ensure, invalidate, forClinic, version, errors, dismissErrors]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog must be used inside <CatalogProvider>");
  return ctx;
}
