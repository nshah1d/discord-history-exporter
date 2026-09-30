/**
 * The export envelope around Discord's own message objects, unchanged, so every
 * field the API returned stays available to whatever reads the file later.
 * @param {{version: string, exportedAtUtc: string, source: object, range: object, messages: object[]}} input
 * @returns {string}
 */
export function renderJsonExport({ version, exportedAtUtc, source, range, messages }) {
  const envelope = {
    tool: "ledger",
    version,
    exported_at_utc: exportedAtUtc,
    source,
    range,
    message_count: messages.length,
    messages,
  };
  return JSON.stringify(envelope, null, 2);
}
