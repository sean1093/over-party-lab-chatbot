# CLAUDE.md

Guidance for Claude Code, and any other coding agent, working in this repository.

## 1. What this project is

A LINE chatbot for cocktail discovery, running on **Google Apps Script** with its data in
**Google Sheets**. TypeScript sources are bundled locally and uploaded with `clasp`.

| Concern | File |
|---|---|
| Bundle entry point; declares the three Apps Script globals plus the documented test seam | `main.ts` |
| Webhook authentication, event filtering, reply flow | `app.ts` |
| LINE Messaging API client | `lineService.ts` |
| Message objects and the API's payload limits | `lineMessage.ts` |
| Remembering handled events, so a duplicate delivery is answered once | `eventDedupe.ts` |
| Google Sheets access | `sheetService.ts` |
| Logging | `logService.ts` |
| Timestamp helper | `timeService.ts` |
| User-facing strings | `wording.ts` |
| Non-secret configuration | `config.ts` |
| Secrets, read from script properties | `properties.ts` |
| Manual entry points for the Apps Script editor | `debug.ts` |
| Bundler and its contract | `scripts/build.mjs`, `scripts/buildConfig.mjs` |
| Apps Script manifest: V8 runtime, web-app access, time zone | `appsscript.json` |
| Test harness over the built bundle | `tests/gasHarness.ts` |
| Builds the bundle before the suite runs | `tests/globalSetup.ts` |
| CI: `npm ci` → typecheck → test → build | `.github/workflows/ci.yml` |

### Runtime constraints that are easy to get wrong

- The target is the **Apps Script V8 runtime**, not Node: no ES modules, no `require`, no npm
  packages at runtime, and one global scope. Everything is bundled into `dist/Code.js` by
  `npm run build`.
- The **script runtime is 6 minutes per execution** — the widely quoted 30 seconds is the limit for
  simple triggers and custom functions, and the docs state it explicitly does *not* apply to
  `doGet`/`doPost`. The deadline that actually binds is LINE's: it records a `request_timeout`
  webhook error when the bot server does not respond within **2 seconds**. That is why the reply is
  sent before the analytics write, and why the write's lock wait is short.
- Apps Script resolves entry points **by global function name**. `doPost`, `test_post` and
  `test_send` are emitted as real top-level declarations by the build footer. A new entry point must
  be exported from `main.ts` *and* listed in `ENTRY_POINTS` in `scripts/buildConfig.mjs`.
- Each execution is a **fresh runtime**, which is why the row cache in `sheetService.ts` is a plain
  object: it cannot outlive one request.
- Secrets are never committed and never read at module load. They live in script properties and are
  reached through the accessors in `properties.ts`, which throw `ConfigurationError` when unset.
  Services that swallow errors **must rethrow that one**, or a misconfigured deployment answers
  "not found" to every user while looking healthy.
- **Apps Script web apps cannot read request headers**, so LINE's `x-line-signature` cannot be
  verified. Authenticity comes from the `?token=` shared secret, checked *before the body is even
  parsed*, and from the `destination` check immediately after parsing. Both precede any sheet
  access, any LINE call and any event handling.
- `UrlFetchApp.fetch` throws on a failure status (4xx/5xx) unless `muteHttpExceptions: true` is set.
- LINE reply tokens are single-use and expire about a minute after the webhook, so the reply must go
  out in the same execution — and before slower work such as the analytics write.
- The Messaging API counts `text` and `altText` in **UTF-16 code units** and `title`, template
  `text`, action `label` and action `text` in **grapheme clusters**. `lineMessage.ts` has one clamp
  per unit; using the wrong one produces a payload the API rejects, and the user gets nothing.
- The same webhook event can arrive **more than once** — LINE names network routing as a cause, so
  this is not limited to the redelivery feature — and `webhookEventId` is how to detect it.
  `eventDedupe.ts` records an id only *after* the event is handled, because a delivery that failed
  part-way through is exactly what a redelivery exists to retry.
- `CacheService` holds at most 1,000 items and may evict earlier, so anything built on it is best
  effort by construction. Say so where it matters instead of implying exactly-once.
