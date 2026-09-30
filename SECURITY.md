# Discord History Exporter Security

Discord History Exporter runs inside a logged-in Discord tab and reads the account's session token to make authenticated Discord API requests. That design keeps message processing in the browser, but it also places the extension inside the account's trust boundary. Installation grants the shipped code access to data available through that session on `discord.com`.

## Threat Model

The security model considers:

- an extension package altered before installation;
- a Discord account token exposed through malicious extension code, page compromise, browser compromise or local inspection;
- private export files disclosed after download;
- message content interpreted by spreadsheet or Markdown software;
- accidental export of a wider time range or the wrong open channel;
- Discord rate limiting, refusal or account enforcement; and
- malformed or unexpected Discord API replies producing a false complete export.

The extension does not defend a compromised browser, operating system, Discord account or installation directory. It does not encrypt export files, manage their retention or establish that automated access is permitted by Discord.

## Trust Boundaries

### Extension Package

The unpacked `extension/` directory is executable browser code. `extension/manifest.json` exposes the content script and service worker, while `extension/src/content.js` dynamically imports the remaining modules. Review the installed source and distribute packed archives through a trusted route.

The manifest exposes `src/*` as web-accessible on `discord.com` so the classic content script can import modules by extension URL. A Discord page that knows the installed extension ID can test whether one of those resources exists. Unpacked extension IDs can vary between installations; a store-distributed package would have a stable ID. The extension does not claim to hide its presence from Discord.

### Discord Origin and Account Session

`readToken()` in `extension/src/content.js` reads `localStorage.token`, removes quote characters and keeps the result in memory for the current export. `createExporter()` in `extension/src/api.js` sends it as the `authorization` header on Discord API v9 requests.

The token is equivalent to the logged-in account for the requests the extension makes. Anyone who obtains it may gain account access outside the extension. The code does not display, log, download or write the token, but the token already exists in Discord's origin storage and remains exposed to the browser and any code with equivalent access.

### Downloaded Files

JSON can retain every field Discord returns for each message. CSV and Markdown contain selected text, identifiers, timestamps, attachment URLs, embeds and reply information. A finished file leaves extension memory through the browser's download mechanism and remains wherever the browser stores it.

The extension applies no encryption, access control, expiry or deletion policy to downloads. Local filesystem permissions, backup systems, synchronisation tools and later sharing govern the file after creation.

## Permissions and Network Scope

`extension/manifest.json` declares no named extension permissions. Its host permission, content-script match and web-accessible-resource match are limited to `*://discord.com/*`.

Authenticated code requests these Discord API v9 endpoints:

| Method | Endpoint | Purpose |
|:--|:--|:--|
| `GET` | `/channels/{channelId}` | Resolve channel name, type, guild and recipients |
| `GET` | `/guilds/{guildId}` | Resolve the guild name used in output labels |
| `GET` | `/channels/{channelId}/messages?before={cursor}&limit=100` | Walk message history backwards |

The extension sends no write request to Discord. The About card contains external links, but no link is requested until it is opened. Each link uses a new tab with `noopener noreferrer`.

The lack of a write request does not remove account risk. Discord's terms treat automated access to normal user accounts as a breach, and enforcement can include account suspension or termination. The account that runs the extension carries that risk.

## Authentication and Authorisation

There is no separate extension login. Authentication is the Discord session already active in the tab. Authorisation is whatever the account can read through Discord's API.

The extension cannot grant access to a channel the account cannot read. HTTP 401 stops with a session-rejected message, HTTP 403 stops with an access message and HTTP 404 stops with a channel-not-found message. Every other client error except 408 and 429 stops after one request.

Channel selection comes from the current Discord path. A message link exports its containing channel. The panel's channel line follows the current address while no export is running and names the channel being read during one, and the downloaded metadata records the resolved channel and guild labels.

## Token Handling

The token is read only when **Export** is pressed. It is passed into one exporter instance and captured by that instance's request functions. The code has no `chrome.storage` use, IndexedDB write, cookie write or server-side token exchange.

The token remains in JavaScript memory until the exporter and its closures become unreachable. Closing the panel cancels the exporter and removes the panel host, but JavaScript garbage collection controls the exact memory-release time. No code can promise immediate memory erasure.

Reload Discord and sign in again when Discord rejects the session. Never paste a token into a file, command, issue or vulnerability report.

## Request Integrity and Failure Handling

`isPage()` in `extension/src/api.js` rejects any message reply that is not an array or contains a message without a numeric ID. Metadata calls require a non-array object. A malformed success response therefore enters bounded retry handling instead of being treated as an empty end of history.

The exporter also refuses a page whose oldest ID does not move the cursor backwards. This prevents a repeated or forward-moving page from looping until the ceiling while appearing productive.

Requests time out after 30 seconds. Transient failures retry four times with increasing waits and stop on the fifth consecutive failure. Rate limits retry the same cursor, honour a supplied wait and stop after ten consecutive 429 replies. The 5,000-page ceiling bounds a single walk. These controls protect liveness and reduce the chance of saving a truncated result under a complete range name.

No partial file is saved after a request failure, cancellation, empty result or invalid range. This is an integrity property, not a guarantee that Discord returned every message that should exist. Deleted messages, account visibility, Discord-side behaviour and API changes remain outside the extension's control.

