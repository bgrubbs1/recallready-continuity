import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CaseStore, CaseService } from './cases.mjs';
import { BATCH_VALUES, MODEL_VALUES, RECORD_IDS, getRecord, listCatalog } from './catalog.mjs';
import { checkPublicSource } from './public-source.mjs';

function result(value) { return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }; }
const caseId = z.string().uuid().describe('Opaque case ID returned by start_case; not a person or household identifier.');
const revision = z.number().int().positive().describe('Exact revision from the most recent resume_case result.');
const facts = { model: z.enum(MODEL_VALUES), batch: z.enum(BATCH_VALUES) };

export function createMcpServer(service, { publicSourceEnabled = false, publicSourceFetch = fetch } = {}) {
  const mcp = new McpServer({ name: 'recallready-continuity', version: '0.1.0' }, {
    instructions: 'Synthetic-only case-continuity demonstration, not a live Alexa connection. Preserve source provenance and uncertainty. Never infer ownership, eligibility, remedy receipt or cash. Local marking tokens record client-supplied requests; they do not authenticate human consent. No tool contacts a manufacturer or submits a claim. An operator-enabled public source check can read one fixed CPSC API record without altering any case or catalog. Start with list_catalog, use only deliberately synthetic observations, resume before mutations, and show the linked evidence before a next step.',
  });
  const tool = (name, description, schema, readOnly, callback, openWorld = false) => {
    mcp.registerTool(name, {
      description, inputSchema: z.object(schema).strict(),
      annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: openWorld },
    }, async input => {
      try { return result(await callback(input)); }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    });
  };
  tool('list_catalog', 'List the bounded synthetic fixture and dated public CPSC snapshot. This is not a search of household inventory or a live recall search.', {}, true, async () => ({ syntheticDemo: true, records: listCatalog() }));
  tool('check_public_source', 'Optional read-only check of exactly CPSC recall 23-145 via one fixed official API URL. Disabled unless the operator explicitly enables public network access. Does not accept URLs or personal data, update any case/catalog, establish eligibility, or equate the coarse Refund category with cash.', {
    recordId: z.literal('CPSC-23-145'),
  }, true, input => checkPublicSource({ enabled: publicSourceEnabled, recordId: input.recordId, fetchImpl: publicSourceFetch }), true);
  tool('start_case', 'Create a local synthetic case only when requested. Observations are unverified synthetic input, not ownership or manufacturer eligibility. Reusing requestId with the same creation facts is idempotent.', {
    recordId: z.enum(RECORD_IDS), ...facts, requestId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/), confirmation: z.literal('CREATE SYNTHETIC CASE'),
  }, false, input => service.start(input));
  tool('resume_case', 'Resume a persisted synthetic case in a new client or after server restart. Does not change its progress, infer facts, or mark anything done.', { caseId }, true, input => service.resume(input.caseId));
  tool('inspect_evidence', 'Separate source-linked catalog facts from explicitly supplied synthetic observations and unknown eligibility. Never conflate a listed remedy with cash received.', { caseId }, true, input => service.evidence(input.caseId));
  tool('record_product_facts', 'Save only the selected synthetic model and batch that the client explicitly supplies. Never infer missing fields. Changed facts invalidate local preparation marks; expectedRevision prevents stale overwrites.', {
    caseId, expectedRevision: revision, ...facts, confirmation: z.literal('SAVE SYNTHETIC FACTS'),
  }, false, input => service.recordFacts(input));
  tool('next_step', 'Return the next evidence-dependent local step or human handoff. Missing observations and field differences are preserved. Does not determine actual recall eligibility, item safety, payment, or remedy receipt.', { caseId }, true, input => service.plan(input.caseId));
  tool('mark_local_step', 'Record only an explicitly requested synthetic local preparation step. A literal confirmation is a client assertion, not proof of a human action. Cannot mark a claim submitted, contact made, refund paid, or remedy received.', {
    caseId, expectedRevision: revision, stepId: z.enum(['read_notice', 'prepare_questions']), confirmation: z.literal('MARK LOCAL STEP'),
  }, false, input => service.mark(input));
  for (const record of listCatalog()) {
    mcp.registerResource(`catalog-${record.id}`, `recallready://catalog/${record.id}`, { mimeType: 'application/json', description: 'Dated source snapshot; no personal observations.' }, async uri => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(getRecord(record.id), null, 2) }],
    }));
  }
  return mcp;
}

function json(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify({ error: message }));
}
async function readBody(req) {
  const parts = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new Error('Request body exceeds the 16 KiB limit.');
    parts.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new Error('Request must be valid JSON.'); }
}
function equalToken(actual, expected) {
  const a = Buffer.from(actual ?? '');
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startServer({ port = 8799, statePath = '.state/cases.json', syntheticDemo = false, token, publicSourceEnabled = false, publicSourceFetch = fetch } = {}) {
  if (!syntheticDemo) throw new Error('Only bounded synthetic demo mode is implemented. Set RECALLREADY_SYNTHETIC_DEMO=1.');
  if (token !== undefined && (typeof token !== 'string' || token.length < 32)) throw new Error('Optional local token must contain at least 32 characters.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local port.');
  const service = new CaseService(new CaseStore(statePath));
  let origin;
  const server = createServer(async (req, res) => {
    const authority = new URL(origin).host;
    const allowedHosts = new Set([authority, authority.replace('127.0.0.1', 'localhost')]);
    const allowedOrigins = new Set([...allowedHosts].map(host => `http://${host}`));
    if (!allowedHosts.has(req.headers.host) || (req.headers.origin !== undefined && !allowedOrigins.has(req.headers.origin))) return json(res, 403, 'Untrusted Host or Origin.');
    if (token && !equalToken(req.headers.authorization, token)) return json(res, 401, 'Local authentication required.');
    if (req.url === '/health' && req.method === 'GET') return json(res, 200, `recallready-continuity: synthetic-only, loopback-only; optional public source GET ${publicSourceEnabled === true ? 'enabled' : 'disabled'}; no claims or financial actions`);
    if (req.url !== '/mcp') return json(res, 404, 'Not found.');
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      return json(res, 405, 'Standalone SSE and session deletion are not offered by this stateless transport. Persisted case state is independent of MCP sessions.');
    }
    if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') return json(res, 415, 'Use application/json.');
    try {
      const body = await readBody(req);
      if (Array.isArray(body)) return json(res, 400, 'JSON-RPC batches are not accepted.');
      const mcp = createMcpServer(service, { publicSourceEnabled, publicSourceFetch });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.once('close', () => { void transport.close(); void mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) json(res, 400, error.message);
      else res.end();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.maxHeadersCount = 40;
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', accept);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, endpoint: `${origin}/mcp`, async close() { server.closeIdleConnections(); await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const active = await startServer({
    port: Number(process.env.PORT ?? 8799),
    statePath: process.env.RECALLREADY_STATE_PATH ?? '.state/cases.json',
    syntheticDemo: process.env.RECALLREADY_SYNTHETIC_DEMO === '1',
    token: process.env.RECALLREADY_TOKEN || undefined,
    publicSourceEnabled: process.env.RECALLREADY_PUBLIC_SOURCE_CHECK === '1',
  });
  console.log(JSON.stringify({ endpoint: active.endpoint, syntheticDemo: true, networkBinding: 'loopback-only', publicSourceCheckEnabled: process.env.RECALLREADY_PUBLIC_SOURCE_CHECK === '1' }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void active.close().then(() => process.exit(0)); });
}
