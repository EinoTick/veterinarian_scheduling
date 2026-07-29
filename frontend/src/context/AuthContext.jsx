import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/config";
import { detailMessage } from "@/lib/http";

const AuthContext = createContext(null);

// Prefer same-origin (Vite proxy) so httpOnly cookies stay first-party.
// Override with VITE_API_BASE when the API is on a different origin.
const API = API_BASE;

let refreshInFlight = null;

async function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function fetchMe(signal) {
  return fetch(`${API}/api/auth/me`, {
    credentials: "include",
    signal,
  });
}

function buildFetchHeaders(options = {}) {
  const headers = {
    "X-Requested-With": "XMLHttpRequest",
    ...(options.headers ?? {}),
  };
  // Only default JSON content-type when a body is being sent and the caller
  // did not already choose one (avoids odd GET/HEAD content-type noise).
  const method = (options.method ?? "GET").toUpperCase();
  const hasBody = options.body != null && options.body !== "";
  if (hasBody && method !== "GET" && method !== "HEAD" && !("Content-Type" in headers)) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef(null);
  const logoutInFlight = useRef(null);
  userRef.current = user;

  const clearClientSession = useCallback(() => {
    setUser(null);
  }, []);

  const bootstrap = useCallback(async (signal) => {
    let res = await fetchMe(signal);
    if (res.status === 401) {
      const ok = await refreshSession();
      if (ok) res = await fetchMe(signal);
    }
    if (!res.ok) {
      setUser(null);
      return null;
    }
    const me = await res.json();
    setUser(me);
    return me;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    bootstrap(controller.signal)
      .catch((err) => {
        if (!active || err.name === "AbortError") return;
        setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [bootstrap]);

  const login = useCallback(async (email, password) => {
    const form = new URLSearchParams({ username: email, password });
    const res = await fetch(`${API}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(detailMessage(err, res.status === 429 ? "Too many attempts." : "Login failed."));
    }
    // Clear any stale localStorage token from older builds
    try {
      localStorage.removeItem("vc_token");
    } catch {
      /* ignore */
    }
    const me = await bootstrap();
    if (!me) throw new Error("Signed in, but failed to load your profile.");
  }, [bootstrap]);

  const logout = useCallback(async () => {
    // Deduplicate concurrent forced logouts from parallel 401s
    if (!logoutInFlight.current) {
      logoutInFlight.current = (async () => {
        try {
          await fetch(`${API}/api/auth/logout`, {
            method: "POST",
            credentials: "include",
          });
        } catch {
          /* still clear client state */
        }
        try {
          localStorage.removeItem("vc_token");
        } catch {
          /* ignore */
        }
        clearClientSession();
      })().finally(() => {
        logoutInFlight.current = null;
      });
    }
    return logoutInFlight.current;
  }, [clearClientSession]);

  const apiFetch = useCallback(
    async (path, options = {}) => {
      if (!userRef.current) {
        return Promise.reject(new Error("Not authenticated"));
      }

      const doFetch = () =>
        fetch(`${API}${path}`, {
          ...options,
          credentials: "include",
          headers: buildFetchHeaders(options),
        });

      let res = await doFetch();
      if (res.status !== 401) return res;

      const refreshed = await refreshSession();
      if (refreshed) {
        res = await doFetch();
        if (res.status !== 401) return res;
      }

      // Session dead — force re-login (ProtectedRoute redirects when user becomes null)
      await logout();
      return res;
    },
    [logout]
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, apiFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
