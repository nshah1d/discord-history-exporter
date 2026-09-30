// Loads the unpacked extension into headless Chromium and answers every discord.com request from a
// routed fake, so nothing touches live Discord. LEDGER_BROWSER_TOOLS names a directory whose
// node_modules holds Playwright when it is not installed beside the repository, and LEDGER_CHROMIUM
// a Chromium executable when Playwright's own is not installed.
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  process.env.LEDGER_BROWSER_TOOLS
    ? join(process.env.LEDGER_BROWSER_TOOLS, "package.json")
    : import.meta.url,
);
const { chromium } = require("playwright");

const EXTENSION = fileURLToPath(new URL("../extension", import.meta.url));
const ZONE = "Asia/Dubai";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
}

const snowflakeFor = (isoUtc) =>
  ((BigInt(Date.parse(isoUtc)) - 1420070400000n) << 22n).toString();

const ID_OLD = snowflakeFor("2026-08-23T07:00:00.000Z");
const ID_A = snowflakeFor("2026-08-23T13:00:00.000Z");
const ID_B = snowflakeFor("2026-08-23T14:00:00.000Z");
const ID_C = snowflakeFor("2026-08-24T15:00:00.000Z");
const ID_EDGE = (BigInt(snowflakeFor("2026-08-24T16:00:00.500Z")) | 4095n).toString();
const ID_AFTER = snowflakeFor("2026-08-24T16:00:01.000Z");

const HISTORY = [
  { id: ID_AFTER, timestamp: "2026-08-24T16:00:01.000+00:00", author: { id: "3", username: "cleo" }, content: "one second after the range" },
  { id: ID_EDGE, timestamp: "2026-08-24T16:00:00.500+00:00", author: { id: "3", username: "cleo" }, content: "inside the final second" },
  { id: ID_C, timestamp: "2026-08-24T15:00:00.000+00:00", author: { id: "3", username: "cleo" }, content: "newest message" },
  {
    id: ID_B,
    timestamp: "2026-08-23T14:00:00.000+00:00",
    author: { id: "2", username: "ben", bot: true },
    content: "middle\nmultiline",
    embeds: [{ title: "Done", description: "npm test\nnode tests/browser_gate.mjs", fields: [{ name: "Result", value: "all passed" }] }],
  },
  {
    id: ID_A,
    timestamp: "2026-08-23T13:00:00.000+00:00",
    author: { id: "1", username: "ada" },
    content: 'oldest, with "quotes" and, commas',
    attachments: [{ url: "https://cdn.discordapp.com/x/1.png" }],
  },
  { id: ID_OLD, timestamp: "2026-08-23T07:00:00.000+00:00", author: { id: "1", username: "ada" }, content: "before the range" },
];
const MESSAGES_PAGE_1 = HISTORY.slice(2, 3);
const requests = [];

const STUB_HTML = `<!DOCTYPE html><html><head><title>discord stub</title></head>
<body><div id="app">stub</div><textarea id="fake-chat"></textarea>
<script>
localStorage.setItem('token', JSON.stringify('test-token-abc'));
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const editable = t && ((t.tagName === 'INPUT') || (t.tagName === 'TEXTAREA') || t.isContentEditable);
  if (!editable) {
    e.preventDefault();
    const box = document.getElementById('fake-chat');
    if (box) {
      box.focus();
      box.value += e.key && e.key.length === 1 ? e.key : '';
    }
  }
});
</script>
</body></html>`;

function jsonRes(body) {
  return {
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  };
}

