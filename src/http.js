// Fetch with retries. The User-Agent is generic, so requests don't carry the org's name.
export const USER_AGENT = "hq-stats (+https://github.com/rhizomatics/hq-stats)";

export class HttpError extends Error {
  // `body` is the start of the error response, kept for diagnosis; the message stays `HTTP <status>`.
  constructor(status, url, body = "") {
    super(`HTTP ${status}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const errorBody = async (res) => {
  try {
    return (await res.text()).replace(/\s+/g, " ").trim().slice(0, 200);
  } catch {
    return "";
  }
};

// Retries what might pass next time: rate limits, server errors, and any status in `retryOn` (for an API known
// to fail spuriously with it).
export async function get(url, { headers = {}, raw = false, attempts = 3, retryOn = [] } = {}) {
  const retryable = (status) => status === 429 || status >= 500 || retryOn.includes(status);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return raw ? await res.text() : await res.json();
      const err = new HttpError(res.status, url, await errorBody(res));
      if (!retryable(res.status) || attempt >= attempts) throw err;
      const { host, pathname } = new URL(url);
      console.warn(`hq-stats: ${err.message} from ${host}${pathname}, retrying`);
    } catch (err) {
      if (err instanceof HttpError && !retryable(err.status)) throw err;
      if (attempt >= attempts) throw err;
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
