import test from "node:test";
import assert from "node:assert/strict";

import { createExporter, WalkAbortedError, abortableSleep, BACKOFF_MS } from "../extension/src/api.js";
import { msToSnowflake } from "../extension/src/time.js";

function msg(id, content = `c${id}`) {
  return { id: String(id), content };
}

const T0 = 1690000000000;

function ids(startOffsetMinutes, count) {
  return Array.from({ length: count }, (_, i) =>
    msToSnowflake(T0 + startOffsetMinutes * 60_000 + i * 1000),
  );
}

function headers(map = {}) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { get: (name) => lower[name.toLowerCase()] ?? null };
}

function fakeFetch(steps) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(url);
    const next = steps.shift();
    if (typeof next === "number") {
      return { status: next, ok: next >= 200 && next < 300, headers: headers(), json: async () => ({}) };
    }
    if (next && next.rateLimited) {
      return {
        status: 429,
        ok: false,
        headers: headers(next.headers),
        json: async () => (next.body === undefined ? { retry_after: next.retryAfter } : next.body),
      };
    }
    if (next && next.notJson) {
      return { status: 200, ok: true, headers: headers(), json: async () => { throw new SyntaxError("bad json"); } };
    }
    if (next && next.networkError) {
      throw new TypeError("Failed to fetch");
    }
    if (next && next.hang) {
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    if (next && next.page) {
      return { status: 200, ok: true, headers: headers(next.headers), json: async () => next.page };
    }
    const body = next ?? [];
    return { status: 200, ok: true, headers: headers(), json: async () => body };
  };
  return { impl, calls };
}

function recordingSleep() {
  const log = [];
  const fn = (ms) => {
    log.push(ms);
    return Promise.resolve();
  };
  fn.log = log;
  return fn;
}

const noDelay = () => Promise.resolve();

function exporterFor(fetch, extra = {}) {
  return createExporter({
    channelId: "123",
    token: "t",
    fetchImpl: fetch.impl,
    delay: noDelay,
    sleepImpl: recordingSleep(),
    ...extra,
  });
}

const cursorOf = (url) => url.match(/before=(\d+)/)[1];

test("walks pages descending and returns messages ascending inside half-open bounds", async () => {
  const all = ids(-3, 250).map((id) => msg(id));
  const newer = all.slice(100).reverse();
  const older = all.slice(0, 100).reverse();
  const startId = msToSnowflake(T0 - 180_000);
  const beforeId = msToSnowflake(T0 + 70_000);

  const fetch = fakeFetch([newer, older]);
  const exporter = exporterFor(fetch);
  const progress = [];
  const { messages, pages } = await exporter.run({ startId, beforeId, onPage: (p) => progress.push(p) });

  assert.equal(pages, 2);
  const expected = all.filter((m) => {
    const v = BigInt(m.id);
    return v >= startId && v < beforeId;
  });
  assert.deepEqual(messages.map((m) => m.id), expected.map((m) => m.id));
  assert.equal(progress.at(-1).collected, expected.length);
  assert.equal(cursorOf(fetch.calls[0]), String(beforeId), "first request starts at the exclusive bound");
});

test("an unsorted page is walked from its true oldest message", async () => {
  const a = msToSnowflake(T0 + 1_000);
  const b = msToSnowflake(T0 + 2_000);
  const c = msToSnowflake(T0 + 3_000);
  const fetch = fakeFetch([[msg(b), msg(a), msg(c)], []]);
  const exporter = exporterFor(fetch);
  const { messages } = await exporter.run({ startId: msToSnowflake(T0), beforeId: msToSnowflake(T0 + 10_000) });
  assert.deepEqual(messages.map((m) => m.id), [String(a), String(b), String(c)]);
  assert.equal(cursorOf(fetch.calls[1]), String(a));
});

test("a message repeated inside a page is kept once", async () => {
  const a = msToSnowflake(T0 + 1_000);
  const b = msToSnowflake(T0 + 2_000);
  const fetch = fakeFetch([[msg(b), msg(b), msg(a)], []]);
  const { messages } = await exporterFor(fetch).run({ startId: msToSnowflake(T0), beforeId: msToSnowflake(T0 + 10_000) });
  assert.deepEqual(messages.map((m) => m.id), [String(a), String(b)]);
});

