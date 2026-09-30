/** A snowflake is an unsigned 64-bit integer: at most 20 decimal digits. */
const SNOWFLAKE = /^\d{1,20}$/;

/**
 * Reads the channel from a Discord address by position: `/channels/{guild or @me}/{channel}`,
 * optionally followed by a message ID. A message link therefore exports its channel, and threads,
 * forum posts and group DMs resolve because each is a channel ID in that position.
 * @param {string} pathname
 * @returns {{guildId: string, channelId: string, isDm: boolean} | null} null for any other path.
 */
export function parseChannel(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  if (parts[0] !== "channels" || parts.length < 3 || parts.length > 4) return null;
  const [, guildId, channelId] = parts;
  if (guildId !== "@me" && !SNOWFLAKE.test(guildId)) return null;
  if (!SNOWFLAKE.test(channelId)) return null;
  if (parts.length === 4 && !SNOWFLAKE.test(parts[3])) return null;
  return { guildId, channelId, isDm: guildId === "@me" };
}
