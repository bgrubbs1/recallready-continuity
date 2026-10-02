import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export function readStartupMessage(stdout, childExit, timeoutMs = 10_000) {
  return new Promise((accept, reject) => {
    let startupBuffer = Buffer.alloc(0);
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.off('data', readLine);
      if (error) reject(error);
      else accept(value);
    };
    const readLine = chunk => {
      const newline = chunk.indexOf(10);
      const part = newline < 0 ? chunk : chunk.subarray(0, newline);
      if (startupBuffer.length + part.length > 4_096) { finish(new Error('Local MCP server startup message exceeded 4 KiB.')); return; }
      startupBuffer = Buffer.concat([startupBuffer, part]);
      if (newline < 0) return;
      const line = startupBuffer.toString('utf8').replace(/\r$/, '');
      try {
        const message = JSON.parse(line);
        if (typeof message.endpoint !== 'string') throw new Error('Missing endpoint.');
        finish(null, message.endpoint);
      } catch { finish(new Error('Local MCP server returned an invalid startup message.')); }
    };
    timer = setTimeout(() => finish(new Error('Local MCP server startup timed out.')), timeoutMs);
    stdout.on('data', readLine);
    childExit.then(outcome => finish(outcome.error ?? new Error('Local MCP server exited before startup.')), error => finish(error));
  });
}

if (new URL(import.meta.url).searchParams.get('startup-parser-test') !== '1') {
const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const pointerName = 'active-case.json';
const models = ['unknown', 'K100', 'K200', 'Hopper M20', 'Hopper M30 1.0', 'Hopper M30 2.0', 'SideKick Dry', 'Other model'];
const batches = ['unknown', 'A1', 'B9', 'not_published'];
const maxInputLineBytes = 32;
const maxQueuedLines = 16;

function stateArgument() {
  const i = process.argv.indexOf('--state-dir');
  if (i < 0) return join(root, '.state', 'terminal-walkthrough');
  if (!process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error('--state-dir requires a directory path.');
  return resolve(root, process.argv[i + 1]);
}

function insideProject(path) {
  const rel = relative(root, resolve(path));
  if (!rel || rel === '..' || isAbsolute(rel) || rel.startsWith(`..${sep}`)) return false;
  const segments = rel.replaceAll('\\', '/').split('/');
  return !segments.some(segment => segment.toLowerCase() === 'node_modules');
}

async function rejectSymlinkComponents(path) {
  if (!insideProject(path)) throw new Error('State directory must be a project-local subdirectory (not node_modules).');
  let cursor = root;
  for (const segment of relative(root, resolve(path)).split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw new Error('State directory and state files cannot pass through symbolic links.');
      if (cursor !== resolve(path) && !info.isDirectory()) throw new Error('State directory parent is not a directory.');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
}

async function requireRegularFileOrMissing(path, label) {
  await rejectSymlinkComponents(path);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular file, not a link or other file type.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const stateDir = stateArgument();
if (!insideProject(stateDir)) throw new Error('State directory must be a project-local subdirectory (not node_modules).');
// Inspect all existing components first: recursive mkdir would otherwise follow a symlink.
await rejectSymlinkComponents(stateDir);
await mkdir(stateDir, { recursive: true, mode: 0o700 });
await rejectSymlinkComponents(stateDir);
const actualDir = await realpath(stateDir);
if (!insideProject(actualDir) || relative(stateDir, actualDir) !== '') throw new Error('State directory resolves outside its project-local path.');

const pointerPath = join(actualDir, pointerName);
const casesPath = join(actualDir, 'cases.json');
const lockPath = join(actualDir, 'walkthrough.lock');
await requireRegularFileOrMissing(pointerPath, 'Saved-case pointer');
await requireRegularFileOrMissing(casesPath, 'Case state');
const lockToken = randomUUID();
try {
  const lock = await open(lockPath, 'wx', 0o600);
  try { await lock.writeFile(lockToken, 'utf8'); } finally { await lock.close(); }
} catch (error) {
  if (error.code === 'EEXIST') throw new Error('Another walkthrough may own this state directory; refusing concurrent use or stale-lock recovery.');
  throw error;
}

let inputClosed = false;
let inputBuffer = Buffer.alloc(0);
let queuedLines = [];
const waitingLines = [];
let inputFailure;
let child;
let childExit;
let client;
let shutdownSignal;
let cleanupPromise;

function settleInput() {
  while (waitingLines.length) waitingLines.shift()(null);
}

function closeInput() {
  if (inputClosed) return;
  inputClosed = true;
  process.stdin.pause();
  process.stdin.off('data', onInputData);
  process.stdin.off('end', closeInput);
  settleInput();
}

function failInput(message) {
  inputFailure = message;
  process.exitCode = 1;
  console.error(`Walkthrough input stopped safely: ${message}`);
  queuedLines = [];
  closeInput();
  void cleanup();
}

function onInputData(chunk) {
  for (const byte of chunk) {
    if (byte === 10) {
      const line = inputBuffer.toString('ascii');
      inputBuffer = Buffer.alloc(0);
      const waiting = waitingLines.shift();
      if (waiting) waiting(line);
      else if (queuedLines.length < maxQueuedLines) queuedLines.push(line);
      else { failInput(`at most ${maxQueuedLines} queued menu lines are accepted.`); return; }
      continue;
    }
    if (byte === 13) continue;
    if (byte < 0x20 || byte > 0x7e) { failInput('menu input must contain printable ASCII choices only.'); return; }
    if (inputBuffer.length >= maxInputLineBytes) { failInput(`each menu line is limited to ${maxInputLineBytes} bytes.`); return; }
    inputBuffer = Buffer.concat([inputBuffer, Buffer.from([byte])]);
  }
}

process.stdin.on('data', onInputData);
process.stdin.once('end', closeInput);

const ask = prompt => {
  process.stdout.write(prompt);
  if (queuedLines.length) return Promise.resolve(queuedLines.shift());
  if (inputClosed) return Promise.resolve(null);
  return new Promise(resolveAnswer => waitingLines.push(resolveAnswer));
};

async function choice(label, options) {
  console.log(`\n${label}`);
  options.forEach((option, index) => console.log(`  ${index + 1}. ${option}`));
  const answer = await ask('Choose a number: ');
  if (answer === null) return null;
  const raw = answer.trim();
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > options.length) return null;
  return Number(raw) - 1;
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    closeInput();
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    if (client) await client.close().catch(() => {});
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      let stopTimer;
      const stopped = await Promise.race([
        childExit,
        new Promise(resolveStop => { stopTimer = setTimeout(() => resolveStop(null), 3_000); }),
      ]);
      clearTimeout(stopTimer);
      if (!stopped && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await childExit;
      }
    }
    try {
      await requireRegularFileOrMissing(lockPath, 'Walkthrough lock');
      if ((await readFile(lockPath, 'utf8')) === lockToken) await unlink(lockPath);
    } catch { /* retain a changed, linked, or unreadable lock for fail-closed recovery */ }
  })();
  return cleanupPromise;
}