## File and Path Handling

The export filename is built in `extension/src/content.js`. Channel names are lower-cased, non-ASCII and non-alphanumeric runs become hyphens, and leading or trailing hyphens are removed. A channel ID is used when no slug remains. This removes path separators and control punctuation from the generated name.

`saveFile()` creates a text `Blob`, uses a temporary object URL and asks the browser to download through an anchor. The object URL is revoked four seconds later. The browser chooses the destination and collision behaviour.

The JSON writer serialises data with `JSON.stringify()`. The CSV writer quotes RFC 4180 fields and prefixes formula-shaped text with an apostrophe. The Markdown writer preserves user-supplied message and embed text as Markdown text. A Markdown renderer may interpret links, HTML or other syntax contained in a message, so exported Markdown must be treated as untrusted content when opened outside a plain-text editor.

## Data Storage and Retention

During a run, messages accumulate in an in-memory array. The complete array is sorted and deduplicated before a writer runs. Very large ranges therefore consume memory in proportion to the messages and raw objects returned.

The extension stores no export history, checkpoint, preference or resumable cursor. Closing the tab, reloading the extension or cancelling a run loses the in-memory state and saves no partial output.

Downloaded files persist until removed by the account holder or another local retention process. Attachment URLs may grant access while Discord continues to accept them and should be protected with the rest of the export.

## Output-Specific Controls

### JSON

JSON preserves raw Discord message objects. This gives the format the widest data surface, including fields absent from CSV and Markdown. Inspect the file before sharing or importing it elsewhere.

### CSV

CSV prefixes any field whose first meaningful character is `=`, `+`, `-` or `@` with an apostrophe. This reduces formula injection when the file is opened in a spreadsheet. Spreadsheet behaviour varies, and imported or transformed data may remove the prefix.

The guard covers the four ASCII trigger characters. Full-width variants can be interpreted as formulas in some locales. A spreadsheet that saves and reopens the file may also discard or reinterpret the prefix, so the guard is a mitigation rather than a durable trust boundary.

### Markdown

Markdown is a readable transcript, not a sanitised web page. Message bodies and textual embed values are not escaped for every Markdown or HTML renderer. Open unknown exports as plain text or in a renderer that disables active HTML and unsafe links.

## Privacy Boundary

Message retrieval and formatting happen in the Discord tab. The code sends authenticated requests only to Discord API v9 and creates the final file locally through the browser.

This boundary does not make the exported data anonymous or harmless. Files can contain user IDs, usernames, timestamps, private messages, attachment links, reply relationships and every raw field present in JSON. The code does not redact, minimise or classify those fields.

## Trade-Offs

| Choice | Benefit | Cost |
|:--|:--|:--|
| The logged-in session instead of a bot token | Direct messages and every channel the account can see, with nothing to set up | The account's own credential drives automated requests, which Discord's terms treat as a breach; a bot token is narrower but cannot read direct messages at all |
| No stored state | No token, history or checkpoint persists anywhere the extension controls | An interrupted export restarts from the beginning; bounded retries make interruption less likely |
| A whole walk before any file | A saved file always covers its complete range | Memory grows with the range until the file is written |
| An apostrophe as the CSV formula guard | Visible to a reader, and JSON keeps the exact text | Less durable in Excel than an invisible tab prefix, which would silently change the cell for any program importing the file |

## Known Limits and Residual Risks

- Running the extension may breach Discord's terms for automated user-account access. Account enforcement remains possible regardless of request pacing.
- Any alteration to the unpacked source can change token and data handling without a signed update boundary.
- Web-accessible module paths can reveal that the extension is installed when the page can determine its extension ID.
- A compromised browser or operating system can read the token, page content or downloaded files.
- Export completeness depends on Discord's API replies, current account visibility and messages that still exist.
- Large ranges can consume substantial time and browser memory before the 5,000-page ceiling.
- Pacing and bounded retries reduce request pressure but cannot guarantee avoidance of rate limits.
- Guild-name lookup failure does not stop an export; the label falls back to `Unknown server`.
- Attachment files are not copied. Their URLs may expire, stop resolving or remain sensitive.
- CSV formula protection covers ASCII triggers and may not survive a spreadsheet re-save.
- The extension does not verify downloaded file integrity with a hash or signature.
- The extension does not encrypt, expire or delete downloads.

## Safe Operation

- Install only reviewed source or an archive received through a trusted route.
- Use the shortest practical time range and confirm the open channel ID before export.
- Keep exports in a private directory with suitable local permissions.
- Treat JSON as the highest-detail format and inspect it before sharing.
- Open Markdown and CSV exports with software configured to treat message content as untrusted.
- Remove exports when their retention purpose ends.
- Stop using the extension if Discord changes its account-access rules, API behaviour or enforcement posture in a way that makes the accepted risk unsuitable.

## Reporting a Vulnerability

Report vulnerabilities through GitHub's private vulnerability reporting in the repository's Security tab. If that route is unavailable, use the contact route at [nauman.cc](https://www.nauman.cc). Do not open a public issue for an undisclosed vulnerability.

Include the affected file and function, the conditions required, the observed consequence and a minimal reproduction where safe. Keep credentials, live configuration and private data out of the report.

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
