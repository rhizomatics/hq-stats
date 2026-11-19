// Fetch with retries. The User-Agent is generic, so requests don't carry the org's name.
export const USER_AGENT = "hq-stats (+https://github.com/rhizomatics/hq-stats)";

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.status = status;
    this.url = url;
  }
}

export async function get(url, { headers = {}, raw = false, attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return raw ? await res.text() : await res.json();
      // Retry only what might pass next time: rate limits and server errors.
      if (res.status !== 429 && res.status < 500) throw new HttpError(res.status, url);
      if (attempt >= attempts) throw new HttpError(res.status, url);
    } catch (err) {
      if (err instanceof HttpError && err.status !== 429 && err.status < 500) throw err;
      if (attempt >= attempts) throw err;
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