function onSignal(signal) {
  if (shutdownSignal) return;
  shutdownSignal = signal;
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  closeInput();
  void cleanup();
}
const onSigint = () => onSignal('SIGINT');
const onSigterm = () => onSignal('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

async function boot() {
  child = spawn(process.execPath, [join(root, 'src', 'server.mjs')], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', RECALLREADY_SYNTHETIC_DEMO: '1', RECALLREADY_STATE_PATH: casesPath, RECALLREADY_TOKEN: '', RECALLREADY_PUBLIC_SOURCE_CHECK: '' },
  });
  childExit = new Promise(resolveExit => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
    child.once('error', error => resolveExit({ error }));
  });
  child.stderr.resume();
  const endpoint = await readStartupMessage(child.stdout, childExit);
  child.stdout.resume();
  client = new Client({ name: 'recallready-terminal-walkthrough-not-alexa', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
}

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content?.[0]?.text ?? 'MCP tool call failed.');
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

function showNext(plan) {
  console.log(`\nExact next step: ${plan.nextStep.id} — ${plan.nextStep.instruction}`);
  console.log(`Comparison: ${plan.comparison}; eligibility: ${plan.eligibility}; no payment verified or received.`);
}

async function main() {
  console.log('RecallReady local terminal walkthrough — official MCP client -> local server. Not Alexa, voice recognition, or an AI/model simulation.');
  console.log('Synthetic case only. No personal text is accepted, no public source check runs, and nothing is submitted or paid.');
  await boot();
  while (true) {
    const picked = await choice('Start a case, resume the saved case, or quit?', ['Start a synthetic CPSC-23-145 case', 'Resume saved case', 'Quit']);
    if (picked === null) { if (inputClosed) break; console.log('Invalid menu choice; nothing changed.'); continue; }
    if (picked === 2) break;
    let caseId;
    if (picked === 0) {
      const confirmation = await choice('Create deliberately synthetic case?', ['Yes, create synthetic case', 'Cancel']);
      if (confirmation !== 0) { console.log('Cancelled; nothing changed.'); continue; }
      const opened = await call('start_case', { recordId: 'CPSC-23-145', model: 'unknown', batch: 'not_published', requestId: randomUUID().replaceAll('-', ''), confirmation: 'CREATE SYNTHETIC CASE' });
      caseId = opened.caseId;
      const pointerTemp = `${pointerPath}.${randomUUID()}.tmp`;
      await requireRegularFileOrMissing(pointerPath, 'Saved-case pointer');
      const handle = await open(pointerTemp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ caseId }, null, 2) + '\n', 'utf8'); } finally { await handle.close(); }
      try {
        await requireRegularFileOrMissing(pointerPath, 'Saved-case pointer');
        await rename(pointerTemp, pointerPath);
      } catch (error) {
        await unlink(pointerTemp).catch(() => {});
        throw error;
      }
      console.log(`Created synthetic case ${caseId} (revision ${opened.revision}).`);
    } else {
      await requireRegularFileOrMissing(pointerPath, 'Saved-case pointer');
      let pointer;
      try { pointer = JSON.parse(await readFile(pointerPath, 'utf8')); } catch { console.log('No readable saved-case pointer; choose Start or Quit.'); continue; }
      if (!pointer || Object.keys(pointer).length !== 1 || typeof pointer.caseId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(pointer.caseId)) { console.log('Saved-case pointer is invalid; refusing to resume it.'); continue; }
      caseId = pointer.caseId;
      const resumed = await call('resume_case', { caseId });
      console.log(`Resumed synthetic case ${caseId} (revision ${resumed.revision}); no progress was marked.`);
    }
    let done = false;
    while (!done) {
      const action = await choice('Case actions', ['Inspect linked evidence', 'Supply synthetic model and batch', 'Show exact next step', 'Back to start/resume/quit menu']);
      if (action === null) { if (inputClosed) break; console.log('Invalid menu choice; nothing changed.'); continue; }
      if (action === 3) { done = true; continue; }
      if (action === 0) {
        const evidence = await call('inspect_evidence', { caseId });
        const source = evidence.catalogEvidence[0];
        console.log(`\nSource: ${source.title}\nURL: ${source.sourceUrl}\nSource checked: ${source.sourceCheckedAt}; publication date: ${source.sourcePublishedAt ?? 'not stated'}`);
        console.log(`Remedy wording: ${source.remedy.summary}\nCash payment verified: ${source.remedy.cashPaymentVerified}. Eligibility/current manufacturer requirements remain unknown.`);
        console.log(`Observations: ${evidence.observations.map(x => `${x.field}=${x.value} (synthetic, unverified)`).join(', ')}`);
        console.log(`Source update distinction: ${source.sourceUpdateNote ?? 'No update note.'} ${source.verificationMethod ?? ''}`);
      } else if (action === 1) {
        const m = await choice('Choose a synthetic model (no free text)', models);
        if (m === null) { console.log('Invalid model choice; nothing changed.'); continue; }
        const b = await choice('Choose a synthetic batch (no free text)', batches);
        if (b === null) { console.log('Invalid batch choice; nothing changed.'); continue; }
        const latest = await call('resume_case', { caseId });
        const saved = await call('record_product_facts', { caseId, expectedRevision: latest.revision, model: models[m], batch: batches[b], confirmation: 'SAVE SYNTHETIC FACTS' });
        console.log(`Saved only those synthetic enum values at revision ${saved.revision}.`);
      } else showNext(await call('next_step', { caseId }));
    }
  }
}

try { await main(); }
catch (error) {
  if (!shutdownSignal && !inputFailure) { console.error(`Walkthrough stopped safely: ${error.message}`); process.exitCode = 1; }
}
finally { await cleanup(); }
}
