import { inRange } from "./time.js";

export const API_BASE = "https://discord.com/api/v9";
/**
 * The most messages one request can return. Get Channel Messages takes a `limit` of 1 to 100:
 * https://discord.com/developers/docs/resources/message#get-channel-messages
 */
export const PAGE_LIMIT = 100;
/** Transient failures in a row that stop an export; the waits before each retry are `BACKOFF_MS`. */
export const MAX_CONSECUTIVE_FAILURES = 5;
export const MAX_CONSECUTIVE_RATE_LIMITS = 10;
/**
 * A runaway guard: 5000 pages of 100 is 500,000 messages, far past an ordinary range, so it stops a
 * walk that never ends. A range that really holds more is exported in shorter ranges.
 */
export const DEFAULT_PAGE_CEILING = 5000;
/**
 * The pause between pages, plus up to `PAGE_JITTER_MS`. The requests come from the user's own
 * account, so the walk is paced ahead of Discord's rate limits instead of waiting for a 429.
 */
export const DEFAULT_PAGE_DELAY_MS = 400;
export const PAGE_JITTER_MS = 200;
/** A request with no reply after this long is aborted and counts as a transient failure. */
export const REQUEST_TIMEOUT_MS = 30000;
/** The wait after a 429 whose reply names no usable retry time. */
export const FALLBACK_RATE_WAIT_MS = 5000;
/** The longest wait for an exhausted bucket's announced reset. */
export const MAX_BUCKET_WAIT_MS = 60000;
export const BACKOFF_MS = [1000, 2000, 4000, 8000];

/** Replies that stop the export after one request, because repeating the request cannot succeed. */
const REFUSALS = {
  401: "Discord rejected this session. Reload Discord, log in again and retry.",
  403: "This account cannot read this channel.",
  404: "Discord cannot find this channel.",
};

/** Ends an export. `reason` is shown in the panel, or is `"cancelled"` when the user cancelled. */
export class WalkAbortedError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "WalkAbortedError";
    this.reason = reason;
  }
}

const cancelledError = () => new WalkAbortedError("cancelled");

/** Resolves after `ms`, or rejects with a cancellation as soon as `signal` aborts. */
export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function defaultDelay(signal) {
  return abortableSleep(DEFAULT_PAGE_DELAY_MS + Math.floor(Math.random() * PAGE_JITTER_MS), signal);
}

function header(res, name) {
  return typeof res?.headers?.get === "function" ? res.headers.get(name) : null;
}

/** A wait given in seconds, as Discord's rate-limit fields are, in whole milliseconds; null if unusable. */
function seconds(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n * 1000) : null;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * A reply that is not a message array, or holds a message without a numeric ID, is a failed page.
 * Taking it as the end of history would save a truncated export under the full range's name.
 */
function isPage(body) {
  if (!Array.isArray(body)) return "Discord returned something other than a page of messages.";
  if (body.some((m) => !m || !/^\d{1,20}$/.test(String(m.id)))) return "Discord returned a page with a malformed message.";
  return null;
}

function isObject(body) {
  return body && typeof body === "object" && !Array.isArray(body) ? null : "Discord returned an unreadable reply.";
}

/**
 * Reads one channel's history through the user's session token. Every request goes to `API_BASE`
 * with the token in the `authorization` header; `fetchImpl`, `delay`, `sleepImpl`, `ceilingPages`
 * and `timeoutMs` are injectable so the unit tests run without a network or real waits.
 *
 * Each reply falls into one class. A refusal (401, 403, 404 and every other 4xx except 408 and
 * 429) stops the export at once. A 429 waits the time Discord names, at least one second and
 * `FALLBACK_RATE_WAIT_MS` when none is usable, then retries the same cursor; ten in a row stop the
 * export. Anything else that is not a readable reply (5xx, 408, a network error, a timeout, a body
 * that fails its check) retries the same cursor after `BACKOFF_MS`, and the fifth in a row stops
 * the export. Rate limits:
 * https://discord.com/developers/docs/topics/rate-limits
 *
 * @param {{channelId: string, token: string}} options
 * @returns {{run: Function, getChannelMeta: Function, getGuildName: Function, cancel: Function, pages: number}}
 * @throws {TypeError} when the channel ID is not a snowflake or the token is empty.
 */
