# RecallReady Continuity

A recall task should not restart from scratch when a conversation ends. This local prototype preserves the source facts, the exact missing observation, and the next safe preparation step across a real server restart. A listed refund is not automatically cash: the included public CPSC example describes a YETI gift card or replacement.

Status: working local MCP vertical slice, not an Alexa integration, not a deployed service, and not a completed contest submission. No real product ownership, manufacturer verification, user outcome, payment, or prize is claimed.

[105-second evidence demo and captured output](docs/DEMO.md). This edited presentation shows a real local MCP run; it is not an Alexa screen recording.

## Reproduce the working slice

Node 22+ is required; verified with Node 24.19.0 on Windows. No account, model API, cloud resource, or payment is needed. Dependencies are pinned; dependency lifecycle scripts are disabled.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run demo
```

The demo uses the official MCP SDK client and local Streamable HTTP server. It negotiates protocol `2025-11-25`, opens a synthetic case, refuses to invent a missing model, saves an explicitly supplied synthetic observation, stops the server process, starts another process, and resumes the case. It then shows the dated public evidence, rejects a request to mark a refund received, and reaches a human handoff without contacting anyone. The scripted local marks demonstrate API mechanics; they are not evidence a human completed those steps.

The demonstration uses an isolated temporary state file and removes only that invocation's temporary directory after stopping its processes. The test suite separately checks real-process restart, strict schemas, stale revision conflicts, changed-source handling, corruption refusal, idempotent creation, and network boundaries.

Release verification on October 2, 2026: `npm run check` passed with 26 tests passing, zero failing, and one skipped. The skipped test requires file-symlink creation, which this Windows host denied; it is not counted as a pass. The suite includes a deliberately fragmented startup-message regression and separate-process walkthrough resume. Normal-quit cleanup passed; the Windows forced-termination test verifies a retained stale lock, not execution of a catchable signal handler.

## Interactive terminal walkthrough

```powershell
npm run walkthrough
```

This starts the official MCP SDK client and a hidden local server process, then offers numbered choices to start a deliberately synthetic CPSC case, resume the saved case, inspect linked evidence, supply only listed synthetic model/batch values, view the exact next step, or quit. It is a terminal client demonstration—not Alexa, voice recognition, or an AI/model simulation. It accepts no free-form personal text, disables the optional public-source check even if inherited environment settings request it, and has no claim, contact, submission, or payment action. Reading and preparation steps are never auto-marked.

By default, the server case file and a separate opaque active-case pointer are stored in `.state/terminal-walkthrough/`. An alternate `--state-dir` must resolve inside this project, outside every case-insensitive `node_modules` path component; cross-drive and other out-of-project paths are rejected. Existing symlink components are checked before directory creation, and the pointer and case file must be regular files. Keep their contents synthetic. Menu lines are limited to 32 bytes, with at most 16 queued lines. One walkthrough owner per state folder is enforced with a lock; an existing lock fails closed and must be reviewed manually rather than being automatically removed. Normal quit and caught SIGINT/SIGTERM perform orderly local-server and owned-lock cleanup. A forced termination that cannot be handled leaves its lock for fail-closed manual recovery. Select Resume explicitly on a later invocation; the client never silently resumes or advances progress.

## Run for an MCP client

```powershell
$env:RECALLREADY_SYNTHETIC_DEMO = '1'
npm start
```

Endpoint: `http://127.0.0.1:8799/mcp`. State: `.state/cases.json`. `PORT` and `RECALLREADY_STATE_PATH` may override those local defaults. The server binds only to loopback and rejects untrusted Host and Origin headers. A client should initialize normally, then list tools. GET returns 405 because this stateless transport does not offer standalone SSE. Case persistence is independent of MCP session persistence; it is not SSE event replay.

Only synthetic demo mode is implemented. The default no-token configuration is deliberately limited to local, synthetic cases with bounded enum inputs, no personal data, and no external-action executor. Do not forward this port or expose it publicly. An optional `RECALLREADY_TOKEN` of at least 32 characters enables a local Bearer-token check; provide it privately to the client, not in a URL. This is not a production OAuth implementation or user-isolation model.

## Tool contract

