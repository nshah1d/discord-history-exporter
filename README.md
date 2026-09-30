# Discord History Exporter

![JavaScript](https://img.shields.io/badge/JavaScript-ES2020+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Zero Dependencies](https://img.shields.io/badge/Runtime_Dependencies-Zero-4FC08D?style=for-the-badge)
![Licence](https://img.shields.io/badge/Licence-MIT-0078D4?style=for-the-badge)

Discord History Exporter is an unpacked Chromium extension that saves one visible Discord channel over an exact local time range. The LEDGER panel opens inside Discord, walks the channel's message history through the logged-in account and downloads JSON, CSV or Markdown.

The extension has no server, build step, settings file or runtime package dependency. Export data is assembled in browser memory and passed to the browser's download mechanism. The account session token is read at export time and is neither displayed nor written by the extension.

It is for anyone who needs a faithful copy of a conversation their own account can already see, cut between two exact moments rather than whole days, without creating a bot or an application first.

---

## What It Does

- Exports server channels, direct messages, group direct messages, threads and forum posts that the logged-in account can already read.
- Uses local From and To values with second-level precision. The complete selected To second is included.
- Walks backwards in pages of up to 100 messages, sorts the result oldest first and removes repeated message IDs.
- Saves raw Discord message objects in JSON, fixed RFC 4180 columns in CSV, or a readable Markdown transcript.
- Preserves attachment URLs, textual embed content and reply references. Attachment files are not downloaded.
- Reports progress, supports cancellation and saves nothing when a run fails or is cancelled.
- Paces requests, honours Discord rate-limit waits and retries bounded transient failures.
- Stops any single export after 5,000 pages, which is at most 500,000 fetched messages. Larger histories require shorter time ranges.

---

## Architecture

A Manifest V3 service worker sends the `ledger-toggle` message to the active Discord tab. A content script mounts an isolated Shadow DOM panel, reads the session token from Discord's local storage when an export starts, derives snowflake bounds from the selected local times and requests channel history from Discord API v9. Format modules produce the download entirely in the tab.

Full architecture reference: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Requirements

Runtime requirements:

- A Chromium browser with Manifest V3 extension support.
- A logged-in Discord account with access to the channel being exported.
- Developer mode enabled on the browser's extensions page for unpacked loading.
- Enough browser memory and local disk space for the selected export.

Development and verification requirements:

- Node.js 18 or later for the unit suites.
- Python 3, `zip` and `unzip` for `scripts/pack.sh`.
- Playwright and a Chromium executable for `tests/browser_gate.mjs`. These are test tools and are not runtime dependencies.

---

## Quick Start

1. Clone the repository.

   ```bash
   git clone https://github.com/nshah1d/discord-history-exporter.git
   cd discord-history-exporter
   ```

2. Confirm the unpacked extension directory.

   ```text
   discord-history-exporter/
   └── extension/
       ├── manifest.json
       ├── icons/
       └── src/
   ```

3. Open the browser's extensions page, enable Developer mode, choose **Load unpacked** and select `extension/`.
4. Open or reload `https://discord.com`, enter a channel visible to the logged-in account and press the Ledger toolbar button.
5. Set the From and To values, choose JSON, CSV or Markdown, then press **Export**.
6. Run the unit suites from the repository root.

   ```bash
   node --test
   ```

   The suites run 51 tests.

The browser gate is optional and needs Playwright plus Chromium:

```bash
LEDGER_BROWSER_TOOLS=/path/to/playwright-project \
LEDGER_CHROMIUM=/path/to/chromium \
node tests/browser_gate.mjs
```

Either browser-gate variable may be omitted when its default resolves correctly. The gate runs 44 checks.

---

## Directory Layout

```text
discord-history-exporter/
├── extension/
│   ├── icons/                 # Toolbar and extension icons
│   ├── src/
│   │   ├── formats/           # JSON, CSV, Markdown and embed writers
│   │   ├── about.js           # About card text and external links
│   │   ├── api.js             # Discord API pagination, pacing and failure handling
│   │   ├── background.js      # Toolbar-to-tab toggle message
│   │   ├── calendar.js        # Month-grid date picker
│   │   ├── channel.js         # Discord channel route parsing
│   │   ├── content.js         # Panel lifecycle, token access and export orchestration
│   │   ├── panel.js           # Shadow DOM interface and input isolation
│   │   └── time.js            # Local time, snowflake bounds and timestamp formatting
│   ├── manifest.json          # Manifest V3 entry point and Discord host scope
│   └── package.json           # ES module declaration; no dependencies
├── scripts/
│   └── pack.sh                # Release archive builder for the extension files
├── tests/                     # Unit suites and routed-fake Chromium gate
├── docs/                      # Architecture, configuration and deployment references
├── LICENSE                    # MIT licence
├── README.md                  # Public project guide
└── SECURITY.md                # Threat model and vulnerability reporting
```

---

## Disclaimer

Discord History Exporter is independent of Discord Inc. and is neither affiliated with nor endorsed by Discord Inc. It reads only channels and messages available to the logged-in account and uses that account's own session token.

Discord's terms treat automated access to a normal user account as a breach. The account that runs the extension carries the risk of suspension or termination. Use is entirely at the account holder's discretion and risk.

---

## Configuration

The extension has no settings file or stored preferences. Request limits and failure bounds are constants in `extension/src/api.js`. The browser gate reads `LEDGER_BROWSER_TOOLS` and `LEDGER_CHROMIUM` when external Playwright modules or a specific Chromium executable are required.

Full configuration reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

---

## Deployment

Deployment means loading `extension/` as an unpacked Chromium extension or packing the manifest, icons and source into `dist/Ledger_v<version>.zip`. Updating an unpacked installation requires reloading the extension and every open Discord tab that should receive the revised content script.

Full deployment reference: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## Security

The extension is read-only with respect to Discord: requests retrieve channel metadata, guild metadata and message history. The session token remains in memory for the active export and is sent only to Discord API v9 in the `authorization` header. Export files can contain private messages, raw message fields, attachment URLs and user-supplied text, so their storage and later use remain the account holder's responsibility.

Automated user-account access creates a separate platform risk even when the code performs no write operation. Account enforcement by Discord remains a residual risk of running the extension.

Full security reference: [SECURITY.md](SECURITY.md)

---

<div align="center">
<br>

**_Architected by Nauman Shahid_**

<br>

[![Portfolio](https://img.shields.io/badge/Portfolio-nauman.cc-000000?style=for-the-badge&logo=googlechrome&logoColor=white)](https://www.nauman.cc)
[![GitHub](https://img.shields.io/badge/GitHub-nshah1d-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/nshah1d)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/nshah1d/)

</div>
<br>

Licensed under the [MIT Licence](LICENSE).
