import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer } from '../src/server.mjs';
import { PUBLIC_API_URL, PUBLIC_SOURCE_URL } from '../src/public-source.mjs';

const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'independent-protocol-test', version: '1.0.0' } } };
async function connect(endpoint, token) {
  const client = new Client({ name: 'explicitly-not-alexa-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined });
  await client.connect(transport);
  return { client, transport };
}
async function call(client, name, args) {
  const response = await client.callTool({ name, arguments: args });
  assert.notEqual(response.isError, true, JSON.stringify(response));
  return response.structuredContent ?? JSON.parse(response.content[0].text);
}

test('official SDK negotiates 2025-11-25 over HTTP and exposes strict bounded tools/resources', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'recallready-http-'));
  const active = await startServer({ port: 0, statePath: join(directory, 'cases.json'), syntheticDemo: true });
  t.after(async () => { await active.close(); await rm(directory, { recursive: true, force: true }); });
  const response = await fetch(active.endpoint, { method: 'POST', headers, body: JSON.stringify(initialize) });
  assert.equal(response.status, 200);
  const negotiated = await response.json();
  assert.equal(negotiated.result.protocolVersion, '2025-11-25');
  assert.equal(negotiated.result.serverInfo.name, 'recallready-continuity');
  const { client } = await connect(active.endpoint);
  t.after(() => client.close());
  const listing = await client.listTools();
  assert.equal(listing.tools.length, 8);
  assert.equal(listing.tools.find(x => x.name === 'check_public_source').annotations.openWorldHint, true);
  const disabled = await client.callTool({ name: 'check_public_source', arguments: { recordId: 'CPSC-23-145' } });
  assert.equal(disabled.isError, true);
  assert.match(disabled.content[0].text, /disabled/);
  const arbitrarySource = await client.callTool({ name: 'check_public_source', arguments: { recordId: 'CPSC-23-145', url: 'https://example.invalid' } });
  assert.equal(arbitrarySource.isError, true);
  assert.equal(listing.tools.find(x => x.name === 'record_product_facts').inputSchema.additionalProperties, false);
  assert.ok(listing.tools.every(x => !/claim|pay|call_manufacturer|submit/.test(x.name)));
  const resources = await client.listResources();
  assert.equal(resources.resources.length, 2);
  const receipt = await client.readResource({ uri: 'recallready://catalog/CPSC-23-145' });
  const record = JSON.parse(receipt.contents[0].text);
  assert.deepEqual(record.remedy.kinds, ['replacement', 'brand_gift_card']);
  assert.equal(record.remedy.cashPaymentVerified, false);
  assert.equal(record.sourceKind, 'official_public_snapshot');
  const denied = await client.callTool({ name: 'start_case', arguments: { recordId: 'CPSC-23-145', model: 'Hopper M20', batch: 'not_published', confirmation: 'CREATE SYNTHETIC CASE', requestId: 'synthetic-http-request-01', personalEmail: 'synthetic@example.invalid' } });
  assert.equal(denied.isError, true);
});

test('network boundaries reject Host, Origin, bad JSON, oversized body and absent auth', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'recallready-denial-'));
  const token = 'synthetic-test-token-not-a-real-secret-00000001';
  const active = await startServer({ port: 0, statePath: join(directory, 'cases.json'), syntheticDemo: true, token });
  t.after(async () => { await active.close(); await rm(directory, { recursive: true, force: true }); });
  const auth = { ...headers, authorization: `Bearer ${token}` };
  assert.equal((await fetch(active.endpoint, { method: 'POST', headers, body: JSON.stringify(initialize) })).status, 401);
  for (const origin of ['https://evil.example.invalid', 'null', `${active.origin}.evil.example.invalid`]) {
    assert.equal((await fetch(active.endpoint, { method: 'POST', headers: { ...auth, origin }, body: JSON.stringify(initialize) })).status, 403);
  }
  const badHostStatus = await new Promise((accept, reject) => {
    const req = request(active.endpoint, { method: 'POST', headers: { ...auth, host: 'attacker.example.invalid' } }, res => { res.resume(); accept(res.statusCode); });
    req.on('error', reject); req.end(JSON.stringify(initialize));
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(active.endpoint, { method: 'POST', headers: auth, body: '{broken' })).status, 400);
  assert.equal((await fetch(active.endpoint, { method: 'POST', headers: { ...auth, 'content-type': 'application/jsonX' }, body: JSON.stringify(initialize) })).status, 415);
  assert.equal((await fetch(active.endpoint, { method: 'POST', headers: auth, body: JSON.stringify([initialize]) })).status, 400);
  assert.equal((await fetch(active.endpoint, { method: 'POST', headers: auth, body: JSON.stringify({ padding: 'x'.repeat(17_000) }) })).status, 400);
  assert.equal((await fetch(active.endpoint, { headers: { authorization: `Bearer ${token}` } })).status, 405);
  assert.equal((await fetch(active.endpoint, { method: 'POST', headers: { ...auth, origin: active.origin }, body: JSON.stringify(initialize) })).status, 200);
  await assert.rejects(() => startServer({ port: 0 }), /synthetic demo/);
});