- `Sheet.getLastRow()` returns the position of the last row **with content**, and `appendRow`
  interprets a leading `=` as a formula. Both have bitten this codebase.
- `console.log` only. On V8 the legacy `Logger.log` reaches the same execution log, so writing to
  both duplicates every line.
- Script properties are read once per execution with a single `getProperties()`. `doPost` reads the
  webhook token on every request, including unauthenticated ones, so keeping the per-request cost at
  a single Properties call is deliberate.

## 2. Commands

```bash
npm install         # dependencies (clasp, esbuild, typescript, vitest)
npm run build       # bundle main.ts -> dist/Code.js (+ appsscript.json)
npm run typecheck   # tsc --noEmit over sources and tests; must be clean
npm test            # vitest run; builds first, must be green
npm run push        # build, then clasp push
npm run deploy      # build, push, then clasp deploy
```

`npm run typecheck && npm test` is the minimum bar for any change. A clean clone must pass both with
no credentials configured — never introduce an import of a git-ignored file.

## 3. Testing rules

- Tests live in `tests/` and run under **vitest** in plain Node. They must not need network access,
  credentials, or a real spreadsheet.
- The suite has two layers, and both matter:
  - **End-to-end over the real build output.** `tests/bundle.test.ts` drives `tests/gasHarness.ts`,
    which evaluates `dist/Code.js` in a `node:vm` context with the Apps Script globals stubbed and
    invokes entry points by *global function name*, exactly as Apps Script resolves them. Anything
    touching `doPost`, a service, or the packaging belongs here — it is what catches regressions a
    re-imported module would hide.
  - **Direct unit tests for modules with no Apps Script dependency**: `lineMessage.ts` (payload
    limits) and `scripts/buildConfig.mjs` (the build contract). These import the source directly,
    which is why those modules were written free of platform globals.
- **Stubs must be at least as strict as the real API.** A forgiving stub converts a test into false
  confidence. Precedents worth remembering: `UrlFetchApp.fetch` must throw on a failure status
  unless `muteHttpExceptions` is set; `getRange` must throw when the range leaves the grid;
  `getLastRow` must report the last row *with content*, not the row count.
- **Assert observable outcomes, and assert them whole.** `toEqual` on a recorded payload or sheet
  write beats a `toContain` on one field: a spot check let a mutation that overwrote every previous
  analytics row pass. The harness records reads, writes, sends, lock events and their **order**
  precisely so that ordering and cost are assertions rather than comments.
- Every behavioural change needs a test that fails before it and passes after it. Say so in the
  pull request.
- Never weaken or delete an assertion to make a change pass. If an assertion encoded behaviour that
  is intentionally changing, say so in the pull request and explain why the new behaviour is right.
- When a fix is deferred to another issue, pin the **current** behaviour with a comment naming that
  issue, so the follow-up has to update the assertion deliberately.

## 4. Pull request workflow

Work is delivered as pull requests, one coherent concern each. An agent runs the whole loop: create,
get it reviewed, fix, comment, merge.

### 4.1 Before writing code

1. Find or open the issue the change belongs to. If a change spans several, either split it or state
   in the pull request why they are inseparable.
2. Sync: `git checkout master && git pull --ff-only`.
3. Branch with a conventional prefix: `feat/`, `fix/`, `perf/`, `refactor/`, `build/`, `test/`,
   `docs/`.

### 4.2 Create the pull request

