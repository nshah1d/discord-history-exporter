import test from "node:test";
import assert from "node:assert/strict";

import { renderJsonExport } from "../extension/src/formats/json.js";
import { renderCsvExport } from "../extension/src/formats/csv.js";
import { renderMarkdownExport } from "../extension/src/formats/md.js";
import { snowflakeToMs, formatLocal } from "../extension/src/time.js";

const ID_A = "900000000000000001";
const ID_B = "900000000000000002";

const world = [
  {
    id: ID_A,
    timestamp: "2026-08-25T09:03:11.123+00:00",
    author: { id: "111", username: "ada" },
    content: 'first line, with "quotes" and, commas',
    attachments: [{ url: "https://cdn.discordapp.com/a/1.png" }],
  },
  {
    id: ID_B,
    timestamp: "2026-08-25T09:07:42.000+00:00",
    author: { id: "222", username: "ben" },
    content: "reply body\nsecond line",
    attachments: [],
    message_reference: { message_id: ID_A },
  },
];

const localTimestamp = (m) => formatLocal(snowflakeToMs(m.id));

test("json envelope carries provenance and raw messages untouched", () => {
  const text = renderJsonExport({
    version: "1.0.0",
    exportedAtUtc: "2026-08-25T13:04:11.000Z",
    source: {
      guild: { id: "g1", name: "Test Server" },
      channel: { id: "c1", name: "general", type: "guild" },
    },
    range: { start_local: "2026-08-25 09:00:00", end_local: "2026-08-25 17:00:00", timezone: "Asia/Dubai" },
    messages: world,
  });
  const parsed = JSON.parse(text);
  assert.equal(parsed.tool, "ledger");
  assert.equal(parsed.version, "1.0.0");
  assert.equal(parsed.exported_at_utc, "2026-08-25T13:04:11.000Z");
  assert.equal(parsed.source.channel.type, "guild");
  assert.deepEqual(parsed.range, { start_local: "2026-08-25 09:00:00", end_local: "2026-08-25 17:00:00", timezone: "Asia/Dubai" });
  assert.equal(parsed.message_count, 2);
  assert.deepEqual(parsed.messages, world);
});

function splitCsvRows(text) {
  const body = text.replace(/^\uFEFF/, "");
  return body.split("\r\n").map((line) => {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  });
}

test("csv quotes embedded punctuation and round-trips through a strict reader", () => {
  const text = renderCsvExport({ messages: world, localTimestamp });
  assert.ok(text.startsWith("\uFEFF"));
  const rows = splitCsvRows(text);
  assert.ok(text.endsWith("\r\n"));
  assert.equal(rows.pop().length, 1);
  assert.equal(rows.at(-1).length, 9);
  for (const row of rows) {
    assert.equal(row.length, 9);
  }
  assert.deepEqual(rows[0], [
    "id",
    "timestamp_iso8601",
    "timestamp_local",
    "sender_id",
    "sender_username",
    "content",
    "attachments",
    "reply_to_id",
    "embeds",
  ]);
  assert.equal(rows[1][0], ID_A);
  assert.equal(rows[1][5], 'first line, with "quotes" and, commas');
  assert.equal(rows[1][6], "https://cdn.discordapp.com/a/1.png");
  assert.equal(rows[2][5], "reply body\nsecond line");
  assert.equal(rows[2][7], ID_A);
  assert.equal(rows[1][8], "");
});

