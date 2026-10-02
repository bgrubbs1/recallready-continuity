# Evidence demo

[Watch or download the 105-second MP4](demo.mp4). GitHub may show a download link rather than an inline player.

This is an edited presentation of output from an actual successful `node scripts/demo.mjs` run, recorded at `2026-10-02T06:09:08.902Z`. It is not a real-time screen recording, Alexa interaction, voice demo, or account of a real person's recall claim. There is no narration, music, stock footage, or invented testimonial. Codex assisted with the implementation, editing, and captions.

The run's complete structured output is in [recorded-mcp-run.json](recorded-mcp-run.json). The [video manifest](video-manifest.json) records its duration, SHA-256, scene lengths, and source-command exit status. Process IDs, case IDs, and timestamps in that output are generated local demonstration values, not participant identifiers. All product observations are synthetic; the attributed CPSC source record is public.

| Video time | What the actual run demonstrates |
| --- | --- |
| 00:00–00:12 | The problem: preserve the missing fact and next step when a conversation ends. Scope disclosures are visible. |
| 00:12–00:20 | Official MCP SDK client and local Streamable HTTP server negotiate protocol `2025-11-25`. |
| 00:20–00:35 | The case asks for a missing model rather than inventing one. |
| 00:35–00:55 | Explicit synthetic observations are saved at revision 2; another server process resumes the same case. |
| 00:55–01:15 | Source facts, observations, and benefit types remain separate. A listed remedy is not verified cash. |
| 01:15–01:30 | A fabricated payment-completion request is rejected without changing the case revision. |
| 01:30–01:45 | Local preparation ends at a human handoff; no external claim, contact, or payment occurs. |

Reproduce with `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check`, and `npm run demo` on Node 22 or later. The recorded run used Node 24.19.0 on Windows. Your generated IDs, process IDs, and timestamps will differ. The demo explicitly disables the optional public-source network check and removes its own temporary state when finished.

The interactive terminal client is separate: `npm run walkthrough`. It uses the same real local server and bounded synthetic inputs, but this video does not demonstrate that terminal client.

## What this does not prove

No actual Alexa integration, public hosted endpoint, production security, real user validation, current manufacturer eligibility, money received, or contest result is demonstrated. The two-record catalog and synthetic case are a bounded prototype. The local-step marks in the scripted demo are API exercises, not evidence of human reading or consent.

This GitHub-hosted video is an evidence artifact. It does not by itself meet an organizer requirement for a public YouTube or Vimeo URL, and this repository does not represent a completed contest submission.