async function routeDiscord(route) {
  const u = route.request().url();
  requests.push(u);
  if (u.includes("/api/v9/channels/456/messages")) {
    const match = u.match(/before=(\d+)/);
    const cursor = match ? BigInt(match[1]) : 1n << 64n;
    return route.fulfill(jsonRes(HISTORY.filter((m) => BigInt(m.id) < cursor).slice(0, 100)));
  }
  if (u.endsWith("/api/v9/channels/456")) {
    return route.fulfill(jsonRes({ id: "456", name: "general", type: 0, guild_id: "789" }));
  }
  if (u.includes("/api/v9/channels/457")) {
    return route.fulfill({ status: 403, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ message: "Missing Access", code: 50001 }) });
  }
  if (u.endsWith("/api/v9/guilds/789")) {
    return route.fulfill(jsonRes({ id: "789", name: "Test Server" }));
  }
  return route.fulfill({
    status: 200,
    contentType: "text/html",
    body: STUB_HTML,
  });
}

async function shadowQuery(page, selector) {
  return page.evaluateHandle(
    ([hostSel, sel]) => document.querySelector(hostSel)?.shadowRoot?.querySelector(sel),
    ["#ledger-host", selector],
  );
}

async function setShadowValue(page, selector, value) {
  await page.evaluate(
    ([sel, v]) => {
      const el = document.querySelector("#ledger-host")?.shadowRoot?.querySelector(sel);
      if (!el) throw new Error("missing " + sel);
      el.value = v;
    },
    [selector, value],
  );
}

async function shadowText(page) {
  return page.evaluate(() => {
    const el = document.querySelector("#ledger-host")?.shadowRoot?.querySelector(".status");
    return el ? el.textContent : null;
  });
}

async function getShadowValue(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector("#ledger-host")?.shadowRoot?.querySelector(sel);
    return el ? el.value : null;
  }, selector);
}

async function clickShadow(page, selector) {
  try {
    const h = await shadowQuery(page, selector);
    await h.asElement().click();
    return true;
  } catch (e) {
    check(`actionable click landed: ${selector}`, false, String(e).split("\n")[0]);
    return false;
  }
}

async function runFormat(context, format, route = "/channels/789/456") {
  const page = await context.newPage();
  await page.goto(`https://discord.com${route}?ledger=1`);
  await page.waitForSelector("#ledger-host", { timeout: 10000, state: "attached" });

  await setShadowValue(page, ".from", "2026-08-23T12:00");
  await setShadowValue(page, ".to", "2026-08-24T20:00");

  const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
  (await shadowQuery(page, "select.format")).asElement().evaluate((el, v) => {
    el.value = v;
  }, format);
  await clickShadow(page, "button.go");

  const download = await downloadPromise;
  const suggested = download.suggestedFilename();
  const path = await download.path();
  const bytes = readFileSync(path, "utf8");
  await page.close();
  return { suggested, bytes };
}

