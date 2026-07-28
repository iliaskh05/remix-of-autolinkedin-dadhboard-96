// Resilience helper for third-party APIs (LinkedIn) that can return transient
// errors. Retries with exponential backoff instead of immediately marking a
// post as permanently failed on a 429 (rate limit) or 5xx.

export type RetryableFetchOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  retryStatusCodes?: number[];
};

const DEFAULT_RETRY_STATUS_CODES = [429, 500, 502, 503, 504];

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryableFetchOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const retryStatusCodes = opts.retryStatusCodes ?? DEFAULT_RETRY_STATUS_CODES;

  let lastResponse: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, init);
    if (!retryStatusCodes.includes(res.status) || attempt === maxAttempts) {
      return res;
    }
    lastResponse = res;
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const backoffMs = !Number.isNaN(retryAfterSeconds)
      ? Math.min(retryAfterSeconds * 1000, 8000)
      : baseDelayMs * 2 ** (attempt - 1);
    console.warn(`fetchWithRetry: ${url} responded ${res.status}, retrying in ${backoffMs}ms (attempt ${attempt}/${maxAttempts})`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  // Unreachable in practice (loop always returns on last attempt), but keeps TS happy.
  return lastResponse as Response;
}
