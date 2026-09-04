<div align="center">

# Over Party Lab Chatbot

![logo](image/logo.jpg "logo")

**A LINE chatbot that looks up cocktails, and the ingredients they are made with**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-enabled-green.svg)](https://developers.google.com/apps-script)
[![LINE Messaging API](https://img.shields.io/badge/LINE-Messaging%20API-00C300.svg)](https://developers.line.biz/)

[Features](#features) • [Quick Start](#quick-start) • [Documentation](#installation) • [Contributing](#contributing)

</div>

---

## Overview

A LINE messaging bot for [Over Party Lab](https://www.instagram.com/over.party.lab/), built on
Google Apps Script and TypeScript, with its cocktail data in a Google Sheet. Send it a cocktail
name and it answers with the description and the recipe link; send it an ingredient and it offers
the cocktails made with it.

## Features

### Core Capabilities
- 🔍 **Bilingual lookup**: matches a cocktail by its Chinese or English name, ignoring case,
  surrounding whitespace and numerically formatted cells
- 🎯 **Ingredient fallback**: when nothing matches by name, looks the message up in an ingredient
  table and offers the cocktails it maps to
- 🎨 **Buttons template**: up to 4 tappable options, clamped to every Messaging API payload limit so
  a long name or a long message can never make LINE reject the reply
- 📊 **Search log**: every answered message is appended to a Google Sheet
- 💸 **Free to answer**: replies go through the Reply API, which does not count against the LINE
  Official Account's monthly message quota
- 🔒 **Authenticated webhook**: Apps Script cannot verify `x-line-signature`, so requests are
  authenticated by a shared secret in the URL plus a `destination` check

### Technical Highlights
- TypeScript bundled to a single Apps Script file with esbuild, type-checked in strict mode
- 126 tests that run the **built bundle** in a sandbox with the Apps Script APIs stubbed
- CI on every pull request and on pushes to `master`: `npm ci` → typecheck → test → build
- Secrets in script properties, never in source

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Runtime** | Google Apps Script (V8) |
| **Language** | TypeScript 5.7+ |
| **Messaging Platform** | LINE Messaging API (Reply API) |
| **Data Storage** | Google Sheets |
| **Bundler** | esbuild |
| **Deploy Tool** | clasp (Command Line Apps Script Projects) |
| **Tests** | vitest, against the built bundle |

## Architecture

The bot follows a serverless, event-driven architecture:

```
┌─────────────────┐
│   LINE User     │
└────────┬────────┘
         │ message
         ▼
┌──────────────────────────────────────────────────┐
│              LINE Messaging API                  │
└────────┬─────────────────────────────▲───────────┘
         │ POST …/exec?token=SECRET    │ reply (free, single-use token)
         ▼                             │
┌──────────────────────────────────────┴───────────┐
│           Google Apps Script web app             │
│                                                  │
│  doPost(e)                                       │
│   1. token       vs WEBHOOK_TOKEN  ── reject ──▶ 200
│   2. destination vs BOT_USER_ID    ── reject ──▶ 200
│   3. for each event: text messages only          │
│        buildReply()  ─ lookup, then fallback     │
│        lineMessage   ─ clamp to API limits       │
│        lineService   ─ POST /message/reply       │
│        sheetService  ─ append the search         │
│   4. always 200 {"status":"ok"}                  │
└────────┬─────────────────────────────────────────┘
         │ one read per tab per delivery; one append per event
         ▼
┌──────────────────────────────────────────────────┐
│                 Google Sheets                    │
│  DRINK_LIST     ELEMENT_MAPPING     USER_ACTION  │
│  (cocktails)    (ingredient → idx)  (search log) │
└──────────────────────────────────────────────────┘

Secrets (channel token, spreadsheet id, webhook token, bot user id)
live in Apps Script script properties, never in the source.
```

## Prerequisites

Before you begin, ensure you have the following:

- **Node.js**: v20.0.0 or later ([Download](https://nodejs.org/)) — required by clasp 3.x
- **Package Manager**: npm. The repository ships a `package-lock.json` and CI runs `npm ci`, so
  installing with yarn would desynchronise the lockfile
- **Google Account**: For Google Apps Script and Sheets access
- **LINE Developer Account**: [Register here](https://developers.line.biz/)
- **LINE Messaging API Channel**: [Create a channel](https://developers.line.biz/console/)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/sean1093/over-party-lab-chatbot.git
cd over-party-lab-chatbot

# Install dependencies (clasp is a devDependency, no global install needed)
npm install

# Login to Google Account
npx clasp login

# Create the Apps Script project with the build output as its root
# (`--type webapp` is rejected by clasp 3.x; the project is a web app because
#  appsscript.json says so, not because of a flag)
npx clasp create-script --title "Over Party Lab Chatbot" --rootDir dist

# Bundle TypeScript -> dist/Code.js and upload
npm run push
npx clasp deploy

# Finally, set the secrets as script properties (see step 3 below)
```

## Installation

### 1. Install Dependencies

```bash
# Install project dependencies (includes clasp and esbuild)
npm install
```

### 2. Setup Google Apps Script

```bash
# Login to Google Account
npx clasp login

# Create a new Apps Script project, with dist/ as the directory clasp uploads.
# Do not pass `--type webapp`: clasp 3.x rejects it with "Invalid container
# file type". What makes this a web app is the `webapp` block in
# appsscript.json, which is already committed.
npx clasp create-script --title "Over Party Lab Chatbot" --rootDir dist

# Or adopt an existing project
npx clasp clone-script <SCRIPT_ID> --rootDir dist
```

### 3. Configure Environment

Non-secret settings (column mapping, sheet tab names, Instagram link) live in
[config.ts](config.ts) and are committed. **Secrets are not stored in source** — they are read from Apps
Script script properties at runtime, so they never end up in the code that `clasp push` uploads.

Open the Apps Script project (`npx clasp open-script`) and go to
**Project Settings → Script properties → Add script property**:

| Property | Value |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | Channel access token from LINE Developers Console → your channel → Messaging API |
| `SPREADSHEET_ID` | The `{SHEET_ID}` part of `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit` |
| `WEBHOOK_TOKEN` | A random secret you generate: `openssl rand -hex 24`. Keep it URL-safe (`[A-Za-z0-9._~-]`) and free of leading or trailing whitespace — the comparison is exact, and a stray space fails silently with a `200`. It is appended to the webhook URL and every request must carry it |
| `BOT_USER_ID` | This bot's own user ID, shown as **Your user ID** in LINE Developers Console → your channel → Basic settings. Every delivery's `destination` must equal it |
| `DEBUG_USER_ID` | Your own LINE user ID; used by `test_post()` and `test_send()` |

If a property is missing, the execution fails with
`ConfigurationError: Missing script property "<KEY>"` — the webhook returns an error and LINE's
**Verify** button fails, so a misconfigured deployment is obvious instead of silently answering
"not found" to every user. See [properties.ts](properties.ts).

### 4. Setup Google Sheets

1. Create a new Google Sheet
2. Create three tabs, each with a header row, laid out as follows. The bot always treats **row 1 as
   a header** and reads from row 2 onwards.

#### Tab 1: DRINK_LIST
Stores cocktail recipes and information.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| A `name` | Text | Chinese cocktail name | 瑪格麗特 |
| B `nameen` | Text | English cocktail name | Margarita |
| C `link` | URL | Recipe link | https://... |
| D `detail` | Text | Cocktail description | 經典龍舌蘭調酒... |

#### Tab 2: ELEMENT_MAPPING
Maps an ingredient to the cocktails made with it.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| A `name` | Text | Chinese ingredient name | 龍舌蘭 |
| B `nameen` | Text | English ingredient name | Tequila |
| C, D | — | Unused; leave empty | |
| E `recommendation` | Text | Comma-separated **0-based row indices** into `DRINK_LIST` | `0,2` |

> **The `recommendation` cell holds indices, not names.** `0` is the first *data* row of
> `DRINK_LIST` (spreadsheet row 2), `1` the second, and so on. Non-numeric or out-of-range entries
> are skipped; if none survives, the user gets the not-found reply. Note that inserting or deleting
> a `DRINK_LIST` row shifts every index after it.
>
> The column positions above are fixed by `COLUMN_KEY_MAPPING` in [config.ts](config.ts), which
> applies to **every** tab — which is why `recommendation` is column E here even though C and D are
> unused.

#### Tab 3: USER_ACTION
Needs only its header row; the bot fills in every data row itself. The header is required — the
index is derived from the row position, so without it every index is off by one.

| Column | Type | Description |
|--------|------|-------------|
| index | Number | 0-based row counter, assigned under a short script lock. If the lock cannot be taken within 500 ms the write still goes ahead, so the index may repeat rather than the row being lost |
| search | Text | User search query (trimmed) |
| user | Text | LINE User ID; empty for group/room events without one |
| time | Datetime | Timestamp |

3. Copy the Google Sheet ID from the URL into the `SPREADSHEET_ID` script property
   (see [Configure Environment](#3-configure-environment))

### 5. Build and Deploy

clasp 3.x does not transpile TypeScript, so the sources are bundled locally into a single
`dist/Code.js` (plus a copy of `appsscript.json`) before being uploaded. `.clasp.json` must contain
`"rootDir": "dist"`; `npm run build` refuses to run if it points anywhere else.

```bash
# Bundle TypeScript and push the bundle
npm run push

# Deploy as web app
npx clasp deploy
```

### 6. Configure LINE Webhook

1. Deploy, and note the deployment ID — clasp 3.x prints `Deployed <deploymentId> @HEAD` and no
   URL:
   ```bash
   npx clasp create-deployment
   # or, to list the existing ones: npx clasp list-deployments
   ```

2. Append the shared secret to it. Apps Script web apps cannot read request
   headers, so LINE's `x-line-signature` cannot be verified here; the secret in the
   URL is what authenticates the caller instead:
   ```
   https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?token=<WEBHOOK_TOKEN>
   ```

3. Configure LINE Messaging API:
   - Go to [LINE Developers Console](https://developers.line.biz/console/)
   - Select your Messaging API channel
   - Navigate to **Messaging API** tab
   - Set **Webhook URL** to the URL from step 2, **including `?token=`**
   - Enable **Use webhook**
   - Disable **Auto-reply messages** (optional, recommended)

4. Verify webhook:
   - Click **Verify** button in LINE Console
   - Should return success message. A request without the token, or a delivery whose
     `destination` is not `BOT_USER_ID`, is answered `200` and logged as rejected
     without touching the spreadsheet or the Messaging API

## Development

### Available Scripts

```bash
# Bundle TypeScript into dist/Code.js
npm run build

# Type-check without emitting
npm run typecheck

# Build, then push the bundle to Google Apps Script
npm run push

# Build, push and deploy a new version
npm run deploy

# Rebuild on change (run `npx clasp push --watch` alongside to auto-upload)
npm run watch
```

### Development Workflow

1. **Make local changes** to TypeScript files
2. **Verify locally**: `npm run typecheck && npm test`
3. **Push to Google Apps Script**: `npm run push`
4. **Test in LINE**: Send messages to your bot
5. **View logs**: Check Google Apps Script editor > Executions

### Testing

```bash
npm test          # vitest, no credentials or network needed
npm run typecheck # strict tsc over sources and tests
```

The suite in [tests/](tests) runs the **real build output**: `npm test` bundles the sources, then
evaluates `dist/Code.js` inside a `node:vm` context with `SpreadsheetApp`, `UrlFetchApp`,
`PropertiesService` and `Logger` stubbed ([tests/gasHarness.ts](tests/gasHarness.ts)). Entry points
are invoked by *global function name*, exactly as Apps Script resolves them, so the bundling step is
covered too — a build that Apps Script could not execute fails the suite.

What is asserted: the packaging contract (no `import`/`export`/`require` in the bundle, entry
points present as top-level functions, a build target of ES2019 with the bundle grepped for newer
syntax), the reply flow (exact match, case- and whitespace-insensitive English match, ingredient
recommendations, not-found fallback), the `USER_ACTION` append, malformed webhook payloads being
ignored without sending anything, and fail-loud behaviour when a script property is unset.

`debug.ts` provides `test_post()` and `test_send()` for manual checks from the Apps Script editor:
select the function and click **Run**. Both need the `DEBUG_USER_ID` script property and both hit
the live Messaging API, which is why they are not part of `npm test`. `test_send()` really does
push a message to you; `test_post()`'s reply fails with `Invalid reply token` — real tokens only
come from real deliveries — but it still writes a row to `USER_ACTION`.

### Local Development Tips

- **Before pushing**: `npm run typecheck && npm test` — the same commands CI runs
- **No formatter is configured**; match the surrounding style rather than reformatting a file
- **Watch mode**: `npm run watch` rebuilds on change; run `npx clasp push --watch` alongside it to
  upload automatically

## Project Structure

```
over-party-lab-chatbot/
│
├── 📄 Core Application Files
│   ├── main.ts                # Bundle entry point; exposes the Apps Script globals
│   ├── app.ts                 # Main webhook handler and message processing logic
│   ├── config.ts              # Non-secret configuration (committed)
│   ├── properties.ts          # Secret accessors backed by script properties
│   └── appsscript.json        # Google Apps Script manifest
│
├── 🔧 Service Layer
│   ├── lineService.ts         # LINE Messaging API client (reply / push)
│   ├── lineMessage.ts         # Message objects and the API's payload limits
│   ├── sheetService.ts        # Google Sheets reads and the analytics append
│   ├── logService.ts          # Execution logging
│   └── timeService.ts         # Timestamp formatting
│
├── 📝 Resources
│   ├── wording.ts             # User-facing strings
│   └── debug.ts               # Manual entry points for the Apps Script editor
│
├── 🧪 Tests
│   ├── tests/gasHarness.ts    # Runs dist/Code.js with the Apps Script APIs stubbed
│   ├── tests/bundle.test.ts   # End-to-end behaviour of the built bundle
│   ├── tests/lineMessage.test.ts   # Payload limits
│   ├── tests/buildConfig.test.ts   # Build contract and the clasp rootDir guard
│   └── tests/globalSetup.ts   # Builds the bundle before the suite runs
│
├── ⚙️ Configuration
│   ├── package.json           # Dependencies and scripts
│   ├── tsconfig.json          # Strict compiler options for the sources
│   ├── tsconfig.test.json     # Same, plus node types, for the tests
│   ├── vitest.config.mts      # Test runner configuration
│   ├── scripts/build.mjs      # esbuild bundler: sources -> dist/Code.js
│   ├── scripts/buildConfig.mjs   # Build contract: target, entry points, rootDir guard
│   ├── .github/workflows/ci.yml  # npm ci -> typecheck -> test -> build
│   └── .gitignore             # Git ignore rules
│
└── 📁 Other
    ├── CLAUDE.md              # Workflow and platform notes for coding agents
    ├── dist/                  # Build output uploaded by clasp (git-ignored)
    └── image/                 # Project assets (logo, screenshots)
```

### Key Files Explained

| File | Purpose |
|------|---------|
| `main.ts` | Bundle entry point; declares the Apps Script globals |
| `app.ts` | `doPost()`: authentication, event filtering, reply flow |
| `lineService.ts` | Messaging API calls, with `muteHttpExceptions` so errors are readable |
| `lineMessage.ts` | Builds text and buttons-template messages within the API's limits |
| `sheetService.ts` | One read per tab per execution; atomic analytics append |
| `properties.ts` | Script-property accessors that fail loudly when unset |
| `wording.ts` | Centralised user-facing strings |
| `debug.ts` | `test_post()` / `test_send()` for manual checks from the editor |

## How It Works

### Message Flow

```
1. User sends a message (e.g. "Margarita")
   ↓
2. LINE Platform POSTs the delivery to the webhook URL, secret included
   ↓
3. doPost(e) checks the token, then the delivery's `destination`
   ↓
4. For each event: keep text messages only, require a reply token, trim the text
   ↓
5. Look the text up in DRINK_LIST (name or nameen, case- and space-insensitive)
   ↓
6a. ✅ Row found                       6b. ❌ No row
    → echo, detail and link as text        → look the text up in ELEMENT_MAPPING
                                           → resolve its indices to cocktail names
                                           → up to 4 buttons, or the not-found reply
   ↓
7. Reply through the Reply API (free; the token is single-use)
   ↓
8. Append the search to USER_ACTION — after the reply, so it can never delay it
   ↓
9. Return 200 {"status":"ok"}, whatever happened
```

### Search Logic

The bot implements a two-tier search strategy:

1. **Exact Match Search** (Primary):
   - Searches both `name` (Chinese) and `nameen` (English) columns
   - Case-insensitive, whitespace-insensitive, and tolerant of numerically
     formatted cells
   - Returns the cocktail's description and recipe link

2. **Ingredient-Based Recommendations** (Fallback):
   - Looks the message up in `ELEMENT_MAPPING` (exact match, same rules)
   - The `recommendation` cell holds comma-separated 0-based indices into the
     `DRINK_LIST` name column; stale or non-numeric entries are dropped
   - At most **4** are offered, the LINE maximum for a buttons template
   - Falls back to the not-found reply when nothing can be offered

## API Reference

### Core Functions

#### `doPost(e: unknown): GoogleAppsScript.Content.TextOutput`
Webhook handler. Authenticates the request first — `e.parameter.token` against the
`WEBHOOK_TOKEN` property, then the body's `destination` against `BOT_USER_ID` — and only then
parses `e.postData.contents`, answers each text message event through the Reply API, and appends a
row to `USER_ACTION`.

Always returns `{"status":"ok"}` as JSON with HTTP 200, including for a rejected or unparseable
request: LINE redelivers on a non-2xx and may suspend a webhook that keeps failing. The single
exception is a missing script property, which surfaces as a failed execution so that a
misconfigured deployment cannot look healthy.

---

#### `lineService.reply(replyToken: string, messages: Message[]): SendResult`
Answers a webhook event. Reply messages are free of charge and work for group
and room events, where `source.userId` may be absent. Reply tokens are
single-use and expire about a minute after delivery.

#### `lineService.push(to: string, messages: Message[]): SendResult`
Sends an unsolicited message. Counts against the monthly quota, so it is only
used by `debug.ts`, which has no reply token.

```typescript
interface SendResult {
  ok: boolean;
  status: number;
  body: string;
}
```

---

#### `lineMessage.textMessages(...contents): Message[]`
Builds text messages, skipping blank content (LINE rejects `text: ''`).

#### `lineMessage.recommendationMessage(names, userMessage): Message | null`
Builds the buttons template, clamped to the Messaging API limits (4 actions,
40-character title, 20-character labels, 400-character `altText`). Returns
`null` when there is nothing to offer, because a zero-action template is
rejected with `400`.

---

#### `sheetService.findRow(from, where, select): SheetRow | null`
First row of `from` where any `where` column matches, limited to the `select`
columns. `null` when nothing matches.

#### `sheetService.columnValues(from, colName): string[]`
Every value of one column, excluding the header row.

#### `sheetService.save(params: SaveData): void`
Appends `[index, search, user, timestamp]` to `USER_ACTION`.

```typescript
type SheetRow = Partial<Record<ColumnKey, string>>;

interface SaveData {
  search: string;       // User's search query
  user: string;         // LINE User ID
}
```

## Configuration

### appsscript.json

Configuration for Google Apps Script deployment:

```json
{
  "timeZone": "Asia/Taipei",
  "runtimeVersion": "V8",
  "webapp": {
    "access": "ANYONE_ANONYMOUS",
    "executeAs": "USER_DEPLOYING"
  },
  "exceptionLogging": "STACKDRIVER"
}
```

**Key Settings**:
- `timeZone`: affects the `USER_ACTION` timestamps, which are formatted from the script's local time
- `runtimeVersion`: must stay `V8`. The bundle targets ES2019, which the legacy Rhino runtime cannot
  parse; [tests/bundle.test.ts](tests/bundle.test.ts) asserts this key on the built manifest
- `access`: must be `ANYONE_ANONYMOUS`, because LINE posts anonymously. Requests are authenticated
  by the `?token=` secret and the `destination` check instead
- `executeAs`: `USER_DEPLOYING`, so the script reaches the deployer's spreadsheet

## Troubleshooting

### Common Issues

#### Webhook Not Receiving Messages
- ✅ Verify webhook URL is correct in LINE Console
- ✅ Ensure web app is deployed (not just saved)
- ✅ Check `access` is set to `ANYONE_ANONYMOUS` in appsscript.json
- ✅ Test webhook using LINE Console's verification tool

#### `Missing script property "..."` Error
- ✅ Set all five properties — `LINE_CHANNEL_ACCESS_TOKEN`, `SPREADSHEET_ID`, `WEBHOOK_TOKEN`,
     `BOT_USER_ID` and `DEBUG_USER_ID` — in Apps Script → Project Settings → Script properties
     (see [Configure Environment](#3-configure-environment))
- ✅ Property names are case-sensitive

#### `SyntaxError: Cannot use import statement outside a module` in Apps Script
- ✅ You pushed the raw TypeScript sources. Run `npm run push` (which builds first) instead of `clasp push`
- ✅ Verify `.clasp.json` contains `"rootDir": "dist"`

#### Bot Not Responding (but LINE's **Verify** says success)
**Check the webhook token first.** A rejected request is answered `200`, exactly like a successful
one, so the console's Verify button reports success even when the token is missing or wrong — it
only reports the HTTP status. Send the bot a real message and look at the execution log:
- `[doPost] rejected: webhook token mismatch` → the registered webhook URL is missing `?token=`,
  or its value no longer matches the `WEBHOOK_TOKEN` property. Rotating the secret means updating
  both, together.
- `[doPost] rejected: destination is not this bot` → the `BOT_USER_ID` property is not this
  channel's **Your user ID**.
- No `[doPost]` line at all → the deployment is not receiving the webhook; re-check the URL.

#### Bot Not Responding (other causes)
- ✅ Check Google Apps Script execution logs for errors
- ✅ Verify LINE Channel Access Token is valid
- ✅ Confirm the `SPREADSHEET_ID` script property is correct
- ✅ Ensure sheet tab names match exactly (case-sensitive)

#### TypeScript Compilation Errors
```bash
# Check for errors before pushing
npm run typecheck

# Common fix: Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Debugging Tips

1. **View Execution Logs**:
   - Open Google Apps Script editor
   - Click **View** > **Executions**
   - Check recent execution logs for errors

2. **Run the debug entry points from the editor**:
   - `test_post()` drives the whole flow, including the real spreadsheet; its reply fails with
     `Invalid reply token`, so check the log for the payload it built
   - `test_send()` pushes a real message to `DEBUG_USER_ID`

3. **Enable Verbose Logging**:
   - Add `console.log()` statements in your code
   - View output in Apps Script Executions panel

## Contributing

Contributions are welcome! Here's how you can help:

### How to Contribute

1. **Fork the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/over-party-lab-chatbot.git
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```

3. **Make your changes**
   - Follow existing code style
   - Add comments for complex logic
   - Update documentation if needed

4. **Verify your changes**
   ```bash
   npm run typecheck && npm test
   ```
   Both must pass, and CI runs them on every pull request. `debug.ts` is for manual checks against
   the live channel, not a substitute.

5. **Commit with clear messages**
   ```bash
   git commit -m "feat: add amazing feature"
   ```
   Follow [Conventional Commits](https://www.conventionalcommits.org/)

6. **Push and create Pull Request**
   ```bash
   git push origin feature/amazing-feature
   ```

### Contribution Guidelines

- Write clean, readable code
- Maintain type safety: no `any`, no unchecked casts for reading external input
- Add JSDoc comments for public functions, and say *why* rather than *what*
- Keep dependencies minimal
- Every behavioural change needs a test that fails before it and passes after it
- Respect the platform constraints in [CLAUDE.md](CLAUDE.md) — several are not obvious and have
  each caused a real bug here

### Areas for Contribution

- 🌐 More language support
- 🎨 Better message templates and UI, e.g. quick replies instead of a 4-button template
- 📊 Richer analytics
- 🔁 Redelivery de-duplication ([#31](https://github.com/sean1093/over-party-lab-chatbot/issues/31))
- 📝 Documentation
- 🐛 Bug fixes and performance improvements

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## FAQ

### Can I use this for other types of data besides cocktails?

Yes! The architecture is generic. Simply modify:
- Google Sheets structure for your data
- Search logic in [app.ts](app.ts)
- Message templates in [wording.ts](wording.ts)

### How much does it cost to run?

Nothing, for a small bot. Google Apps Script's free quotas cover it, and — because the bot answers
with the **Reply API** — replies do not count against the LINE Official Account's monthly message
allowance. Only `test_send()` in [debug.ts](debug.ts) sends a push message, which does count.

### Can I add image/video responses?

Yes. Add the message object to [lineMessage.ts](lineMessage.ts), with its limits, and return it
from `buildReply`. See [LINE Message Types](https://developers.line.biz/en/docs/messaging-api/message-types/).

### How do I scale for more users?

Per webhook delivery the cost is one Sheets read **per tab**, however many events the delivery
carries, because each tab is read once per execution and cached in memory. The reply and the
`USER_ACTION` append are **per text-message event**. Before reaching for a rewrite, check the real
limits:

- LINE records a `request_timeout` error if the bot server does not respond within **2 seconds**,
  so the response budget is the first thing to run out.
- Apps Script allows 6 minutes per execution and a limited number of simultaneous executions.
- Sheets and UrlFetch have daily quotas.

If a bigger sheet or heavier traffic does become the bottleneck, cache the tabs across executions
with `CacheService`, or move the data to a real database.

### Can I deploy multiple bots from this code?

Yes. Use a separate Apps Script deployment per bot, each with its own script properties (channel
token, spreadsheet, `WEBHOOK_TOKEN`, `BOT_USER_ID`) and its own LINE channel. Do not share a
`WEBHOOK_TOKEN` between deployments.

## Resources

### Tutorials
- 📝 [How to create a LINE chatbot using Google Apps Script](https://medium.com/@sean1093/%E5%85%A9%E5%B0%8F%E6%99%82%E6%89%93%E9%80%A0%E7%B0%A1%E5%96%AE-line-chatbot-%E4%BD%BF%E7%94%A8-google-apps-script-google-sheet-api-8fff7372ff3d) (Chinese)
- 📝 [Using clasp and TypeScript to develop Google Apps Script](https://medium.com/@sean1093/%E4%BD%BF%E7%94%A8-clasp-%E8%BC%95%E9%AC%86%E4%BD%BF%E7%94%A8-typescript-%E9%96%8B%E7%99%BC-google-apps-script-b93b60e93292) (Chinese)

### Official Documentation
- 📚 [LINE Messaging API Documentation](https://developers.line.biz/en/docs/messaging-api/)
- 📚 [Google Apps Script Documentation](https://developers.google.com/apps-script)
- 📚 [clasp - Command Line Apps Script Projects](https://github.com/google/clasp)
- 📚 [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Related Projects
- [LINE Bot SDK](https://github.com/line/line-bot-sdk-nodejs) - Node.js SDK for LINE
- [Google Apps Script Samples](https://developers.google.com/apps-script/samples)

## Author

**Sean Chou**
- GitHub: [@sean1093](https://github.com/sean1093)
- Medium: [@sean1093](https://medium.com/@sean1093)

## Acknowledgments

- 🍸 [Over Party Lab](https://www.instagram.com/over.party.lab/) - Cocktail community and inspiration
- 💚 LINE Corporation - LINE Messaging API
- ☁️ Google - Apps Script platform and infrastructure
- 💙 TypeScript Team - Type-safe development tools
- 🙏 All contributors and users of this project

---

<div align="center">

**[⬆ Back to Top](#over-party-lab-chatbot)**

Made with ❤️ for cocktail enthusiasts

</div>

