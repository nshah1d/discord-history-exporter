import { embedsOf, embedText } from "./embeds.js";

const HEADERS = [
  "id",
  "timestamp_iso8601",
  "timestamp_local",
  "sender_id",
  "sender_username",
  "content",
  "attachments",
  "reply_to_id",
  "embeds",
];

/**
 * One RFC 4180 field: quoted when it holds a quote, comma or line break, with quotes doubled
 * (https://www.rfc-editor.org/rfc/rfc4180#section-2). Text that begins, after any whitespace or
 * control characters, with `=`, `+`, `-` or `@` is prefixed with an apostrophe so a spreadsheet
 * shows it instead of running it as a formula:
 * https://owasp.org/www-community/attacks/CSV_Injection
 */
function cell(value) {
  let s = value == null ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One row per message under a fixed header. Attachment URLs are joined with `;`, and each embed's
 * text is joined with a blank line between embeds. Rows end in CRLF as RFC 4180 sets, and the
 * UTF-8 byte order mark at the start makes spreadsheet applications read the file as UTF-8.
 * @param {{messages: object[], localTimestamp: Function}} input
 * @returns {string}
 */
export function renderCsvExport({ messages, localTimestamp }) {
  const lines = [HEADERS.join(",")];
  for (const m of messages) {
    const row = [
      m.id,
      m.timestamp ?? "",
      localTimestamp(m),
      m.author?.id ?? "",
      m.author?.username ?? "",
      m.content ?? "",
      (m.attachments ?? []).map((a) => a.url).join(";"),
      m.message_reference?.message_id ?? "",
      embedsOf(m).map(embedText).join("\n\n"),
    ];
    lines.push(row.map(cell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
