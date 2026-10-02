import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'recallready-public-demo-'));
const statePath = join(directory, 'cases.json');
const processes = [];
const clients = [];
const emit = (step, result) => console.log(JSON.stringify({ step, ...result }, null, 2));
async function boot() {
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', RECALLREADY_SYNTHETIC_DEMO: '1', RECALLREADY_STATE_PATH: statePath, RECALLREADY_TOKEN: '', RECALLREADY_PUBLIC_SOURCE_CHECK: '' },
  });
  const lines = createInterface({ input: child.stdout });
  const endpoint = await new Promise((accept, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Local demo startup timed out.')); }, 10_000);
    lines.once('line', line => { clearTimeout(timer); try { accept(JSON.parse(line).endpoint); } catch (error) { reject(error); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); if (code) reject(new Error('Local demo process exited before startup.')); });
  });
  let stopped;
  const handle = { endpoint, pid: child.pid, async stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (!stopped) { stopped = new Promise(accept => child.once('exit', accept)); child.kill(); }
    await stopped; lines.close();
  } };
  processes.push(handle);
  return handle;
}
async function connect(endpoint) {
  const client = new Client({ name: 'recallready-scripted-mcp-demo-NOT-ALEXA', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  clients.push(client);
  return client;
}
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content[0].text);
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}
try {
  emit('disclosure', { integration: 'Official MCP client -> local Streamable HTTP server. Not Alexa, not voice recognition, not an LLM.', data: 'One dated public CPSC snapshot plus deliberately synthetic product observations.', externalActions: 'None. No network services except local loopback are called.' });
  const first = await boot();
  const negotiatedResponse = await fetch(first.endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'explicit-protocol-probe', version: '1.0.0' } } }),
  });
  const negotiated = await negotiatedResponse.json();
  assert.equal(negotiated.result.protocolVersion, '2025-11-25');
  emit('protocol', { negotiatedProtocolVersion: negotiated.result.protocolVersion });
  const a = await connect(first.endpoint);
  const opened = await call(a, 'start_case', { recordId: 'CPSC-23-145', model: 'unknown', batch: 'not_published', requestId: 'synthetic-public-demo-case-01', confirmation: 'CREATE SYNTHETIC CASE' });
  const unknown = await call(a, 'next_step', { caseId: opened.caseId });
  emit('missing_fact', { nextStep: unknown.nextStep, eligibility: unknown.eligibility });
  await call(a, 'record_product_facts', { caseId: opened.caseId, expectedRevision: 1, model: 'Hopper M20', batch: 'not_published', confirmation: 'SAVE SYNTHETIC FACTS' });
  await a.close();
  await first.stop();
  const second = await boot();
  assert.notEqual(second.pid, first.pid);
  const b = await connect(second.endpoint);
  const resumed = await call(b, 'resume_case', { caseId: opened.caseId });
  assert.equal(resumed.revision, 2);
  emit('after_real_process_restart', { differentServerProcess: true, revision: resumed.revision, productFacts: resumed.productFacts, benefitOptions: resumed.benefitOptions, cashStatus: resumed.cashStatus });
  const evidence = await call(b, 'inspect_evidence', { caseId: opened.caseId });
  emit('evidence', { source: evidence.catalogEvidence[0].sourceUrl, sourceCheckedAt: evidence.catalogEvidence[0].sourceCheckedAt, remedy: evidence.catalogEvidence[0].remedy, observations: evidence.observations });
  const rejected = await b.callTool({ name: 'mark_local_step', arguments: { caseId: opened.caseId, expectedRevision: 2, stepId: 'refund_received', confirmation: 'MARK LOCAL STEP' } });
  assert.equal(rejected.isError, true);
  emit('unsupported_payment_completion', { rejected: true, revisionUnchanged: (await call(b, 'resume_case', { caseId: opened.caseId })).revision === 2 });
  await call(b, 'mark_local_step', { caseId: opened.caseId, expectedRevision: 2, stepId: 'read_notice', confirmation: 'MARK LOCAL STEP' });
  await call(b, 'mark_local_step', { caseId: opened.caseId, expectedRevision: 3, stepId: 'prepare_questions', confirmation: 'MARK LOCAL STEP' });
  const final = await call(b, 'next_step', { caseId: opened.caseId });
  emit('local_preparation_only', { nextStep: final.nextStep, eligibility: final.eligibility, moneyReceived: final.moneyReceived, externalActionTaken: final.externalActionTaken });
} finally {
  for (const client of clients) await client.close().catch(() => {});
  for (const active of processes) await active.stop();
  // Only this invocation's Node-created temporary directory is removed.
  if (!resolve(directory).startsWith(resolve(tmpdir()) + '\\') && !resolve(directory).startsWith(resolve(tmpdir()) + '/')) throw new Error('Temporary cleanup path was not inside the OS temp directory.');
  await rm(directory, { recursive: true, force: true });
}
