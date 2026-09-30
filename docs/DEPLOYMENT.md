# Discord History Exporter Deployment

Discord History Exporter runs as an unpacked Chromium extension. There is no application server, database, build step or settings file. Deployment consists of placing the shipped extension files together, loading `extension/` in the browser and reloading Discord tabs after an install or update.

## Deployment Contents

The unpacked source directory contains these paths:

```text
extension/
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── formats/
│   │   ├── csv.js
│   │   ├── embeds.js
│   │   ├── json.js
│   │   └── md.js
│   ├── about.js
│   ├── api.js
│   ├── background.js
│   ├── calendar.js
│   ├── channel.js
│   ├── content.js
│   ├── panel.js
│   └── time.js
├── manifest.json
└── package.json
```

Chromium loads `manifest.json`, `icons/` and `src/`. `extension/package.json` marks the `.js` sources as ES modules so Node can import them in the unit suites. The browser does not need it, and `scripts/pack.sh` leaves it out of the release archive.

## Load an Unpacked Installation

1. Clone or download the repository.
2. Open the Chromium browser's extensions page.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select the repository's `extension/` directory, not the repository root.
6. Pin the Ledger toolbar action if required.
7. Open or reload a `discord.com` tab after the extension is loaded.
8. Enter a visible Discord channel and press the Ledger toolbar button.

The panel title reads `LEDGER`. If the toolbar button does nothing in a tab that was already open, reload that tab. The content script exists only in pages loaded after the current extension version became active.

## Pack a Release Archive

Packing needs Bash, Python 3, `zip` and `unzip`. The script locates the repository from its own path, so it works from any directory. From the repository root:

```bash
./scripts/pack.sh
```

The script reads `version` from `extension/manifest.json`, removes an older archive with the same version and creates:

```text
dist/Ledger_v<version>.zip
```

The archive root contains `manifest.json`, `icons/` and `src/`. The script prints the archive path and the final lines of `unzip -l` for a quick content check.

Inspect the complete archive before distribution:

```bash
unzip -l dist/Ledger_v1.0.0.zip
```

The archive is packaging output and is ignored by `.gitignore`. It is not a build artefact required for unpacked use.

## Install from a Packed Archive

Chromium's **Load unpacked** control requires a directory. Extract the archive first, then select the extracted directory containing `manifest.json`:

```bash
mkdir discord-history-exporter-extension
unzip dist/Ledger_v1.0.0.zip -d discord-history-exporter-extension
```

Do not select the ZIP file itself in **Load unpacked**.

## Update an Existing Installation

1. Replace the existing extension source with the new `extension/` contents, or extract the new archive over a clean extension directory.
2. Open the browser's extensions page.
3. Find Discord History Exporter and press **Reload**.
4. Reload every open Discord tab that should receive the updated content script.
5. Open a channel and toggle the panel once before starting a large export.

Keeping old and new source files in one extracted directory can leave removed modules behind. Extract releases into a clean directory or remove the previous contents before copying the new set.

## Verify the Source

Run the unit suites from the repository root:

```bash
node --test
```

The unit suites require Node.js 18 or later and no installed package dependency.

The suites run 51 tests.

## Verify the Loaded Extension

The browser gate needs Playwright and Chromium. When Playwright is installed in another project, point `LEDGER_BROWSER_TOOLS` at that directory. When the bundled Chromium is unavailable, point `LEDGER_CHROMIUM` at a Chromium executable.

```bash
LEDGER_BROWSER_TOOLS=/path/to/playwright-project \
LEDGER_CHROMIUM=/path/to/chromium \
node tests/browser_gate.mjs
```

The gate loads `extension/` into a temporary persistent Chromium profile. Every `discord.com` request is intercepted and answered from fixtures, so the verification does not use a live Discord account or channel.

The gate runs 44 checks.

A manual smoke check covers the deployment seam that matters most:

1. Reload the extension.
2. Reload an open Discord tab.
3. Press the toolbar action and confirm that one LEDGER panel opens.
4. Confirm that the panel closes on the next toolbar press.
5. Export a short range from an account and channel designated for that test.
6. Confirm that the downloaded filename begins with `Ledger_` and carries the chosen extension.

The final manual step uses the account's live session and carries the platform risk described in `SECURITY.md`.

## File Permissions and Placement

The browser process needs read access to the unpacked directory. The packaging script needs write access to `dist/`. No file needs executable permission except `scripts/pack.sh` when invoked directly.

Do not place credentials, exported histories or a copied Discord token inside the extension directory. The extension reads the active session token from Discord at run time. An export belongs in a private location chosen through the browser's download behaviour.

Do not publish a package that contains `.git/`, local exports, browser profiles, test downloads or private configuration. `scripts/pack.sh` avoids this class of error by naming the three included paths explicitly.

## Rollback

For an unpacked installation, restore the previous clean `extension/` directory, press **Reload** on the extensions page and reload open Discord tabs. For a packed release, extract the previous archive into a clean directory and load or reload that directory.

An in-progress export belongs to the content script that started it. Updating or reloading the extension or tab ends that run. Start the range again after rollback; no resumable state exists.

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

Licensed under the [MIT Licence](../LICENSE).
