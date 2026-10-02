# Provenance and verification boundaries

## Prior work versus this build

Earlier RecallReady CALL-E work supplied the problem framing and lessons about fail-closed boundaries and explicit approval. This package contains a separately tested local MCP implementation, not the CALL-E SDK or a phone provider integration. It includes no private checkpoint, credential, customer data, or public hosted endpoint. Test counts for earlier projects are not tests of this repository.

New implementation in this directory: official-SDK Streamable HTTP tools/resources, revisioned persistent synthetic cases, an immutable source/remedy snapshot, observation/source separation, evidence-change blocking, idempotent case creation, network guards, actual client/process-restart tests, and an optional fixed-record public-source check that cannot update case/catalog evidence.

The interactive terminal walkthrough is an official MCP SDK client of the real local server process. It accepts only bounded menu and enum values, persists a separate local UUID pointer, and does not simulate Alexa, voice recognition, an LLM, or any real user action. Its process tests launch a second walkthrough process to resume saved state, verify live lock ownership and stale-lock refusal, and exercise path, input-size and orderly quit boundaries without marking progress. State-directory junction refusal is tested; pointer/case-file symlink checks are conditionally skipped on Windows hosts where unprivileged file-symlink creation is denied. A forced termination outside Node's orderly signal handler retains its lock rather than claiming cleanup succeeded.

Codex assisted with implementation, test design, and documentation. No human-only authorship, real customer use, interview, personal anecdote, actual Alexa approval, payment or contest success is claimed. Bradley remains responsible for any eventual eligibility, provenance and submission declarations.

## Dependencies

- `@modelcontextprotocol/sdk` 1.31.0: official TypeScript MCP SDK, MIT license. Its installed protocol constants include 2025-11-25; an independent HTTP initialize check verifies actual negotiation. The code follows the SDK's stateless Streamable HTTP integration pattern, not a copied example application.
- `zod` 4.6.5: MIT licensed schema validation.
- Full transitive versions and integrity hashes are in `package-lock.json`. Installation used `--ignore-scripts --no-audit --no-fund`; `.npmrc` disables lifecycle scripts by default.

Primary technical references checked October 2, 2026:

- [Official SDK v1 source](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x).
- [SDK stateless HTTP example](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStatelessStreamableHttp.ts).
- [MCP 2025-11-25 HTTP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
- [Official CPSC API information](https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information), for the public REST JSON endpoint. No additional library was installed for this check.

## Data

- `DEMO-KETTLE-01`, K100/K200 and A1/B9 are deliberately fictional fixtures.
- `CPSC-23-145` is a compact attributed paraphrase of an official public CPSC recall page, reviewed from web-retrieved text on October 2, 2026 at the timestamp in `src/catalog.mjs`. Retrieval may be cached; no claim of a live HTTP fetch, manufacturer availability or personal eligibility follows.
- The source's remedy section says it was updated July 22, 2026. The bounded snapshot preserves replacement or YETI gift-card refund, not verified cash. It includes no photos, raw page copy, logos, contact phone/email or personal data.
- Product observations in tests and demos are synthetic role-play inputs, not Bradley's belongings. No household inventory is read.
- Default runtime, demo and tests are offline except local loopback; tests inject synthetic public-source responses. The optional `check_public_source` tool requires `RECALLREADY_PUBLIC_SOURCE_CHECK=1`. The dedicated `npm run source-check` command is itself explicit opt-in to one fixed public CPSC GET. It sends no user facts, credentials or identifiers, does not follow redirects, and saves no response to local case/catalog storage. The public API sees ordinary network connection metadata. Npm installation obtains open-source dependencies; research accessed public primary sources. No external LLM, paid API or cloud service is used.
- The optional receipt includes only recall identity, source/title, detailed remedy, broad remedy categories, fetch timestamp and upstream date plus explicit limitations. API `Refund` categories are not evidence of cash. Only a successful new fetch with exact identity is reported as fetched/identity-checked; failure never reuses an earlier result. Neither result changes the existing dated snapshot.
- A separately invoked live `source-check` returned an identity-checked receipt at `2026-10-02T04:50:18.803Z`. The API publication value was `2023-03-09T00:00:00`, with no explicit time zone. The detailed remedy described a gift-card refund or replacement despite its coarse `Refund`/`Replace` categories. The complete response was not saved to case/catalog state. All 18 tests and the strictly offline demo passed after this addition. The dependency lockfile was unchanged.

No output from this project authorizes or performs a real claim, recall contact, product disposal, purchase, appointment, or financial transaction.