test("a page that does not move back in time stops the export", async () => {
  const beforeId = msToSnowflake(T0 + 10_000);
  const fetch = fakeFetch([[msg(beforeId + 5n)]]);
  await assert.rejects(
    exporterFor(fetch).run({ startId: msToSnowflake(T0), beforeId }),
    (err) => err instanceof WalkAbortedError && /does not move back in time/.test(err.reason),
  );
  assert.equal(fetch.calls.length, 1);
});

test("stops at an empty page", async () => {
  const only = [msg(msToSnowflake(T0))];
  const fetch = fakeFetch([only, []]);
  const { messages, pages } = await exporterFor(fetch).run({ startId: 1n, beforeId: msToSnowflake(T0 + 1) });
  assert.equal(pages, 1);
  assert.deepEqual(messages.map((m) => m.id), [String(msToSnowflake(T0))]);
});

test("stops once the page oldest falls below the range floor", async () => {
  const inWindow = [msg(msToSnowflake(T0 + 1_000))];
  const belowFloor = [msg(msToSnowflake(T0 - 500_000)), msg(msToSnowflake(T0 - 600_000))];
  const fetch = fakeFetch([inWindow, belowFloor]);
  const { messages } = await exporterFor(fetch).run({ startId: msToSnowflake(T0), beforeId: msToSnowflake(T0 + 5_000) });
  assert.deepEqual(messages.map((m) => m.id), [String(msToSnowflake(T0 + 1_000))]);
  assert.equal(fetch.calls.length, 2, "no request once a page fell entirely below the floor");
});

test("a successful reply that is not a page is retried, never taken as the end of history", async () => {
  const page = [msg(msToSnowflake(T0))];
  const fetch = fakeFetch([{ page: { message: "not a list" } }, page, []]);
  const sleep = recordingSleep();
  const { messages } = await exporterFor(fetch, { sleepImpl: sleep }).run({ startId: 1n, beforeId: msToSnowflake(T0 + 1) });
  assert.equal(messages.length, 1);
  assert.deepEqual(sleep.log, [BACKOFF_MS[0]]);
  assert.equal(cursorOf(fetch.calls[0]), cursorOf(fetch.calls[1]), "same cursor retried");
});

test("five replies that are not pages stop the export instead of saving a partial file", async () => {
  const fetch = fakeFetch([{ page: {} }, { page: {} }, { page: {} }, { page: {} }, { page: {} }]);
  await assert.rejects(
    exporterFor(fetch).run({ startId: 1n, beforeId: msToSnowflake(T0) }),
    (err) => err instanceof WalkAbortedError && /other than a page/.test(err.reason),
  );
});

test("a page carrying a message without an ID is a failed page", async () => {
  const good = [msg(msToSnowflake(T0))];
  const fetch = fakeFetch([{ page: [{ content: "no id" }] }, good, []]);
  const { messages } = await exporterFor(fetch).run({ startId: 1n, beforeId: msToSnowflake(T0 + 1) });
  assert.equal(messages.length, 1);
  assert.equal(fetch.calls.length, 3);
});

test("a refusal stops at once after exactly one request and names the reason", async () => {
  for (const [status, pattern] of [[401, /rejected this session/], [403, /cannot read this channel/], [404, /cannot find this channel/], [400, /HTTP 400/]]) {
    const fetch = fakeFetch([status]);
    await assert.rejects(
      exporterFor(fetch).run({ startId: 1n, beforeId: msToSnowflake(T0) }),
      (err) => err instanceof WalkAbortedError && pattern.test(err.reason),
    );
    assert.equal(fetch.calls.length, 1, `HTTP ${status} was not retried`);
  }
});

test("transient failures back off at one, two, four and eight seconds and the fifth stops the export", async () => {
  const fetch = fakeFetch([500, 502, { networkError: true }, { notJson: true }, 503]);
  const sleep = recordingSleep();
  await assert.rejects(
    exporterFor(fetch, { sleepImpl: sleep }).run({ startId: 1n, beforeId: msToSnowflake(T0) }),
    (err) => err instanceof WalkAbortedError && err.reason === "Discord returned HTTP 503.",
  );
  assert.deepEqual(sleep.log, [1000, 2000, 4000, 8000]);
  assert.equal(fetch.calls.length, 5);
});

test("a failure streak that recovers does not abort and its count resets", async () => {
  const first = [msg(msToSnowflake(T0 + 2_000))];
  const second = [msg(msToSnowflake(T0 + 1_000))];
  const fetch = fakeFetch([502, 408, 500, 500, first, 500, 500, 500, 500, second, []]);
  const { messages } = await exporterFor(fetch).run({ startId: msToSnowflake(T0), beforeId: msToSnowflake(T0 + 5_000) });
  assert.equal(messages.length, 2);
});

