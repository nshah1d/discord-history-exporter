/**
 * The first millisecond of 2015 in UTC. A snowflake's top 42 bits count milliseconds from it and
 * its low 22 bits hold the worker, process and increment:
 * https://discord.com/developers/docs/reference#snowflakes
 */
export const DISCORD_EPOCH_MS = 1420070400000n;

/** The lowest snowflake Discord can issue at the given millisecond, with the low 22 bits zero. */
export function msToSnowflake(ms) {
  const n = typeof ms === "bigint" ? ms : BigInt(Math.trunc(Number(ms)));
  return (n - DISCORD_EPOCH_MS) << 22n;
}

export function snowflakeToMs(id) {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS);
}

/**
 * Reads a datetime-local value as wall-clock time on this machine. A date-time string without an
 * offset is local time under the ECMAScript date format, so the machine's own timezone rules,
 * daylight saving included, decide the instant: https://tc39.es/ecma262/#sec-date.parse
 * @throws {TypeError} when the value is not a date.
 */
export function parseLocalInput(value) {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    throw new TypeError(`unrecognised datetime: ${value}`);
  }
  return ms;
}

/**
 * Converts From and To into half-open snowflake bounds that cover both chosen seconds in full:
 * `startId` is the lowest ID at the From instant and `beforeId` the lowest ID at the start of the
 * second after To. A bound at the To instant itself would drop the rest of that second. `beforeId` feeds Discord's exclusive `before` cursor directly,
 * and a range ending at one second tiles with a range starting at the next.
 * @param {string} startInput From, as a datetime-local value.
 * @param {string} endInput To, as a datetime-local value.
 * @returns {{startId: bigint, beforeId: bigint, startMs: number, endMs: number, endExclusiveMs: number}}
 * @throws {TypeError} when either value is not a date.
 * @throws {RangeError} when To is earlier than From.
 */
export function rangeBounds(startInput, endInput) {
  const start = parseLocalInput(startInput);
  const end = parseLocalInput(endInput);
  if (end < start) {
    throw new RangeError("end precedes start");
  }
  const endMs = Math.floor(end / 1000) * 1000;
  const endExclusiveMs = endMs + 1000;
  return {
    startId: msToSnowflake(start),
    beforeId: msToSnowflake(endExclusiveMs),
    startMs: start,
    endMs,
    endExclusiveMs,
  };
}

/** True when the ID lies in `[startId, beforeId)`. */
export function inRange(id, bounds) {
  const n = BigInt(id);
  return n >= bounds.startId && n < bounds.beforeId;
}

/** The machine's IANA timezone name, recorded in exports so their local times stay unambiguous. */
export function machineZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** Machine-local `YYYY-MM-DD HH:MM:SS`, the timestamp form inside every export. */
export function formatLocal(ms) {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Machine-local `YYYYMMDD-HHMM`, the stamp form in export filenames. */
export function formatStamp(ms) {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}
