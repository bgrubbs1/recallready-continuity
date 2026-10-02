import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CaseStore, CaseService } from '../src/cases.mjs';
import { getRecord } from '../src/catalog.mjs';
import { digest } from '../src/integrity.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'recallready-continuity-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'cases.json');
  return { path, service: new CaseService(new CaseStore(path)) };
}
const start = { recordId: 'DEMO-KETTLE-01', model: 'unknown', batch: 'unknown', confirmation: 'CREATE SYNTHETIC CASE', requestId: 'case-creation-demo-0001' };

test('unknown facts remain unknown; planning identifies the exact missing observation', async t => {
  const { service } = await fixture(t);
  const created = await service.start(start);
  assert.equal(created.revision, 1);
  assert.equal(created.synthetic, true);
  assert.equal(created.eligibility, 'not_determined');
  const plan = await service.plan(created.caseId);
  assert.equal(plan.nextStep.id, 'record_model');
  assert.deepEqual(plan.missingFacts, ['model', 'batch']);
  assert.equal(plan.moneyReceived, false);
  assert.equal(plan.externalActionTaken, false);
});

test('case survives a new store and observations remain separate from source evidence', async t => {
  const { path, service } = await fixture(t);
  const created = await service.start(start);
  const updated = await service.recordFacts({ caseId: created.caseId, expectedRevision: 1, model: 'K100', batch: 'A1', confirmation: 'SAVE SYNTHETIC FACTS' });
  assert.equal(updated.revision, 2);
  const restarted = new CaseService(new CaseStore(path));
  const resumed = await restarted.resume(created.caseId);
  assert.deepEqual(resumed.productFacts, updated.productFacts);
  const evidence = await restarted.evidence(created.caseId);
  assert.equal(evidence.catalogEvidence[0].sourceKind, 'synthetic_fixture');
  assert.ok(evidence.observations.every(x => x.sourceKind === 'client_supplied_synthetic_observation'));
  const plan = await restarted.plan(created.caseId);
  assert.equal(plan.comparison, 'matches_synthetic_catalog_fields');
  assert.equal(plan.eligibility, 'not_determined');
  assert.equal(plan.nextStep.id, 'read_notice');
});

test('marks require exact confirmation and cannot mark an external remedy received', async t => {
  const { service } = await fixture(t);
  const created = await service.start({ ...start, model: 'K100', batch: 'A1' });
  await assert.rejects(() => service.mark({ caseId: created.caseId, expectedRevision: 1, stepId: 'read_notice', confirmation: 'yes' }), /confirmation/);
  await assert.rejects(() => service.mark({ caseId: created.caseId, expectedRevision: 1, stepId: 'refund_received', confirmation: 'MARK LOCAL STEP' }), /local step/);
  const marked = await service.mark({ caseId: created.caseId, expectedRevision: 1, stepId: 'read_notice', confirmation: 'MARK LOCAL STEP' });
  assert.equal(marked.revision, 2);
  assert.deepEqual(marked.completedLocalSteps, ['read_notice']);
  const plan = await service.plan(created.caseId);
  assert.equal(plan.nextStep.id, 'prepare_questions');
  assert.equal(plan.externalActionTaken, false);
});