test("a rate limited page retries the same cursor and honours retry_after", async () => {
  const page = [msg(msToSnowflake(T0))];
  const fetch = fakeFetch([{ rateLimited: true, retryAfter: 2.5 }, page, []]);
  const sleep = recordingSleep();
  const { messages } = await exporterFor(fetch, { sleepImpl: sleep }).run({ startId: msToSnowflake(T0), beforeId: msToSnowflake(T0 + 1) });
  assert.deepEqual(messages.map((m) => m.id), [String(msToSnowflake(T0))]);
  assert.deepEqual(sleep.log, [2500]);
  assert.equal(cursorOf(fetch.calls[0]), cursorOf(fetch.calls[1]), "same cursor retried");
});

test("a rate limit with the wait only in the Retry-After header is honoured", async () => {
  const fetch = fakeFetch([{ rateLimited: true, body: {}, headers: { "Retry-After": "3" } }, []]);
  const sleep = recordingSleep();
  await exporterFor(fetch, { sleepImpl: sleep }).run({ startId: 1n, beforeId: msToSnowflake(T0) });
  assert.deepEqual(sleep.log, [3000]);
});

test("a rate limit without a usable wait falls back to five seconds rather than zero", async () => {
  const fetch = fakeFetch([{ rateLimited: true, body: { retry_after: "soon" } }, { rateLimited: true, body: {} }, []]);
  const sleep = recordingSleep();
  await exporterFor(fetch, { sleepImpl: sleep }).run({ startId: 1n, beforeId: msToSnowflake(T0) });
  assert.deepEqual(sleep.log, [5000, 5000]);
});

test("a very short rate limit still waits one second", async () => {
  const fetch = fakeFetch([{ rateLimited: true, retryAfter: 0.05 }, []]);
  const sleep = recordingSleep();
  await exporterFor(fetch, { sleepImpl: sleep }).run({ startId: 1n, beforeId: msToSnowflake(T0) });
  assert.deepEqual(sleep.log, [1000]);
});

test("ten rate limits in a row stop the export", async () => {
  const fetch = fakeFetch(Array.from({ length: 12 }, () => ({ rateLimited: true, retryAfter: 1 })));
  await assert.rejects(
    exporterFor(fetch).run({ startId: 1n, beforeId: msToSnowflake(T0) }),
    (err) => err instanceof WalkAbortedError && /kept rate limiting/.test(err.reason),
  );
  assert.equal(fetch.calls.length, 10);
});

test("an exhausted bucket waits its announced reset before the next page", async () => {
  const first = { page: [msg(msToSnowflake(T0 + 2_000))], headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "1.5" } };
  const second = [msg(msToSnowflake(T0 + 1_000))];
  const fetch = fakeFetch([first, second, []]);
  const sleep = recordingSleep();
  const delays = [];
  await exporterFor(fetch, { sleepImpl: sleep, delay: () => { delays.push("base"); return Promise.resolve(); } }).run({
    startId: msToSnowflake(T0),
    beforeId: msToSnowflake(T0 + 5_000),
  });
  assert.deepEqual(sleep.log, [1500]);
  assert.deepEqual(delays, ["base"], "the base pace applies when the bucket has room");
});

test("an exhausted bucket never waits longer than one minute", async () => {
  const first = { page: [msg(msToSnowflake(T0 + 2_000))], headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "600" } };
  const fetch = fakeFetch([first, [msg(msToSnowflake(T0 + 1_000))], []]);
  const sleep = recordingSleep();
  await exporterFor(fetch, { sleepImpl: sleep }).run({ startId: msToSnowflake(T0), beforeId: msToSnowflake(T0 + 5_000) });
  assert.deepEqual(sleep.log, [60000]);
});

test("cancellation stops the walk between pages", async () => {
  const first = ids(-2, 100).reverse().map((id) => msg(id));
  const second = ids(-4, 100).reverse().map((id) => msg(id));
  const fetch = fakeFetch([first, second]);
  const exporter = exporterFor(fetch);
  let seen = false;
  await assert.rejects(
    exporter.run({
      startId: msToSnowflake(T0 - 400_000),
      beforeId: msToSnowflake(T0),
      onPage: () => {
        if (!seen) {
          seen = true;
          exporter.cancel();
        }
      },
    }),
    (err) => err instanceof WalkAbortedError && err.reason === "cancelled",
  );
  assert.equal(fetch.calls.length, 1);
});

