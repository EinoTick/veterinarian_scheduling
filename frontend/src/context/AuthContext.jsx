import { createContext, useCallback, useContext, useEffect, useState } from "react";

const AuthContext = createContext(null);

const TOKEN_KEY = "vc_token";
const API = "http://localhost:8000";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!localStorage.getItem(TOKEN_KEY));

  // Fetch /me whenever the token changes
  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("invalid token");
        return r.json();
      })
      .then((u) => setUser(u))
      .catch(() => {
        // Token is stale or invalid — clear it
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const login = useCallback(async (email, password) => {
    const form = new URLSearchParams({ username: email, password });
    const res = await fetch(`${API}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail ?? "Login failed.");
    }
    const { access_token } = await res.json();
    localStorage.setItem(TOKEN_KEY, access_token);
    setToken(access_token);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // Authenticated fetch helper — automatically attaches the Bearer token
  const apiFetch = useCallback(
    (path, options = {}) => {
      return fetch(`${API}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
    },
    [token]
  );

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, apiFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