test('revision check serializes competing writers and duplicate creation is idempotent', async t => {
  const { service } = await fixture(t);
  const created = await service.start(start);
  const duplicate = await service.start(start);
  assert.equal(created.caseId, duplicate.caseId);
  const results = await Promise.allSettled([
    service.recordFacts({ caseId: created.caseId, expectedRevision: 1, model: 'K100', batch: 'A1', confirmation: 'SAVE SYNTHETIC FACTS' }),
    service.recordFacts({ caseId: created.caseId, expectedRevision: 1, model: 'K200', batch: 'B9', confirmation: 'SAVE SYNTHETIC FACTS' }),
  ]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.match(results.find(x => x.status === 'rejected').reason.message, /stale revision/);
  await assert.rejects(() => service.start({ ...start, model: 'K200' }), /requestId.*different/);
});

test('changed observations invalidate previously marked preparation and never assert safety', async t => {
  const { service } = await fixture(t);
  const created = await service.start({ ...start, model: 'K100', batch: 'A1' });
  await service.mark({ caseId: created.caseId, expectedRevision: 1, stepId: 'read_notice', confirmation: 'MARK LOCAL STEP' });
  await service.recordFacts({ caseId: created.caseId, expectedRevision: 2, model: 'K200', batch: 'A1', confirmation: 'SAVE SYNTHETIC FACTS' });
  const resumed = await service.resume(created.caseId);
  assert.deepEqual(resumed.completedLocalSteps, []);
  const plan = await service.plan(created.caseId);
  assert.equal(plan.comparison, 'differs_from_synthetic_catalog_fields');
  assert.equal(plan.nextStep.id, 'resolve_difference');
  assert.equal(plan.eligibility, 'not_determined');
  assert.ok(plan.limitations.some(x => x.includes('not establish safety')));
});

test('unknown cases, free text and corrupt storage fail closed', async t => {
  const { path, service } = await fixture(t);
  await assert.rejects(() => service.start({ ...start, model: 'person@example.invalid' }), /synthetic model/);
  await assert.rejects(() => service.start({ ...start, batch: '123 Main Street' }), /synthetic batch/);
  await assert.rejects(() => service.resume('00000000-0000-4000-8000-000000000000'), /Case not found/);
  await writeFile(path, '{"version":1,"cases":{"broken":{}}}', 'utf8');
  const before = await readFile(path, 'utf8');
  await assert.rejects(() => service.start(start), /storage is invalid/);
  assert.equal(await readFile(path, 'utf8'), before);
});

test('saved source is immutable and changed current evidence blocks continuation', async t => {
  const { path, service } = await fixture(t);
  const created = await service.start({ ...start, model: 'K100', batch: 'A1' });
  const changed = new CaseService(new CaseStore(path), { catalogLookup: id => ({ ...getRecord(id), snapshotId: 'a'.repeat(64), remedy: { kinds: ['brand_gift_card'], cashPaymentVerified: false, summary: 'Different synthetic remedy for the source-change regression.' } }) });
  const plan = await changed.plan(created.caseId);
  assert.equal(plan.snapshotChanged, true);
  assert.equal(plan.nextStep.id, 'review_changed_source');
  assert.deepEqual(plan.source.remedy.kinds, ['replacement']);
  assert.deepEqual(plan.currentSource.remedy.kinds, ['brand_gift_card']);
  assert.deepEqual(plan.benefitOptions, ['replacement']);
  const disk = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(disk.cases[created.caseId].sourceSnapshot, getRecord('DEMO-KETTLE-01'));
  await assert.rejects(() => changed.mark({ caseId: created.caseId, expectedRevision: 1, stepId: 'read_notice', confirmation: 'MARK LOCAL STEP' }), /not the current next step/);
});

test('snapshot integrity ignores JSON key order but refuses altered remedy text', async t => {
  assert.equal(digest({ a: 1, b: { y: 3, x: 2 } }), digest({ b: { x: 2, y: 3 }, a: 1 }));
  const { path, service } = await fixture(t);
  const created = await service.start({ ...start, recordId: 'CPSC-23-145', model: 'Hopper M20', batch: 'not_published' });
  const disk = JSON.parse(await readFile(path, 'utf8'));
  const source = disk.cases[created.caseId].sourceSnapshot;
  disk.cases[created.caseId].sourceSnapshot = Object.fromEntries(Object.entries(source).reverse());
  await writeFile(path, JSON.stringify(disk), 'utf8');
  assert.equal((await service.resume(created.caseId)).revision, 1);
  disk.cases[created.caseId].sourceSnapshot.remedy.summary = 'Tampered synthetic assertion';
  await writeFile(path, JSON.stringify(disk), 'utf8');
  await assert.rejects(() => service.resume(created.caseId), /storage is invalid/);
});
