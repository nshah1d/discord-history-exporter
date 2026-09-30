import test from "node:test";
import assert from "node:assert/strict";

import { parseChannel } from "../extension/src/channel.js";

test("a server channel resolves its guild and channel", () => {
  assert.deepEqual(parseChannel("/channels/789/456"), { guildId: "789", channelId: "456", isDm: false });
});

test("a message link resolves to its channel, not the message", () => {
  assert.deepEqual(parseChannel("/channels/789/456/999"), { guildId: "789", channelId: "456", isDm: false });
});

test("a direct message and a direct message link resolve as DMs", () => {
  assert.deepEqual(parseChannel("/channels/@me/321"), { guildId: "@me", channelId: "321", isDm: true });
  assert.deepEqual(parseChannel("/channels/@me/321/654"), { guildId: "@me", channelId: "321", isDm: true });
});

test("a thread or forum post resolves as its own channel", () => {
  assert.deepEqual(parseChannel("/channels/789/1200000000000000001/"), {
    guildId: "789",
    channelId: "1200000000000000001",
    isDm: false,
  });
});

test("pages that are not a channel resolve to nothing", () => {
  for (const path of ["/", "/channels/@me", "/channels/789", "/app", "/store", "/channels/789/abc", "/channels/x/456", "/channels/789/456/abc", "/channels/789/456/999/1", "/guild-discovery"]) {
    assert.equal(parseChannel(path), null, path);
  }
});