test("cancellation aborts a request that is still in flight", async () => {
  const fetch = fakeFetch([{ hang: true }]);
  const exporter = exporterFor(fetch, { timeoutMs: 60_000 });
  const running = exporter.run({ startId: 1n, beforeId: msToSnowflake(T0) });
  setTimeout(() => exporter.cancel(), 20);
  const started = Date.now();
  await assert.rejects(running, (err) => err instanceof WalkAbortedError && err.reason === "cancelled");
  assert.ok(Date.now() - started < 1000, "cancel did not wait for the request");
});

test("cancellation interrupts a rate-limit wait", async () => {
  const fetch = fakeFetch([{ rateLimited: true, retryAfter: 60 }]);
  const exporter = exporterFor(fetch, { sleepImpl: abortableSleep });
  const running = exporter.run({ startId: 1n, beforeId: msToSnowflake(T0) });
  setTimeout(() => exporter.cancel(), 20);
  const started = Date.now();
  await assert.rejects(running, (err) => err instanceof WalkAbortedError && err.reason === "cancelled");
  assert.ok(Date.now() - started < 1000, "cancel did not wait out the rate limit");
});

test("a request that hangs times out and is retried", async () => {
  const page = [msg(msToSnowflake(T0))];
  const fetch = fakeFetch([{ hang: true }, page, []]);
  const sleep = recordingSleep();
  const { messages } = await exporterFor(fetch, { sleepImpl: sleep, timeoutMs: 30 }).run({ startId: 1n, beforeId: msToSnowflake(T0 + 1) });
  assert.equal(messages.length, 1);
  assert.deepEqual(sleep.log, [1000]);
});

test("the page ceiling aborts instead of walking forever", async () => {
  let n = 0;
  const impl = async () => {
    n += 1;
    return { status: 200, ok: true, json: async () => [msg(msToSnowflake(T0 + 60_000 - n * 1000))] };
  };
  const exporter = createExporter({ channelId: "123", token: "t", fetchImpl: impl, delay: noDelay, sleepImpl: recordingSleep(), ceilingPages: 3 });
  await assert.rejects(
    exporter.run({ startId: 1n, beforeId: msToSnowflake(T0 + 60_000) }),
    (err) => err instanceof WalkAbortedError && err.reason === "This range needs more than 3 pages, the export ceiling. Export it in shorter ranges.",
  );
  assert.equal(n, 3);
});

test("channel metadata reads through the same token header", async () => {
  const seen = [];
  const impl = async (url, init) => {
    seen.push([url, init.headers.authorization]);
    if (url.endsWith("/channels/42")) {
      return { status: 200, ok: true, json: async () => ({ id: "42", name: "general" }) };
    }
    throw new Error("unexpected url " + url);
  };
  const exporter = createExporter({ channelId: "42", token: "t", fetchImpl: impl, delay: noDelay });
  const meta = await exporter.getChannelMeta();
  assert.equal(meta.name, "general");
  assert.deepEqual(seen, [["https://discord.com/api/v9/channels/42", "t"]]);
});

test("a refused channel lookup names the reason after one request", async () => {
  const fetch = fakeFetch([403]);
  const exporter = createExporter({ channelId: "42", token: "t", fetchImpl: fetch.impl, delay: noDelay, sleepImpl: recordingSleep() });
  await assert.rejects(exporter.getChannelMeta(), (err) => err instanceof WalkAbortedError && err.reason === "This account cannot read this channel.");
  assert.equal(fetch.calls.length, 1);
});

test("an unreadable guild name falls back to an empty name without stopping the export", async () => {
  const fetch = fakeFetch([403]);
  const exporter = createExporter({ channelId: "42", token: "t", fetchImpl: fetch.impl, delay: noDelay, sleepImpl: recordingSleep() });
  assert.equal(await exporter.getGuildName("789"), "");
});

test("an inverted or empty range is refused before any request", async () => {
  const fetch = fakeFetch([]);
  const exporter = exporterFor(fetch);
  await assert.rejects(exporter.run({ startId: 10n, beforeId: 10n }), RangeError);
  await assert.rejects(exporter.run({ startId: 10n, beforeId: 5n }), RangeError);
  assert.equal(fetch.calls.length, 0);
});