test('operator-enabled source tool uses injected public GET without mutating case or catalog', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'recallready-source-http-'));
  const statePath = join(directory, 'cases.json');
  let fetches = 0;
  let failFetch = false;
  const active = await startServer({ port: 0, statePath, syntheticDemo: true, publicSourceEnabled: true, publicSourceFetch: async url => {
    fetches++;
    assert.equal(url, PUBLIC_API_URL);
    if (failFetch) return new Response('upstream detail must not leak', { status: 503 });
    return new Response(JSON.stringify([{ RecallID: 9555, RecallNumber: '23145', URL: PUBLIC_SOURCE_URL, Title: 'Synthetic CPSC API fixture', LastPublishDate: '2023-03-09T00:00:00', Remedies: [{ Name: 'Synthetic fixture: replacement or brand gift card.' }], RemedyOptions: [{ Option: 'Refund' }, { Option: 'Replace' }] }]), { headers: { 'content-type': 'application/json' } });
  } });
  t.after(async () => { await active.close(); await rm(directory, { recursive: true, force: true }); });
  const { client } = await connect(active.endpoint);
  t.after(() => client.close());
  const opened = await call(client, 'start_case', { recordId: 'CPSC-23-145', model: 'unknown', batch: 'not_published', confirmation: 'CREATE SYNTHETIC CASE', requestId: 'synthetic-public-check-01' });
  const beforeState = await readFile(statePath, 'utf8');
  const beforeCatalog = await client.readResource({ uri: 'recallready://catalog/CPSC-23-145' });
  const checked = await call(client, 'check_public_source', { recordId: 'CPSC-23-145' });
  assert.equal(checked.cashStatus, 'cash_not_verified');
  assert.equal(checked.interpretationNeeded, true);
  assert.equal(fetches, 1);
  failFetch = true;
  const failed = await client.callTool({ name: 'check_public_source', arguments: { recordId: 'CPSC-23-145' } });
  assert.equal(failed.isError, true);
  assert.equal(failed.structuredContent, undefined);
  assert.ok(!JSON.stringify(failed).includes('upstream detail'));
  assert.equal(fetches, 2);
  assert.equal(await readFile(statePath, 'utf8'), beforeState);
  assert.deepEqual(await client.readResource({ uri: 'recallready://catalog/CPSC-23-145' }), beforeCatalog);
  assert.equal((await call(client, 'resume_case', { caseId: opened.caseId })).revision, 1);
});

async function startChild(statePath) {
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, PORT: '0', RECALLREADY_SYNTHETIC_DEMO: '1', RECALLREADY_STATE_PATH: statePath, RECALLREADY_TOKEN: '', RECALLREADY_PUBLIC_SOURCE_CHECK: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  const endpoint = await new Promise((accept, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Child startup timed out')); }, 10_000);
    lines.once('line', line => { clearTimeout(timer); try { accept(JSON.parse(line).endpoint); } catch (error) { reject(error); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); if (code) reject(new Error(`Child startup exited ${code}`)); });
  });
  let stopping;
  return { endpoint, async stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (!stopping) {
      stopping = new Promise(resolve => child.once('exit', resolve));
      child.kill();
    }
    await stopping;
    lines.close();
  } };
}

test('real process restart resumes a revised case without replaying local progress or inventing a payout', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'recallready-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await startChild(join(directory, 'cases.json'));
  t.after(() => first.stop());
  const a = await connect(first.endpoint);
  const opened = await call(a.client, 'start_case', { recordId: 'CPSC-23-145', model: 'unknown', batch: 'not_published', confirmation: 'CREATE SYNTHETIC CASE', requestId: 'synthetic-restart-case-01' });
  const before = await call(a.client, 'next_step', { caseId: opened.caseId });
  assert.equal(before.nextStep.id, 'record_model');
  const saved = await call(a.client, 'record_product_facts', { caseId: opened.caseId, expectedRevision: 1, model: 'Hopper M20', batch: 'not_published', confirmation: 'SAVE SYNTHETIC FACTS' });
  assert.equal(saved.revision, 2);
  await a.client.close(); await first.stop();
  const second = await startChild(join(directory, 'cases.json'));
  t.after(() => second.stop());
  const b = await connect(second.endpoint);
  t.after(() => b.client.close());
  const resumed = await call(b.client, 'resume_case', { caseId: opened.caseId });
  assert.equal(resumed.revision, 2);
  assert.equal(resumed.productFacts.model, 'Hopper M20');
  assert.deepEqual(resumed.benefitOptions, ['replacement', 'brand_gift_card']);
  assert.equal(resumed.cashStatus, 'not_verified_or_received');
  assert.ok(resumed.sourceSnapshot.verificationMethod.includes('may be cached'));
  assert.deepEqual(resumed.completedLocalSteps, []);
  const stale = await b.client.callTool({ name: 'mark_local_step', arguments: { caseId: opened.caseId, expectedRevision: 1, stepId: 'read_notice', confirmation: 'MARK LOCAL STEP' } });
  assert.equal(stale.isError, true);
  const plan = await call(b.client, 'next_step', { caseId: opened.caseId });
  assert.equal(plan.source.remedy.cashPaymentVerified, false);
  assert.equal(plan.moneyReceived, false);
  assert.equal(plan.eligibility, 'not_determined');
  assert.equal(plan.nextStep.id, 'read_notice');
  const unsupported = await b.client.callTool({ name: 'mark_local_step', arguments: { caseId: opened.caseId, expectedRevision: 2, stepId: 'remedy_received', confirmation: 'MARK LOCAL STEP' } });
  assert.equal(unsupported.isError, true);
  assert.equal((await call(b.client, 'resume_case', { caseId: opened.caseId })).revision, 2);
});
