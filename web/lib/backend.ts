/**
 * Server-side helper for talking to the SkyReels-V2 inference API.
 *
 * The browser never talks to the GPU backend directly. Next.js route handlers
 * (app/api/*) call these helpers, which attach the shared API key server-side.
 * When SKYREELS_API_URL is unset, the app runs in stateless demo mode instead.
 */

export function getBackendUrl(): string | null {
  const url = process.env.SKYREELS_API_URL?.trim();
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

export function isDemoMode(): boolean {
  return getBackendUrl() === null;
}

function authHeaders(): Record<string, string> {
  const key = process.env.SKYREELS_API_KEY?.trim();
  return key ? { "x-api-key": key } : {};
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function backendFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const base = getBackendUrl();
  if (!base) throw new Error("No backend configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers || {}) },
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Wrap a handler so backend/network errors become clean JSON 502s. */
export function backendError(err: unknown): Response {
  const message = err instanceof Error ? err.message : "Backend request failed";
  const isAbort = err instanceof Error && err.name === "AbortError";
  return new Response(
    JSON.stringify({
      error: isAbort ? "The inference backend timed out." : message,
      hint: "Check SKYREELS_API_URL and that the GPU backend is reachable.",
    }),
    { status: 502, headers: { "content-type": "application/json" } }
  );
}