1. Implement the change. Migrate every caller; leave no aliases, shims or dead paths.
2. Run the bar: `npm run typecheck && npm test`.
3. Commit with a [Conventional Commits](https://www.conventionalcommits.org/) subject, a body
   explaining *why*, and an issue reference (`Fixes #12`, `Refs #13`).
4. Push and open the pull request. Its description must contain:
   - **Problem** — the observable defect, with evidence: a log line, an API error, `file:line`, or a
     measurement.
   - **Change** — what was done, and which alternatives were rejected and why.
   - **Verification** — the exact commands and their output, including the new test names.
   - **Migration** — every manual step a deployer must take (script properties, `.clasp.json`, the
     LINE console). Omit the section only when there genuinely is none.

Write long descriptions and comments to a file and pass `--body-file`. Inlining them in a shell
heredoc mangles backticks and `$`: it silently mangled a review comment here into nonsense, which
then had to be deleted and reposted.

### 4.3 Get it reviewed by other agents

Never self-approve without an independent pass. Dispatch **at least two** agents in parallel against
the pushed branch:

- A **code reviewer** (`reviewer`): correctness, runtime constraints, API contracts, error handling,
  types, dead code.
- An **independent verifier or adversary** (`task`): builds its **own** harness — never the author's
  — and either diffs old versus new behaviour on identical inputs (for refactors) or hunts for
  inputs that break the change (for new behaviour). It should also **mutation-test**: apply a
  targeted mutation, run the suite, and report anything that stays green. A surviving mutation is a
  missing test, and this has repeatedly been the highest-value finding.
- A **security reviewer** (`security-reviewer`) whenever the change touches the webhook entry point,
  secrets, script properties, or anything written to a sheet.

Give each agent the branch name, the files in scope, the invariants that must not change, the issues
explicitly out of scope, and the demand for `severity + file:line + suggested fix`. Reviewers are
read-only: they may run `build`, `typecheck` and `test`, but must not edit, commit, push, or switch
branches. An agent that must mutate a file has to restore it and prove the tree is clean, or work in
a copy under `/tmp`.

Require **primary sources** for any claim about platform behaviour, and verify load-bearing ones
yourself. In this repository a reviewer's confident P1 about `getDataRange()` was wrong and retracted
after reading the reference, while its claim about `appendRow` treating `=` as a formula was right
and documented. Weigh the evidence, not the confidence.

Do not edit the working tree while a review agent is reading it. If you must, tell the agent what
changed and ask it to re-run — a stale comparison is worse than no comparison.

### 4.4 Fix and comment

1. Triage every finding as **blocker**, **should-fix**, **nit**, or **rejected**.
2. Fix all blockers and should-fixes. Reject a finding only with a stated technical reason.
3. Re-run `npm run typecheck && npm test`, and **re-run the mutations** to prove the new tests bite.
4. Push the fixes as separate commits so the review trail stays readable.
5. Post a comment recording the loop: which agents reviewed, every finding, the disposition of each
   (fixed in `<sha>`, rejected because …, retracted by its author), and the verification output
   after the fixes. This comment is the audit trail — it is not optional.

### 4.5 Merge

Merge only when all of the following hold:

- `npm run typecheck` and `npm test` pass on the final commit.
- Every blocker and should-fix is resolved or explicitly rejected with a reason.
- No behaviour regression: for refactors, an old-versus-new comparison on identical inputs is in the
  pull request; for behavioural changes, a test pins the new contract.
- The review comment from 4.4 is posted.
- The Migration section matches what was actually implemented.

Then squash-merge and delete the branch:

```bash
gh pr merge <n> --squash --delete-branch
git checkout master && git pull --ff-only
```

`Fixes #<n>` in the description closes the issue on merge — but **a closing keyword binds to one
issue only**: `Fixes #12, #15` closes #12 and leaves #15 open. Repeat the keyword for each one
(`Fixes #12, fixes #15`) and check the issue list after merging. If a pull request only partly
addresses an issue, comment on it with what is left instead of closing it.

If a review surfaces a real problem that is out of scope, **open an issue for it** rather than
widening the pull request or losing the finding.

### 4.6 Stacked pull requests

Dependent pull requests merge in order, and each is rebased on the updated `master` before its review
agents are dispatched — reviewers must never see a stale base. State the dependency in the
description (`Depends on #27`).

## 5. Hard rules

- Never break existing behaviour to make a change easier. If behaviour must change, that is the point
  of the pull request, it is tested, and it is stated in the description.
- Never commit secrets, and never make source import a git-ignored file.
- Never merge with a failing or skipped check, and never merge without an independent review pass.
- Never push directly to `master`.
- Never leave `TODO`, placeholder, or stub implementations in merged code.
- Correct the record when you are wrong: if an issue or a description says something that turns out
  to be false, comment on it with the evidence rather than quietly moving on.
- Everything written to the repository — code, comments, commit messages, pull request titles and
  descriptions, review comments, issues — is in **English**.
