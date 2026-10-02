import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));

test('startup parser reconstructs a ready message deliberately split across stdout chunks', async () => {
  const { readStartupMessage } = await import(new URL('../scripts/walkthrough.mjs?startup-parser-test=1', import.meta.url));
  const stdout = new PassThrough();
  const neverExit = new Promise(() => {});
  const endpoint = 'http://127.0.0.1:42991/mcp';
  let chunks = 0;
  stdout.on('data', () => { chunks += 1; });
  const parsed = readStartupMessage(stdout, neverExit, 1_000);
  for (const part of ['{"end', 'point":"http://127.0.0.1:', '42991/mcp"}\r', '\n']) stdout.write(part);
  assert.equal(await parsed, endpoint);
  assert.equal(chunks, 4);
  stdout.end();

  const oversized = new PassThrough();
  const rejected = assert.rejects(readStartupMessage(oversized, neverExit, 1_000), /exceeded 4 KiB/);
  oversized.write(Buffer.alloc(4_097, 0x78));
  await rejected;
  oversized.end();
});

function launch(directory) {
  const child = spawn(process.execPath, ['scripts/walkthrough.mjs', '--state-dir', directory], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exit = new Promise(accept => {
    child.once('exit', (code, signal) => accept({ code, signal }));
    child.once('error', error => accept({ code: null, signal: null, error }));
  });
  const menu = new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error(`Walkthrough did not reach its first menu. stdout tail=${JSON.stringify(stdout.slice(-2000))}; stderr tail=${JSON.stringify(stderr.slice(-2000))}`)), 30_000);
    const check = () => {
      if (stdout.includes('Choose a number: ')) { clearTimeout(timer); accept(true); }
    };
    child.stdout.on('data', check);
    exit.then(() => { clearTimeout(timer); accept(false); });
  });
  return { child, exit, menu, get output() { return { stdout, stderr }; } };
}

