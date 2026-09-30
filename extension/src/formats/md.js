import { embedsOf, fieldLine } from "./embeds.js";

/** Continuation lines take `prefix`, so a multi-line message stays visibly one record. */
function indent(text, prefix) {
  return String(text).split("\n").join(`\n${prefix}`);
}

function indentContent(text) {
  return indent(text, "    ");
}

/**
 * A readable transcript: a header naming the server, channel, range, timezone, export time and
 * count, then one record per message with its attachments, embeds and reply beneath it. A reply
 * names the author of the message it answers when that message is in the same export.
 * @returns {string}
 */
export function renderMarkdownExport({
  guildName,
  channelName,
  channelId,
  rangeStartLocal,
  rangeEndLocal,
  timezone,
  exportedAtUtc,
  messages,
  localTimestamp,
}) {
  const out = [];
  out.push(`# Discord export: #${channelName}`);
  out.push("");
  out.push(`- Server: ${guildName}`);
  out.push(`- Channel ID: ${channelId}`);
  out.push(`- Range: ${rangeStartLocal} to ${rangeEndLocal} (machine local, ${timezone})`);
  out.push(`- Exported: ${exportedAtUtc}`);
  out.push(`- Messages: ${messages.length}`);
  out.push("");
  out.push("---");
  out.push("");

  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const m of messages) {
    out.push(
      `[${localTimestamp(m)}] ${m.author?.username ?? "unknown"}: ${indentContent(m.content ?? "")}`,
    );
    for (const a of m.attachments ?? []) {
      out.push(`    ↳ attachment: ${a.url}`);
    }
    for (const e of embedsOf(m)) {
      out.push(`    ↳ embed: ${indent(e.title || "untitled", "        ")}`);
      if (e.description) out.push(`        ${indent(e.description, "        ")}`);
      for (const f of e.fields) {
        out.push(`        ${indent(fieldLine(f), "        ")}`);
      }
    }
    const ref = m.message_reference?.message_id;
    if (ref && byId.has(ref)) {
      out.push(`    ↳ replying to message ${ref} by ${byId.get(ref)?.author?.username ?? "unknown"}`);
    } else if (ref) {
      out.push(`    ↳ replying to message ${ref}`);
    }
  }
  return out.join("\n") + "\n";
}
