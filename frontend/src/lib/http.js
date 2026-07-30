/** Shared helpers for API response handling. */

export function detailMessage(errBody, fallback = "Request failed.") {
  if (!errBody) return fallback;
  if (errBody.error?.message && typeof errBody.error.message === "string") {
    return errBody.error.message;
  }
  if (typeof errBody.detail === "string") return errBody.detail;
  if (Array.isArray(errBody.detail)) {
    return errBody.detail.map((d) => d.msg || JSON.stringify(d)).join(" ");
  }
  if (errBody.detail && typeof errBody.detail === "object" && errBody.detail.type) {
    return errBody.detail.type.replaceAll("_", " ");
  }
  return fallback;
}

export function errorCode(errBody) {
  return errBody?.error?.code || errBody?.detail?.type || null;
}

export async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function readErrorMessage(res, fallback = "Request failed.") {
  const body = await readJson(res);
  return detailMessage(body, fallback);
}

/** Normalize list endpoints that return either an array or { items, total }. */
export function unwrapList(body) {
  if (Array.isArray(body)) return { items: body, total: body.length };
  return {
    items: Array.isArray(body?.items) ? body.items : [],
    total: body?.total ?? (Array.isArray(body?.items) ? body.items.length : 0),
    limit: body?.limit,
    offset: body?.offset,
  };
}

/** Short caption when a page may be truncated vs server total. */
export function listCountLabel(shown, total) {
  if (total == null || total === shown) {
    return shown === 1 ? "1 item" : `${shown} items`;
  }
  return `Showing ${shown} of ${total}`;
}
