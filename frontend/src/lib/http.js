/** Shared helpers for API response handling. */

export function detailMessage(errBody, fallback = "Request failed.") {
  if (!errBody) return fallback;
  if (typeof errBody.detail === "string") return errBody.detail;
  if (Array.isArray(errBody.detail)) {
    return errBody.detail.map((d) => d.msg || JSON.stringify(d)).join(" ");
  }
  return fallback;
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