async function finish(process, input) {
  try {
    if (await waitForMenu(process)) process.child.stdin.end(input);
  } catch (error) {
    await terminateOwnedTree(process);
    throw error;
  }
  let timer;
  const outcome = await Promise.race([
    process.exit,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Walkthrough process timed out. stdout tail=${JSON.stringify(process.output.stdout.slice(-2000))}; stderr tail=${JSON.stringify(process.output.stderr.slice(-2000))}`)), 40_000); }),
  ]).catch(async error => {
    await terminateOwnedTree(process);
    throw error;
  }).finally(() => clearTimeout(timer));
  return { ...process.output, ...outcome };
}

async function run(directory, input) { return finish(launch(directory), input); }

async function waitForMenu(active) {
  try { return await active.menu; }
  catch (error) {
    await terminateOwnedTree(active);
    throw error;
  }
}

async function waitForExit(active, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([active.exit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } catch (error) {
    await terminateOwnedTree(active);
    throw error;
  } finally { clearTimeout(timer); }
}

async function terminateOwnedTree(process) {
  const child = process.child;
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return process.exit;
  if (globalThis.process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const result = await new Promise((accept, reject) => {
      killer.once('error', reject);
      killer.once('close', code => accept({ code }));
    });
    if (result.code !== 0 && child.exitCode === null && child.signalCode === null) {
      throw new Error(`Could not terminate only walkthrough process tree ${child.pid} (taskkill exit ${result.code}).`);
    }
  } else child.kill('SIGTERM');
  return process.exit;
}

async function fixture(t) {
  const directory = await mkdtemp(join(root, '.walkthrough-test-'));
  const resolved = await realpath(directory);
  assert.ok(relative(root, resolved) && !relative(root, resolved).startsWith('..'));
  t.after(async () => {
    assert.equal(await realpath(directory), resolved);
    await rm(resolved, { recursive: true, force: true });
  });
  return resolved;
}

test('terminal MCP client persists synthetic facts and a separate invocation resumes without auto-marking', async t => {
  const directory = await fixture(t);
  const first = await run(directory, '1\n1\n2\n4\n4\n');
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /official MCP client -> local server\. Not Alexa/);
  assert.match(first.stdout, /Created synthetic case .*\(revision 1\)/);
  assert.match(first.stdout, /Saved only those synthetic enum values at revision 2/);
  assert.doesNotMatch(first.stdout, /Resumed synthetic case/);
  const db = JSON.parse(await readFile(join(directory, 'cases.json'), 'utf8'));
  const item = Object.values(db.cases)[0];
  assert.equal(item.revision, 2);
  assert.equal(item.productFacts.model, 'Hopper M20');
  assert.equal(item.productFacts.batch, 'not_published');
  assert.deepEqual(item.completedLocalSteps, []);
  assert.equal(item.history.some(event => event.action === 'local_step_marked'), false);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'active-case.json'), 'utf8')), { caseId: item.caseId });

  const second = await run(directory, '2\n3\n4\n3\n');
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /Resumed synthetic case .*\(revision 2\); no progress was marked/);
  assert.match(second.stdout, /Exact next step: read_notice/);
  assert.match(second.stdout, /eligibility: not_determined; no payment verified or received/);
  const afterResume = JSON.parse(await readFile(join(directory, 'cases.json'), 'utf8'));
  assert.equal(Object.values(afterResume.cases)[0].revision, 2);
  assert.deepEqual(Object.values(afterResume.cases)[0].completedLocalSteps, []);
});

test('invalid menu input is refused without case creation; outside, cross-drive and normalized node_modules paths are rejected', async t => {
  const directory = await fixture(t);
  const result = await run(directory, '9\n3\n');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Invalid menu choice; nothing changed/);
  await assert.rejects(() => readFile(join(directory, 'cases.json')));

  const rootDrive = root.slice(0, 2).toLowerCase();
  const otherDrive = rootDrive === 'c:' ? 'D:' : 'C:';
  const nodeModules = resolve(root, 'Walkthrough-Test', 'NODE_MODULES', 'state');
  for (const path of [resolve(root, '..'), resolve(`${otherDrive}\\walkthrough-outside`), nodeModules]) {
    const rejected = await runInvalidPath(path);
    assert.notEqual(rejected.code, 0);
    assert.match(rejected.stderr, /project-local subdirectory/);
  }
});

async function runInvalidPath(path) {
  const child = spawn(process.execPath, ['scripts/walkthrough.mjs', '--state-dir', path], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const outcome = await new Promise(accept => {
    child.once('exit', code => accept({ code }));
    child.once('error', error => accept({ code: null, error }));
  });
  return { ...outcome, stderr };
}

test('state-directory symlinks are refused before mkdir or server startup', async t => {
  const directory = await fixture(t);
  const target = await mkdtemp(join(root, '.walkthrough-target-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  const stateLink = join(directory, 'state-link');
  await symlink(target, stateLink, 'junction');
  const stateResult = await runInvalidPath(stateLink);
  assert.notEqual(stateResult.code, 0);
  assert.match(stateResult.stderr, /symbolic links/);
  await rm(stateLink);
});

test('pointer and case-file symlinks are refused when Windows permits creating file symlinks', async t => {
  const directory = await fixture(t);
  const pointerTarget = join(directory, 'pointer-target.json');
  await writeFile(pointerTarget, 'sentinel');
  const pointer = join(directory, 'active-case.json');
  try { await symlink(pointerTarget, pointer, 'file'); }
  catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') {
      t.skip('This Windows host does not permit unprivileged file symlink creation; pointer/case file-link runtime checks remain unverified here.');
      return;
    }
    throw error;
  }
  const pointerResult = await run(directory, '3\n');
  assert.notEqual(pointerResult.code, 0);
  assert.match(pointerResult.stderr, /symbolic links|regular file, not a link/);
  assert.equal(await readFile(pointerTarget, 'utf8'), 'sentinel');
  await rm(pointer);

  const casesTarget = join(directory, 'cases-target.json');
  await writeFile(casesTarget, 'sentinel');
  await symlink(casesTarget, join(directory, 'cases.json'), 'file');
  const casesResult = await run(directory, '3\n');
  assert.notEqual(casesResult.code, 0);
  assert.match(casesResult.stderr, /symbolic links|regular file, not a link/);
  assert.equal(await readFile(casesTarget, 'utf8'), 'sentinel');
  await rm(join(directory, 'cases.json'));
});

test('line size and queued-line limits are enforced and the owned lock is released', async t => {
  const directory = await fixture(t);
  const tooLong = await run(directory, `${'1'.repeat(33)}\n`);
  assert.equal(tooLong.code, 1);
  assert.match(tooLong.stderr, /each menu line is limited to 32 bytes/);
  await assert.rejects(() => readFile(join(directory, 'walkthrough.lock')));

  const tooMany = await run(directory, `${'3\n'.repeat(18)}`);
  assert.equal(tooMany.code, 1);
  assert.match(tooMany.stderr, /at most 16 queued menu lines/);
  await assert.rejects(() => readFile(join(directory, 'walkthrough.lock')));
});

test('live lock is owned by the first process and a second process fails closed', async t => {
  const directory = await fixture(t);
  const owner = launch(directory);
  assert.equal(await waitForMenu(owner), true);
  const lock = join(directory, 'walkthrough.lock');
  const token = await readFile(lock, 'utf8');
  assert.match(token, /^[0-9a-f-]{36}$/i);
  const contender = await run(directory, '3\n');
  assert.notEqual(contender.code, 0);
  assert.match(contender.stderr, /refusing concurrent use or stale-lock recovery/);
  assert.equal(await readFile(lock, 'utf8'), token);
  owner.child.stdin.end('3\n');
  const result = await waitForExit(owner, 40_000, 'Lock owner did not stop after quit.');
  assert.equal(result.code, 0, owner.output.stderr);
  await assert.rejects(() => readFile(lock));
});

test('unknown pre-existing lock fails closed and is not silently removed', async t => {
  const directory = await fixture(t);
  const lock = join(directory, 'walkthrough.lock');
  await writeFile(lock, 'unknown-owner', { flag: 'wx' });
  const result = await run(directory, '3\n');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /refusing concurrent use or stale-lock recovery/);
  assert.equal(await readFile(lock, 'utf8'), 'unknown-owner');
  await assert.rejects(() => readFile(join(directory, 'cases.json')));
});

test('caught SIGTERM cleans up; forced Windows process-tree termination preserves the stale lock', async t => {
  const directory = await fixture(t);
  const active = launch(directory);
  assert.equal(await waitForMenu(active), true);
  const lock = join(directory, 'walkthrough.lock');
  const owned = await readFile(lock, 'utf8');
  let result;
  if (globalThis.process.platform === 'win32') {
    await terminateOwnedTree(active);
    result = await active.exit;
    assert.notEqual(result.code, 0);
    assert.equal(await readFile(lock, 'utf8'), owned);
  } else {
    active.child.kill('SIGTERM');
    result = await waitForExit(active, 40_000, 'Walkthrough did not exit after SIGTERM.');
    assert.equal(result.code, 143);
    await assert.rejects(() => readFile(lock));
  }
  assert.match(owned, /^[0-9a-f-]{36}$/i);
});