async function main() {
  const userData = mkdtempSync(join(tmpdir(), "ledger_gate_"));
  const context = await chromium.launchPersistentContext(userData, {
    ...(process.env.LEDGER_CHROMIUM ? { executablePath: process.env.LEDGER_CHROMIUM } : { channel: "chromium" }),
    headless: true,
    timezoneId: ZONE,
    acceptDownloads: true,
    args: [
      "--disable-extensions-except=" + EXTENSION,
      "--load-extension=" + EXTENSION,
      "--no-sandbox",
    ],
  });
  context.route(/https?:\/\/discord\.com\//, routeDiscord);

  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 10000 }));
    check("the extension's service worker is running", worker.url().endsWith("/src/background.js"), worker.url());

    const toggled = await context.newPage();
    await toggled.goto("https://discord.com/channels/789/456");
    await toggled.waitForTimeout(800);
    const mountedBefore = await toggled.evaluate(() => Boolean(document.querySelector("#ledger-host")));
    const toggle = () =>
      worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ url: "https://discord.com/channels/789/456" });
        await chrome.tabs.sendMessage(tabs[0].id, { type: "ledger-toggle" });
      });
    await toggle();
    await toggled.waitForSelector("#ledger-host", { timeout: 5000, state: "attached" });
    await toggle();
    await toggled.waitForFunction(() => !document.querySelector("#ledger-host"), undefined, { timeout: 5000 });
    check("the toolbar toggle message opens and closes the panel", !mountedBefore);
    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: "https://discord.com/channels/789/456" });
      chrome.tabs.sendMessage(tabs[0].id, { type: "ledger-toggle" });
      chrome.tabs.sendMessage(tabs[0].id, { type: "ledger-toggle" });
    });
    await toggled.waitForSelector("#ledger-host", { timeout: 5000, state: "attached" });
    await toggled.waitForTimeout(800);
    const hosts = await toggled.evaluate(() => document.querySelectorAll("#ledger-host").length);
    check("two quick toolbar presses mount one panel", hosts === 1, `hosts=${hosts}`);
    await toggled.close();

    const page0 = await context.newPage();
    await page0.goto("https://discord.com/channels/789/456?ledger=1");
    await page0.waitForSelector("#ledger-host", { timeout: 10000, state: "attached" });
    const label = await page0.evaluate(() => document.querySelector("#ledger-host")?.shadowRoot?.querySelector(".channel")?.textContent);
    check("the panel names the open channel", label === "Server channel 456", String(label));

    const channelLine = () => page0.evaluate(() => document.querySelector("#ledger-host")?.shadowRoot?.querySelector(".channel")?.textContent);
    await page0.evaluate(() => history.pushState({}, "", "/channels/@me/321"));
    await page0.waitForTimeout(800);
    const movedLabel = await channelLine();
    await page0.evaluate(() => history.pushState({}, "", "/channels/789/456"));
    await page0.waitForTimeout(800);
    const backLabel = await channelLine();
    check(
      "the channel line follows Discord moving to another channel with the panel open",
      movedLabel === "Direct message channel 321" && backLabel === "Server channel 456",
      `${movedLabel} -> ${backLabel}`,
    );

    const title = await page0.evaluate(
      () => document.querySelector("#ledger-host")?.shadowRoot?.querySelector(".title")?.textContent,
    );
    check("shadow DOM panel renders the Ledger title", title === "LEDGER", String(title));

    const defaults = await page0.evaluate(() => {
      const s = document.querySelector("#ledger-host").shadowRoot;
      return { from: s.querySelector(".from").value, to: s.querySelector(".to").value };
    });
    const span = new Date(defaults.to).getTime() - new Date(defaults.from).getTime();
    check("range inputs default to the last 24 hours", span === 86_400_000, JSON.stringify(defaults));

    const pickButtons = await page0.evaluate(() => {
      const s = document.querySelector("#ledger-host").shadowRoot;
      return Boolean(s.querySelector(".pick-from") && s.querySelector(".pick-to"));
    });
    check("calendar buttons sit beside both time fields", pickButtons);

    const beforeKeys = await getShadowValue(page0, ".from");
    await page0.evaluate(() => {
      const el = document.querySelector("#ledger-host")?.shadowRoot?.querySelector(".from");
      el.focus();
    });
    await page0.keyboard.press("ArrowUp");
    await page0.keyboard.press("ArrowUp");
    await page0.keyboard.press("ArrowUp");
    await page0.waitForTimeout(120);
    const afterKeys = await getShadowValue(page0, ".from");
    check(
      "keyboard edits reach the From field past a hostile page-level key grabber",
      afterKeys !== beforeKeys,
      `${beforeKeys} -> ${afterKeys}`,
    );
    const leak = await page0.evaluate(() => ({
      active: document.activeElement ? document.activeElement.id || document.activeElement.tagName : "none",
      stolen: document.getElementById("fake-chat") ? document.getElementById("fake-chat").value : null,
    }));
    check("keystrokes stay out of the page's own input grabber", !leak.stolen && leak.active !== "fake-chat", JSON.stringify(leak));
    let pickerOk = true;
    try {
      (await shadowQuery(page0, ".pick-from")).asElement().click();
    } catch {
      pickerOk = false;
    }
    await page0.waitForTimeout(150);
    const calOpen = await page0.evaluate(() =>
      Boolean(document.querySelector("#ledger-host")?.shadowRoot?.querySelector(".cal")),
    );
    check("the calendar button opens the month grid", pickerOk && calOpen);

    const dayPicked = await page0.evaluate(() => {
      const s = document.querySelector("#ledger-host").shadowRoot;
      const day = [...s.querySelectorAll(".cal-day")].find((b) => b.textContent === "15" && !b.classList.contains("dim"));
      if (!day) return null;
      day.click();
      return s.querySelector(".from").value;
    });
    check(
      "picking a day writes it into the From field keeping the time",
      Boolean(dayPicked && /-15T\d{2}:\d{2}/.test(dayPicked)),
      String(dayPicked),
    );

    const calendarState = () =>
      page0.evaluate(() => {
        const s = document.querySelector("#ledger-host")?.shadowRoot;
        const cal = s?.querySelector(".cal");
        return cal ? { count: s.querySelectorAll(".cal").length, top: cal.getBoundingClientRect().top } : null;
      });
    const buttonBottom = (sel) =>
      page0.evaluate((q) => document.querySelector("#ledger-host").shadowRoot.querySelector(q).getBoundingClientRect().bottom, sel);
    const pickedClosed = (await calendarState()) === null;
    await clickShadow(page0, ".pick-from");
    await page0.waitForTimeout(100);
    const reopened = await calendarState();
    check("after a day is picked, one press opens the calendar again", pickedClosed && reopened?.count === 1, JSON.stringify(reopened));
    await clickShadow(page0, ".pick-from");
    await page0.waitForTimeout(100);
    check("the calendar closes from its own button", (await calendarState()) === null);
    await clickShadow(page0, ".pick-to");
    await page0.waitForTimeout(100);
    const underTo = await calendarState();
    const toBottom = await buttonBottom(".pick-to");
    await page0.evaluate(() => document.querySelector("#ledger-host").shadowRoot.querySelector(".cal-day:not(.dim)").focus());
    await page0.keyboard.press("Escape");
    await page0.waitForTimeout(100);
    check("To's calendar opens under its button and Escape closes it", underTo?.top > toBottom && (await calendarState()) === null, `${JSON.stringify(underTo)} to=${toBottom}`);

    const face = () =>
      page0.evaluate(() => {
        const s = document.querySelector("#ledger-host").shadowRoot;
        const back = s.querySelector(".back");
        const links = [...back.querySelectorAll(".about a")].map((a) => ({
          label: a.textContent,
          href: a.getAttribute("href"),
          target: a.target,
          rel: a.rel,
          support: a.classList.contains("about-link--support"),
        }));
        return {
          flipped: s.querySelector(".flip").classList.contains("flipped"),
          frontInert: s.querySelector(".front").inert,
          backInert: back.inert,
          expanded: s.querySelector(".front .info").getAttribute("aria-expanded"),
          label: s.querySelector(".front .info").getAttribute("aria-label"),
          heading: back.querySelector(".about-heading")?.textContent,
          credit: back.querySelector(".about-credit")?.textContent,
          note: back.querySelector(".note")?.textContent,
          frontNote: Boolean(s.querySelector(".front .note")),
          focus: s.activeElement ? `${s.activeElement.closest(".face")?.classList[1]} ${s.activeElement.className}` : "none",
          links,
        };
      });
    const closed = await face();
    check("the About side starts turned away and inert", !closed.flipped && closed.backInert && !closed.frontInert && closed.expanded === "false" && closed.label === "About", JSON.stringify(closed));
    check("the ceiling note sits on the About side, not the export side", !closed.frontNote && closed.note === "Reads only messages you can already see. Stops at a hard ceiling of 5000 pages.", String(closed.note));
    await clickShadow(page0, ".front .info");
    await page0.waitForTimeout(600);
    const opened = await face();
    check("the info button turns the panel over to the About card", opened.flipped && !opened.backInert && opened.frontInert && opened.expanded === "true" && opened.focus === "back info", JSON.stringify({ ...opened, links: undefined }));
    const expectedLinks = [
      ["nauman.cc", "https://www.nauman.cc"],
      ["GitHub", "https://github.com/nshah1d"],
      ["LinkedIn", "https://www.linkedin.com/in/nshah1d/"],
      ["Support on Ko-fi", "https://ko-fi.com/nshah1d"],
    ];
    check(
      "the About card carries the standard heading, credit and links in order",
      opened.heading === "About" &&
        opened.credit === "Made by Nauman Shahid." &&
        JSON.stringify(opened.links.map((l) => [l.label, l.href])) === JSON.stringify(expectedLinks),
      JSON.stringify(opened.links),
    );
    check(
      "About links open in a new tab without a referrer, and only Ko-fi carries the accent",
      opened.links.every((l) => l.target === "_blank" && l.rel === "noopener noreferrer") &&
        opened.links.map((l) => l.support).join() === "false,false,false,true",
    );
    await page0.keyboard.press("Escape");
    await page0.waitForTimeout(600);
    const back = await face();
    check("Escape turns the panel back to the export side with focus on its info button", !back.flipped && back.backInert && back.focus === "front info", JSON.stringify({ ...back, links: undefined }));

    const missingTokenPage = await context.newPage();
    await missingTokenPage.goto("https://discord.com/channels/789/456?ledger=1");
    await missingTokenPage.waitForSelector("#ledger-host", { timeout: 10000, state: "attached" });
    await missingTokenPage.evaluate(() => localStorage.removeItem("token"));
    await clickShadow(missingTokenPage, "button.go");
    await missingTokenPage.waitForFunction(
      () =>
        document
          .querySelector("#ledger-host")
          ?.shadowRoot?.querySelector(".status")
          ?.textContent.includes("token"),
      undefined,
      { timeout: 5000 },
    );
    const tokenMsg = await shadowText(missingTokenPage);
    check("export without a session token states it plainly", tokenMsg.includes("No Discord session token"), tokenMsg);
    await missingTokenPage.close();

    for (const format of ["json", "csv", "md"]) {
      const { suggested, bytes } = await runFormat(context, format);
      check(`${format}: download carries the Ledger filename convention`, suggested === `Ledger_general_20260823-1200_20260824-2000.${format}`, suggested);
      if (format === "json") {
        const parsed = JSON.parse(bytes.replace(/^\uFEFF/, ""));
        check("json: envelope names ledger and counts messages", parsed.tool === "ledger" && parsed.message_count === 4, `count=${parsed.message_count}`);
        check(
          "json: the whole To second is included and nothing after it or before From",
          parsed.messages.map((m) => m.id).join() === [ID_A, ID_B, ID_C, ID_EDGE].join(),
        );
        check("json: raw fidelity preserved including attachments and embeds", parsed.messages[0].attachments?.[0]?.url === "https://cdn.discordapp.com/x/1.png" && parsed.messages[1].embeds?.[0]?.title === "Done");
        check("json: source metadata resolved from the API", parsed.source.guild.name === "Test Server" && parsed.source.channel.name === "general");
        check(
          "json: range carries seconds and the machine timezone",
          parsed.range.start_local === "2026-08-23 12:00:00" && parsed.range.end_local === "2026-08-24 20:00:00" && parsed.range.timezone === ZONE,
          JSON.stringify(parsed.range),
        );
        check("json: version is the first release", parsed.version === "1.0.0", parsed.version);
      }
      if (format === "csv") {
        check("csv: BOM present and CRLF rows", bytes.startsWith("\uFEFF") && bytes.includes("\r\n"));
        check("csv: quoted comma cell survived", bytes.includes('"oldest, with ""quotes"" and, commas"'));
        check("csv: header carries the embeds column", bytes.split("\r\n")[0].endsWith(",reply_to_id,embeds"));
        check("csv: embed text reaches the embeds column", bytes.includes('"Done\nnpm test\nnode tests/browser_gate.mjs\nResult: all passed"'));
        check("csv: four data rows plus header", bytes.split("\r\n").filter((r) => r.length > 0).length === 5);
      }
      if (format === "md") {
        check("md: header block names channel, count and timezone", bytes.startsWith("# Discord export: #general") && bytes.includes("- Messages: 4") && bytes.includes(`(machine local, ${ZONE})`));
        check("md: attachment line renders", bytes.includes("    ↳ attachment: https://cdn.discordapp.com/x/1.png"));
        check("md: embed renders beneath its message", bytes.includes("middle\n    multiline\n    ↳ embed: Done\n        npm test\n        node tests/browser_gate.mjs\n        Result: all passed\n"));
      }
    }

    const linked = await runFormat(context, "json", "/channels/789/456/999999999999999999");
    const linkedJson = JSON.parse(linked.bytes);
    check("a message link exports its channel, not the message", linkedJson.source.channel.id === "456" && linkedJson.message_count === 4, `channel=${linkedJson.source.channel.id}`);

    const refusedPage = await context.newPage();
    const before403 = requests.length;
    await refusedPage.goto("https://discord.com/channels/789/457?ledger=1");
    await refusedPage.waitForSelector("#ledger-host", { timeout: 10000, state: "attached" });
    await clickShadow(refusedPage, "button.go");
    await refusedPage.waitForFunction(
      () => (document.querySelector("#ledger-host")?.shadowRoot?.querySelector(".status")?.textContent ?? "").includes("cannot read"),
      undefined,
      { timeout: 5000 },
    );
    const refusedMsg = await shadowText(refusedPage);
    const refusedCalls = requests.slice(before403).filter((u) => u.includes("/api/v9/channels/457")).length;
    check(
      "a refused channel stops after one request and says why",
      refusedMsg === "Could not read this channel: This account cannot read this channel." && refusedCalls === 1,
      `${refusedMsg} :: requests=${refusedCalls}`,
    );
    await refusedPage.close();

    const cancelPage = await context.newPage();
    let blockCancel = true;
    await context.route("**://discord.com/**/messages*", async (route) => {
      while (blockCancel) await new Promise((r) => setTimeout(r, 200));
      await route.fulfill(jsonRes(MESSAGES_PAGE_1)).catch(() => {});
    });
    await cancelPage.goto("https://discord.com/channels/789/456?ledger=1");
    await cancelPage.waitForSelector("#ledger-host", { timeout: 10000, state: "attached" });
    await clickShadow(cancelPage, "button.go");
    await cancelPage.waitForTimeout(800);
    await clickShadow(cancelPage, "button.cancel");
    let cancelledWhileBlocked = true;
    try {
      await cancelPage.waitForFunction(
        () =>
          (document.querySelector("#ledger-host")?.shadowRoot?.querySelector(".status")?.textContent ?? "").includes("Cancelled"),
        undefined,
        { timeout: 3000 },
      );
    } catch {
      cancelledWhileBlocked = false;
    }
    blockCancel = false;
    const cancelMsg = await shadowText(cancelPage);
    check("cancel aborts a request still in flight", cancelledWhileBlocked, cancelMsg);
    check("cancellation reports honestly that nothing was saved", cancelMsg === "Cancelled at 0 pages. Nothing was saved.", cancelMsg);
    await cancelPage.close();

    const errPage = await context.newPage();
    await errPage.goto("https://discord.com/channels/789/456?ledger=1");
    await errPage.waitForSelector("#ledger-host", { timeout: 10000, state: "attached" });
    await setShadowValue(errPage, ".from", "2026-08-25T09:00");
    await setShadowValue(errPage, ".to", "2026-08-25T08:00");
    await clickShadow(errPage, "button.go");
    await errPage.waitForFunction(
      () =>
        (document.querySelector("#ledger-host")?.shadowRoot?.querySelector(".status")?.textContent ?? "").includes("From and To"),
      undefined,
      { timeout: 5000 },
    );
    check("an inverted range is refused in the panel", true, await shadowText(errPage));
    await errPage.close();

    await page0.close();
  } finally {
    await context.close();
    rmSync(userData, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nBROWSER GATE: ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("gate crashed:", err);
  process.exit(2);
});
