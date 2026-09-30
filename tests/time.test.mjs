import test from "node:test";
import assert from "node:assert/strict";

import {
  DISCORD_EPOCH_MS,
  msToSnowflake,
  snowflakeToMs,
  parseLocalInput,
  rangeBounds,
  inRange,
  formatLocal,
  formatStamp,
  machineZone,
} from "../extension/src/time.js";

test("discord epoch maps one millisecond past epoch to the first snowflake", () => {
  assert.equal(msToSnowflake(DISCORD_EPOCH_MS + 1n), (1n << 22n));
});

test("snowflake round trip truncates sub-millisecond precision", () => {
  const id = msToSnowflake(1690000000123);
  assert.equal(snowflakeToMs(id), 1690000000123);
});

test("the range includes the whole selected To second and nothing after it", () => {
  const bounds = rangeBounds("2026-08-25T09:00", "2026-08-25T17:00");
  const toSecond = new Date("2026-08-25T17:00").getTime();
  const lastMillisecond = msToSnowflake(toSecond + 999) | ((1n << 22n) - 1n);
  const lowBitsAtStart = msToSnowflake(toSecond) | 12345n;
  assert.equal(inRange(lowBitsAtStart, bounds), true);
  assert.equal(inRange(lastMillisecond, bounds), true);
  assert.equal(inRange(msToSnowflake(toSecond + 1000), bounds), false);
  assert.equal(bounds.beforeId, msToSnowflake(toSecond + 1000));
  assert.equal(bounds.endMs, toSecond);
  assert.equal(bounds.endExclusiveMs, toSecond + 1000);
});

test("the From instant is included and the ID before it is excluded", () => {
  const bounds = rangeBounds("2026-08-25T09:00:30", "2026-08-25T10:00");
  assert.equal(inRange(bounds.startId, bounds), true);
  assert.equal(inRange(bounds.startId - 1n, bounds), false);
});

test("From and To on the same second give a one-second range", () => {
  const bounds = rangeBounds("2026-08-25T09:00:05", "2026-08-25T09:00:05");
  const second = new Date("2026-08-25T09:00:05").getTime();
  assert.equal(bounds.beforeId - bounds.startId, 1000n << 22n);
  assert.equal(inRange(msToSnowflake(second + 500), bounds), true);
  assert.equal(inRange(msToSnowflake(second + 1000), bounds), false);
});

test("consecutive ranges tile without a gap or an overlap", () => {
  const first = rangeBounds("2026-08-25T09:00", "2026-08-25T16:59:59");
  const second = rangeBounds("2026-08-25T17:00", "2026-08-25T18:00");
  assert.equal(first.beforeId, second.startId);
});

test("the machine timezone is named", () => {
  assert.equal(machineZone(), Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test("an inverted range is refused", () => {
  assert.throws(() => rangeBounds("2026-08-25T17:00", "2026-08-25T09:00"), RangeError);
});

test("unparseable datetime input is refused", () => {
  assert.throws(() => parseLocalInput("not-a-date"), TypeError);
  assert.throws(() => parseLocalInput(""), TypeError);
});

test("local input parses by the machine zone rule", () => {
  assert.equal(parseLocalInput("2026-08-25T09:00"), new Date("2026-08-25T09:00").getTime());
});

test("formatLocal renders a fixed local stamp shape", () => {
  const d = new Date(2026, 7, 25, 9, 5, 7);
  assert.equal(formatLocal(d.getTime()), "2026-08-25 09:05:07");
});

test("formatStamp renders the filename stamp shape", () => {
  const d = new Date(2026, 7, 25, 9, 5, 7);
  assert.equal(formatStamp(d.getTime()), "20260825-0905");
});