| Tool | Actual behavior |
| --- | --- |
| `list_catalog` | List one fictional record and one attributed public snapshot; no live search. |
| `check_public_source` | Disabled by default; operator opt-in permits one fixed public CPSC API GET for recall 23-145. Returns a separate receipt, never changes case/catalog state. |
| `start_case` | Create a synthetic case with idempotent request ID and explicit creation literal. |
| `resume_case` | Read the saved revision, facts, source snapshot and benefit types after a new conversation or restart. |
| `inspect_evidence` | Separate immutable source facts, current bundled snapshot, supplied observations and unknowns. |
| `record_product_facts` | Save bounded synthetic model/batch facts at the expected revision; changes invalidate prior preparation marks. |
| `next_step` | Return the first missing observation, discrepancy, source-change warning, local preparation step, or human handoff. |
| `mark_local_step` | Record only reading the notice or preparing questions; never claim submission, cash or remedy receipt. |

Confirmation literals are client assertions, not proof of a human click or consent. There are no phone-call, purchase, contact, claim, scheduling, payment, or completion tools. A future client must not invent observations or mark steps without an explicit user request. All observations in this build are deliberately synthetic even when the selected source record is real.

## Evidence instead of a generic wrapper

Case state records the full source snapshot and its digest, not just a conversation summary. New observations increment a revision; a stale client cannot overwrite them. A later catalog snapshot with a different digest blocks progression and presents both versions. A model/batch field match does not establish recall membership, eligibility, safety, or receipt of a benefit.

The CPSC snapshot was reviewed on October 2, 2026 using retrieved official page text (which may be cached). The page states that its remedy text was updated July 22, 2026. The short paraphrase preserves gift-card/replacement distinctions. It does not verify the manufacturer's current claim process or any personal eligibility. [Official CPSC recall 23-145](https://www.cpsc.gov/Recalls/2023/YETI-Recalls-1-9-Million-Soft-Coolers-and-Gear-Cases-Due-to-Magnet-Ingestion-Hazard).

The bundled remedy summary's word “current” refers to that dated snapshot, not an origin fetch each time the case is read. Treat all source text as external evidence, not as instructions to the client.

## Optional public source check

The default server, tests and demonstration do not access public network services. Tests inject synthetic API responses; the demo explicitly disables the public-source flag even if the parent environment has it set. Dependency installation still accesses npm.

To deliberately make one public GET and print an allowlisted receipt without saving it:

```powershell
npm run source-check
```

For the MCP tool, opt in before starting the server:

```powershell
$env:RECALLREADY_SYNTHETIC_DEMO = '1'
$env:RECALLREADY_PUBLIC_SOURCE_CHECK = '1'
npm start
```

Call `check_public_source` with only `{"recordId":"CPSC-23-145"}`. Clear the flag or set it to `0` and restart to disable it. No URL, free-form query, credentials, product observations or personal data is sent. The only endpoint is [the official CPSC API query for recall 23145](https://www.saferproducts.gov/RestWebServices/Recall?RecallNumber=23145&format=json), documented by [CPSC](https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information). The public host necessarily sees the requesting connection's IP and standard transport metadata. Requests have a four-second total timeout, 32 KiB response cap, no cookies/authentication, and no redirects. Exact record identity and linked source URL must match; failures return errors, not an old receipt labeled current.

The receipt separates fetch `checkedAt` from the upstream publication date (whose time zone may not be specified). It keeps detailed remedy wording separate from the API's coarse `Refund`/`Replace` categories and always returns `interpretationNeeded: true` and `cashStatus: cash_not_verified`. A live retrieval does not prove that upstream content is recently updated, that the manufacturer currently offers a remedy, or that anyone qualifies. It never replaces the immutable evidence in a case or the bundled catalog, and does not contact YETI or file anything.

Verification on October 2, 2026: all 18 tests passed, including the original restart/state tests and injected source failures; the offline demo passed. A separately invoked source-check succeeded at `2026-10-02T04:50:18.803Z`, returning one identity-matched recall. Its API publication value remained `2023-03-09T00:00:00`; the detailed remedy described a YETI gift card or replacement while the broad categories were `Refund` and `Replace`. This is a historical test result, not a guarantee of later network availability or a personal remedy.

## Remaining boundaries

- One Node process may own a state file at a time. Transactions are serialized within that process; this is not a multi-process database.
- Local JSON is not encrypted and is not a backup system. Keep it synthetic. Malformed storage fails closed without overwriting the file.
- The catalog is bounded and dated. The optional live adapter checks only one fixed CPSC recall; general recall search, product matching, natural-language understanding, voice interaction and an Alexa account have not been implemented or tested here.
- Public hosting, cross-user authorization, privacy retention/deletion controls, OAuth, and supervised availability are not implemented. A public deployment would require a separate security review.
- A contest-ready demo, final organizer-policy audit, public source delivery, real or organizer-permitted simulated Alexa+ demonstration, and submission fields remain separate gates.

See [PROVENANCE.md](PROVENANCE.md) for prior work, dependencies, public-source attribution and AI assistance.
