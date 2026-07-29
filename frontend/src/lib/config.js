/**
 * Frontend API base URL.
 *
 * Default "" = same-origin (Vite proxies /api → backend in dev).
 * Set VITE_API_BASE when the SPA is served from a different origin than the API
 * (e.g. VITE_API_BASE=https://api.example.com).
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? "";
