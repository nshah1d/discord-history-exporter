// A content script cannot be an ES module, so the modules load through dynamic imports of their
// extension URLs, which the manifest makes web accessible on discord.com.
(async () => {
  const url = (p) => chrome.runtime.getURL(p);

  let host = null;
  let controller = null;
  let activeExporter = null;
  let mounting = null;
  let channelWatch = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "ledger-toggle") {
      toggle();
    }
  });

  /**
   * Discord keeps the session token in the page's localStorage as a JSON string. It is read when an
   * export starts and lives only in that export's memory; nothing stores it.
   */
  function readToken() {
    const raw = localStorage.getItem("token");
    if (!raw) return "";
    return raw.replace(/"/g, "");
  }

  function describeChannel(channel) {
    return channel
      ? `${channel.isDm ? "Direct message" : "Server"} channel ${channel.channelId}`
      : "Open a Discord channel to export it";
  }

  function localInputValue(date) {
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  /** Lower-case letters, digits and hyphens for the filename, or `fallback` when none remain. */
  function slugify(name, fallback) {
    const slug = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || fallback;
  }

  /**
   * Hands the finished file to the browser's own download through an object URL, so the extension
   * needs no downloads permission. The URL is revoked four seconds later, leaving the download time
   * to start from it.
   */
  function saveFile(text, filename) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 4000);
  }

  async function runExport(ui) {
    const token = readToken();
    if (!token) {
      ui.onError("No Discord session token found. Log in to Discord and try again.");
      return;
    }
    const { parseChannel } = await import(url("src/channel.js"));
    const channel = parseChannel(location.pathname);
    controller?.setChannel(describeChannel(channel));
    if (!channel) {
      ui.onError("Open the channel you want to export first, then press Export.");
      return;
    }
    let bounds;
    try {
      const { rangeBounds } = await import(url("src/time.js"));
      bounds = rangeBounds(ui.startInput, ui.endInput);
    } catch (err) {
      ui.onError(`Check the From and To times: ${err.message}`);
      return;
    }

    const { createExporter } = await import(url("src/api.js"));
    const exporter = createExporter({ channelId: channel.channelId, token });
    activeExporter = exporter;

    let meta;
    try {
      meta = await exporter.getChannelMeta();
    } catch (err) {
      activeExporter = null;
      if (err?.reason === "cancelled") {
        ui.onError("Cancelled before any messages were read. Nothing was saved.");
      } else {
        ui.onError(`Could not read this channel: ${err?.reason ?? err?.message ?? "unknown failure"}`);
      }
      return;
    }

    // A direct message has no name of its own, so its recipients name the export.
    const isDm = channel.isDm || meta.type === 1;
    const channelName =
      meta.name ||
      (meta.recipients ?? []).map((r) => r.username).join(", ") ||
      channel.channelId;

    let guildName = "Direct Messages";
    try {
      if (!isDm && meta.guild_id) {
        guildName = (await exporter.getGuildName(meta.guild_id)) || "Unknown server";
      }
      const { messages } = await exporter.run({
        startId: bounds.startId,
        beforeId: bounds.beforeId,
        onPage: ({ collected }) =>
          ui.onProgress(`${collected} messages so far`),
      });
      activeExporter = null;

      if (messages.length === 0) {
        ui.onError("No messages fall inside that range.");
        return;
      }

      const { formatLocal, snowflakeToMs, formatStamp, machineZone } = await import(url("src/time.js"));
      const localTimestamp = (m) => formatLocal(snowflakeToMs(m.id));
      const exportedAtUtc = new Date().toISOString();

      const startLocal = formatLocal(bounds.startMs);
      const endLocal = formatLocal(bounds.endMs);
      const timezone = machineZone();
      const stampA = formatStamp(bounds.startMs);
      const stampB = formatStamp(bounds.endMs);
      const base = `Ledger_${slugify(channelName, channel.channelId)}_${stampA}_${stampB}`;

      let filename;
      if (ui.format === "json") {
        const { renderJsonExport } = await import(url("src/formats/json.js"));
        filename = `${base}.json`;
        saveFile(
          renderJsonExport({
            version: chrome.runtime.getManifest().version,
            exportedAtUtc,
            source: {
              guild: { id: isDm ? "" : (meta.guild_id ?? ""), name: guildName },
              channel: { id: channel.channelId, name: channelName, type: isDm ? "dm" : "guild" },
            },
            range: { start_local: startLocal, end_local: endLocal, timezone },
            messages,
          }),
          filename,
        );
      } else if (ui.format === "csv") {
        const { renderCsvExport } = await import(url("src/formats/csv.js"));
        filename = `${base}.csv`;
        saveFile(renderCsvExport({ messages, localTimestamp }), filename);
      } else {
        const { renderMarkdownExport } = await import(url("src/formats/md.js"));
        filename = `${base}.md`;
        saveFile(
          renderMarkdownExport({
            guildName,
            channelName,
            channelId: channel.channelId,
            rangeStartLocal: startLocal,
            rangeEndLocal: endLocal,
            timezone,
            exportedAtUtc,
            messages,
            localTimestamp,
          }),
          filename,
        );
      }
      ui.onFinished(`${filename} (${messages.length} messages)`);
    } catch (err) {
      activeExporter = null;
      const reason = err?.reason ?? err?.message ?? "unknown failure";
      if (reason === "cancelled") {
        ui.onError(`Cancelled at ${exporter.pages} pages. Nothing was saved.`);
      } else {
        ui.onError(`Export stopped: ${reason}`);
      }
    }
  }

  /**
   * Discord's page takes keystrokes typed outside its own fields into its message box. This
   * listener stops keyboard, input and wheel events that start inside the panel at the window, in
   * the capture phase, so Discord's listeners on the document and below never receive them. The
   * panel's own listeners would not receive them either, so the panel's key handling runs from
   * here, before the event is stopped.
   */
  function installInputGuard() {
    const guard = (e) => {
      if (host && e.composedPath().includes(host)) {
        if (e.type === "keydown") controller?.onKeydown(e);
        e.stopImmediatePropagation();
      }
    };
    for (const type of ["keydown", "keyup", "keypress", "input", "wheel"]) {
      window.addEventListener(type, guard, true);
    }
  }

  async function mount() {
    const { mountPanel } = await import(url("src/panel.js"));
    const { parseChannel } = await import(url("src/channel.js"));
    host = document.createElement("div");
    host.id = "ledger-host";
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    controller = mountPanel(shadow, {
      onExport: (cfg) => runExport(cfg),
      onCancel: () => activeExporter?.cancel(),
      onClose: () => unmount(),
    });

    // Discord moves between channels without reloading the page, so the channel line follows the
    // address while no export is running. During an export it keeps naming the channel being read.
    let shownPath = location.pathname;
    controller.setChannel(describeChannel(parseChannel(shownPath)));
    channelWatch = setInterval(() => {
      if (activeExporter || location.pathname === shownPath) return;
      shownPath = location.pathname;
      controller?.setChannel(describeChannel(parseChannel(shownPath)));
    }, 500);
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    controller.setRangeDefaults(localInputValue(dayAgo), localInputValue(now));
    controller.setStatus("");
  }

  function unmount() {
    clearInterval(channelWatch);
    channelWatch = null;
    activeExporter?.cancel();
    activeExporter = null;
    controller = null;
    host?.remove();
    host = null;
  }

  // A press that arrives while the panel's modules are still loading is ignored, so two quick
  // presses on the toolbar button cannot mount two panels.
  function toggle() {
    if (mounting) return;
    if (host) {
      unmount();
      return;
    }
    mounting = mount()
      .catch(() => {})
      .finally(() => {
        mounting = null;
      });
  }

  installInputGuard();

  // Any discord.com address with `?ledger` opens the panel without the toolbar button.
  if (new URLSearchParams(location.search).has("ledger")) {
    toggle();
  }
})();