export function createExporter({
  channelId,
  token,
  fetchImpl = fetch,
  delay = defaultDelay,
  sleepImpl = abortableSleep,
  ceilingPages = DEFAULT_PAGE_CEILING,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  if (!/^\d+$/.test(String(channelId))) {
    throw new TypeError("channelId must be a snowflake string");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("token required");
  }
  let cancelled = false;
  let pages = 0;
  const walk = new AbortController();

  /** One request, classified. Cancel and the timeout both abort it through its own controller. */
  async function attempt(url) {
    const request = new AbortController();
    const abort = () => request.abort();
    walk.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const res = await fetchImpl(url, { headers: { authorization: token }, signal: request.signal });
      if (res.status === 429) {
        const body = await readJson(res);
        const hinted = seconds(body?.retry_after) ?? seconds(header(res, "retry-after"));
        return { rateLimited: true, waitMs: Math.max(hinted ?? FALLBACK_RATE_WAIT_MS, 1000) };
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 408) {
        throw new WalkAbortedError(REFUSALS[res.status] ?? `Discord refused the request (HTTP ${res.status}).`);
      }
      if (!res.ok) return { failed: `Discord returned HTTP ${res.status}.` };
      let body;
      try {
        body = await res.json();
      } catch {
        if (cancelled) throw cancelledError();
        return { failed: "Discord returned a reply that is not JSON." };
      }
      return { body, res };
    } catch (err) {
      if (cancelled) throw cancelledError();
      if (err instanceof WalkAbortedError) throw err;
      return { failed: request.signal.aborted ? "A request to Discord timed out." : "The network request to Discord failed." };
    } finally {
      clearTimeout(timer);
      walk.signal.removeEventListener("abort", abort);
    }
  }

  async function call(url, reject) {
    let failures = 0;
    let rateLimits = 0;
    while (true) {
      if (cancelled) throw cancelledError();
      const result = await attempt(url);
      if (result.rateLimited) {
        rateLimits += 1;
        if (rateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
          throw new WalkAbortedError("Discord kept rate limiting this export. Wait a few minutes and retry.");
        }
        await sleepImpl(result.waitMs, walk.signal);
        continue;
      }
      const failure = result.failed ?? reject(result.body);
      if (failure) {
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) throw new WalkAbortedError(failure);
        await sleepImpl(BACKOFF_MS[failures - 1], walk.signal);
        continue;
      }
      if (cancelled) throw cancelledError();
      return result;
    }
  }

  /**
   * Waits before the next page: the bucket's announced reset when the last reply left no requests
   * in it (at most `MAX_BUCKET_WAIT_MS`), otherwise the ordinary delay.
   */
  async function pace(res) {
    const reset = seconds(header(res, "x-ratelimit-reset-after"));
    if (header(res, "x-ratelimit-remaining") === "0" && reset) {
      await sleepImpl(Math.min(Math.max(reset, DEFAULT_PAGE_DELAY_MS), MAX_BUCKET_WAIT_MS), walk.signal);
    } else {
      await delay(walk.signal);
    }
  }

  /**
   * Walks the channel backwards from `beforeId`, which Discord's `before` excludes, keeping the
   * messages in `[startId, beforeId)`. The walk stops on an empty page or once a page's oldest
   * message reaches `startId`, conditions inside the fetched data that stay the same however long
   * the export runs. Each page must move back in time, judged by its oldest ID found by comparison
   * rather than by its order. The result is sorted oldest first with any repeated ID kept once.
   * @param {{startId: bigint, beforeId: bigint, onPage?: Function}} range `onPage` receives the
   *   running message and page counts.
   * @returns {Promise<{messages: object[], pages: number}>}
   * @throws {WalkAbortedError} on a refusal, exhausted retries, the page ceiling or Cancel.
   * @throws {RangeError} when `beforeId` is not after `startId`.
   */
  async function run({ startId, beforeId, onPage } = {}) {
    if (typeof startId !== "bigint" || typeof beforeId !== "bigint") {
      throw new TypeError("startId and beforeId must be bigints");
    }
    if (beforeId <= startId) {
      throw new RangeError("end precedes start");
    }
    pages = 0;
    const bounds = { startId, beforeId };
    let cursor = beforeId;
    const collected = [];

    while (true) {
      if (cancelled) throw cancelledError();
      if (pages >= ceilingPages) {
        throw new WalkAbortedError(`This range needs more than ${ceilingPages} pages, the export ceiling. Export it in shorter ranges.`);
      }

      const { body: page, res } = await call(
        `${API_BASE}/channels/${channelId}/messages?before=${cursor}&limit=${PAGE_LIMIT}`,
        isPage,
      );
      if (page.length === 0) break;

      const oldest = page.reduce((min, m) => (BigInt(m.id) < min ? BigInt(m.id) : min), BigInt(page[0].id));
      if (oldest >= cursor) {
        throw new WalkAbortedError("Discord returned a page that does not move back in time.");
      }
      pages += 1;
      for (const m of page) {
        if (inRange(m.id, bounds)) collected.push(m);
      }
      if (onPage) onPage({ collected: collected.length, pages });

      if (oldest <= startId) break;
      cursor = oldest;
      await pace(res);
    }

    collected.sort((a, b) => {
      const x = BigInt(a.id);
      const y = BigInt(b.id);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    const messages = collected.filter((m, i) => i === 0 || m.id !== collected[i - 1].id);
    return { messages, pages };
  }

  async function getChannelMeta() {
    return (await call(`${API_BASE}/channels/${channelId}`, isObject)).body;
  }

  /** The guild name only labels the export, so a failed lookup gives an empty name, not a stop. */
  async function getGuildName(guildId) {
    try {
      const guild = (await call(`${API_BASE}/guilds/${guildId}`, isObject)).body;
      return typeof guild.name === "string" ? guild.name : "";
    } catch (err) {
      if (cancelled) throw err;
      return "";
    }
  }

  return {
    run,
    getChannelMeta,
    getGuildName,
    cancel: () => {
      cancelled = true;
      walk.abort();
    },
    get pages() {
      return pages;
    },
  };
}
