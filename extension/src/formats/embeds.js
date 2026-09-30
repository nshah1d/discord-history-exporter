function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** An embed's title, description and fields as trimmed text, or null when it carries no text. */
export function embedParts(embed) {
  if (!embed || typeof embed !== "object") return null;
  const title = text(embed.title);
  const description = text(embed.description);
  const fields = (Array.isArray(embed.fields) ? embed.fields : [])
    .map((f) => ({ name: text(f?.name), value: text(f?.value) }))
    .filter((f) => f.name || f.value);
  if (!title && !description && fields.length === 0) return null;
  return { title, description, fields };
}

export function embedsOf(message) {
  return (Array.isArray(message.embeds) ? message.embeds : []).map(embedParts).filter(Boolean);
}

/** A field as `name: value`, or whichever of the two it has. */
export function fieldLine(field) {
  return field.name && field.value ? `${field.name}: ${field.value}` : field.name || field.value;
}

/** An embed as plain lines: title, description, then one line per field. */
export function embedText(parts) {
  const lines = [];
  if (parts.title) lines.push(parts.title);
  if (parts.description) lines.push(parts.description);
  for (const f of parts.fields) lines.push(fieldLine(f));
  return lines.join("\n");
}