test("markdown renders the header block, records, attachment and reply lines", () => {
  const text = renderMarkdownExport({
    guildName: "Test Server",
    channelName: "general",
    channelId: "c1",
    rangeStartLocal: "2026-08-25 09:00:00",
    rangeEndLocal: "2026-08-25 17:00:00",
    timezone: "Asia/Dubai",
    exportedAtUtc: "2026-08-25T13:04:11.000Z",
    messages: world,
    localTimestamp,
  });
  const lines = text.split("\n");
  assert.equal(lines[0], "# Discord export: #general");
  assert.ok(lines.includes("- Server: Test Server"));
  assert.ok(lines.includes("- Channel ID: c1"));
  assert.ok(lines.includes("- Range: 2026-08-25 09:00:00 to 2026-08-25 17:00:00 (machine local, Asia/Dubai)"));
  assert.ok(lines.includes("- Exported: 2026-08-25T13:04:11.000Z"));
  assert.ok(lines.includes("- Messages: 2"));
  assert.ok(text.includes(`[${localTimestamp(world[0])}] ada: first line, with "quotes" and, commas`));
  assert.ok(text.includes("    ↳ attachment: https://cdn.discordapp.com/a/1.png"));
  assert.ok(
    text.includes(
      `[${localTimestamp(world[1])}] ben: reply body\n    second line`,
    ),
  );
  assert.ok(text.includes(`    ↳ replying to message ${ID_A} by ada`));
});

const ID_C = "900000000000000003";
const ID_D = "900000000000000004";

const embedded = [
  {
    id: ID_C,
    author: { id: "333", username: "ben" },
    content: "",
    embeds: [
      {
        title: "✅ Done",
        description: "npm test\nnode tests/browser_gate.mjs",
        fields: [{ name: "Result", value: "45 passed" }, { name: "", value: "note only" }],
        color: 5763719,
      },
      { title: "Second", description: "" },
      { color: 1 },
    ],
  },
  {
    id: ID_D,
    author: { id: "444", username: "=cmd" },
    content: "=HYPERLINK(\"https://x\")",
    embeds: [{ description: "@everyone\nline two" }],
  },
];

test("markdown renders embed titles, descriptions and fields beneath the message", () => {
  const text = renderMarkdownExport({
    guildName: "Test Server",
    channelName: "builds",
    channelId: "c1",
    rangeStartLocal: "2026-08-25 09:00:00",
    rangeEndLocal: "2026-08-25 17:00:00",
    timezone: "Asia/Dubai",
    exportedAtUtc: "2026-08-25T13:04:11.000Z",
    messages: embedded,
    localTimestamp,
  });
  assert.ok(
    text.includes(
      `[${localTimestamp(embedded[0])}] ben: \n` +
        "    ↳ embed: ✅ Done\n" +
        "        npm test\n" +
        "        node tests/browser_gate.mjs\n" +
        "        Result: 45 passed\n" +
        "        note only\n" +
        "    ↳ embed: Second\n",
    ),
    text,
  );
  assert.ok(text.includes("    ↳ embed: untitled\n        @everyone\n        line two\n"), text);
  assert.equal((text.match(/↳ embed:/g) ?? []).length, 3, "an embed with no text is not rendered");
});

test("csv carries embed text in its final column", () => {
  const rows = splitCsvRows(renderCsvExport({ messages: embedded, localTimestamp }));
  assert.equal(rows[1][8], "✅ Done\nnpm test\nnode tests/browser_gate.mjs\nResult: 45 passed\nnote only\n\nSecond");
  assert.equal(rows[2][8], "'@everyone\nline two");
});

test("csv guards formula-shaped text but leaves identifiers as digits", () => {
  const rows = splitCsvRows(renderCsvExport({ messages: embedded, localTimestamp }));
  assert.equal(rows[2][0], ID_D);
  assert.equal(rows[2][3], "444");
  assert.equal(rows[2][4], "'=cmd");
  assert.equal(rows[2][5], "'=HYPERLINK(\"https://x\")");
  for (const value of ["+1", "-x", " =a", "\t@b"]) {
    const row = splitCsvRows(renderCsvExport({ messages: [{ id: ID_A, content: value }], localTimestamp }))[1];
    assert.equal(row[5], "'" + value, JSON.stringify(value));
  }
  const plain = splitCsvRows(renderCsvExport({ messages: [{ id: ID_A, content: "a=b" }], localTimestamp }))[1];
  assert.equal(plain[5], "a=b");
});
