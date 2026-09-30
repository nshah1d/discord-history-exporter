# Discord History Exporter Configuration

Discord History Exporter has no settings file, options page, environment file or stored preference. Runtime behaviour comes from fixed source constants, the selected panel values and the current Discord route. Two environment variables affect only the browser verification gate.

## Runtime Inputs

| Input | Type | Default | Valid value | Effect | Failure behaviour |
|:--|:--|:--|:--|:--|:--|
| From | Local date and time | 24 hours before panel mount | A value accepted by the browser's `Date` parser | Sets the inclusive start snowflake | The panel reports the date error and sends no request |
| To | Local date and time | Time of panel mount | A valid date at or after From | Includes the entire selected second | A value before From is refused and sends no request |
| Format | Enum | `json` | `json`, `csv`, `md` | Selects the output writer and filename extension | The shipped select exposes only the three valid values |
| Current Discord route | Path | Current tab location | A supported `/channels/...` route | Selects one server channel, DM, group DM, thread or forum post | The panel asks for a Discord channel before export |
| Discord session token | Non-empty string | Current `localStorage.token` value | A logged-in account token | Authorises metadata and history requests | Missing token stops before the first request |

`setRangeDefaults()` and `runExport()` in `extension/src/content.js` own these inputs. The calendar in `extension/src/calendar.js` changes only the date portion of a field and keeps its existing time. A date-only value chosen through the calendar receives `12:00` when no time exists.

## API Constants

All request constants live in `extension/src/api.js`. They are source settings and require a code change plus extension reload.

| Constant | Type | Default | Effect and valid range | Reason |
|:--|:--|:--|:--|:--|
| `API_BASE` | URL string | `https://discord.com/api/v9` | Base for channel, guild and message requests; the shipped value is fixed | Keeps all authenticated requests on one explicit Discord API origin and version |
| `PAGE_LIMIT` | Integer | `100` | Sends `limit=100`; Discord accepts 1 to 100 | Uses the largest supported page to reduce request count |
| `MAX_CONSECUTIVE_FAILURES` | Integer | `5` | Must remain a positive count if changed | Prevents a transient-failure loop from running indefinitely |
| `MAX_CONSECUTIVE_RATE_LIMITS` | Integer | `10` | Must remain a positive count if changed | Stops a range that Discord continues to rate limit |
| `DEFAULT_PAGE_CEILING` | Integer | `5000` | Maximum successful pages in one run | Caps a non-terminating walk and bounds one export to at most 500,000 fetched messages |
| `DEFAULT_PAGE_DELAY_MS` | Milliseconds | `400` | Non-negative base delay between ordinary pages | Paces user-account requests before a 429 occurs |
| `PAGE_JITTER_MS` | Milliseconds | `200` | Produces an added integer from 0 to 199 | Avoids a fixed request interval |
| `REQUEST_TIMEOUT_MS` | Milliseconds | `30000` | Positive request deadline | Converts a hung request into a bounded transient failure |
| `FALLBACK_RATE_WAIT_MS` | Milliseconds | `5000` | Used when a 429 supplies no positive numeric wait | Prevents an immediate rate-limit retry loop |
| `MAX_BUCKET_WAIT_MS` | Milliseconds | `60000` | Caps an announced exhausted-bucket reset wait | Keeps one server-supplied reset value from holding the run indefinitely |
| `BACKOFF_MS` | Millisecond array | `[1000, 2000, 4000, 8000]` | One delay before each retry after failures one through four | Gives transient failures increasing recovery time before the fifth stops the run |

`createExporter()` also accepts injectable `fetchImpl`, `delay`, `sleepImpl`, `ceilingPages` and `timeoutMs` values. These are test seams used by `tests/api.test.mjs`; the extension calls the function with only `channelId` and `token`, so runtime use receives the defaults above.

## Rate-Limit Overrides

Two Discord response values override ordinary pacing for the current request:

| Value | Source | Behaviour |
|:--|:--|:--|
| `retry_after` or `Retry-After` | HTTP 429 JSON body or response header, in seconds | Retries the same request after the announced wait, with a minimum of one second |
| `x-ratelimit-reset-after` | Successful response header, in seconds | Replaces the ordinary page delay when `x-ratelimit-remaining` is `0`, at least 400 milliseconds and at most 60 seconds |

Invalid or missing 429 waits use `FALLBACK_RATE_WAIT_MS`. A missing or invalid exhausted-bucket reset falls back to ordinary pacing.

## Manifest Scope

`extension/manifest.json` fixes the browser integration:

| Field | Value | Effect |
|:--|:--|:--|
| `manifest_version` | `3` | Uses the Chromium Manifest V3 service-worker model |
| `permissions` | `[]` | Requests no named extension permission |
| `host_permissions` | `*://discord.com/*` | Grants the extension access to Discord's web origin and no other host |
| Content-script match | `*://discord.com/*` | Mounts the runtime only in Discord tabs |
| `run_at` | `document_idle` | Starts after the page has loaded enough for content-script work |
| Web-accessible resources | `src/*` on `*://discord.com/*` | Allows the non-module content script to import extension modules dynamically |

Changing any manifest field requires reloading the extension from the browser's extensions page and reloading open Discord tabs.

## Fixed Behaviour Without a Setting

Several literals affect behaviour but are deliberately unavailable as user settings:

- `extension/src/content.js` defaults the range to the previous 24 hours.
- `extension/src/content.js` revokes each download object URL four seconds after starting the browser download.
- `extension/src/channel.js` accepts snowflakes containing one to 20 decimal digits.
- `extension/src/panel.js` labels the hard ceiling as 5000 pages and exposes three fixed formats.
- `extension/src/formats/csv.js` always writes a UTF-8 byte order mark, CRLF row endings and nine columns.
- `extension/src/formats/json.js` always writes `"tool": "ledger"`.
- Export filenames always begin with `Ledger_`.

These values have no validation route outside the code. A change must keep the affected tests and public documents in agreement.

## Browser Gate Variables

`tests/browser_gate.mjs` reads two optional environment variables:

| Variable | Type | Default | Effect | Invalid value |
|:--|:--|:--|:--|:--|
| `LEDGER_BROWSER_TOOLS` | Absolute directory path | The repository's own module resolution | Uses `<value>/package.json` as the base for resolving `playwright` | A relative path is refused by Node's `createRequire()`, and a directory without Playwright fails module loading, both before the gate starts |
| `LEDGER_CHROMIUM` | Executable path | Playwright channel `chromium` | Passes the value as Playwright's `executablePath` | Chromium launch fails and the gate exits with an error |

Examples:

```bash
LEDGER_BROWSER_TOOLS=/path/to/playwright-project node tests/browser_gate.mjs
```

```bash
LEDGER_CHROMIUM=/usr/bin/chromium node tests/browser_gate.mjs
```

```bash
LEDGER_BROWSER_TOOLS=/path/to/playwright-project \
LEDGER_CHROMIUM=/usr/bin/chromium \
node tests/browser_gate.mjs
```

The browser gate uses `Asia/Dubai` as its fixed test timezone and routes every `discord.com` request to local fixtures. Neither environment variable changes extension runtime behaviour.

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
