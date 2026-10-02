import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { BATCH_VALUES, MODEL_VALUES, RECORD_IDS, getRecord } from './catalog.mjs';
import { digest as hash } from './integrity.mjs';

const uuid = z.string().uuid();
const stamp = z.string().datetime();
const factsSchema = z.object({ model: z.enum(MODEL_VALUES), batch: z.enum(BATCH_VALUES) }).strict();
const localStep = z.enum(['read_notice', 'prepare_questions']);
const eventSchema = z.object({ revision: z.number().int().positive(), action: z.enum(['created', 'facts_recorded', 'local_step_marked']), at: stamp }).strict();
const sourceSchema = z.object({
  id: z.enum(RECORD_IDS), title: z.string(), sourceKind: z.enum(['synthetic_fixture', 'official_public_snapshot']),
  sourceUrl: z.string(), sourceCheckedAt: stamp, sourcePublishedAt: z.string().nullable(), sourceUpdateNote: z.string().optional(), verificationMethod: z.string().optional(),
  affectedModels: z.array(z.enum(MODEL_VALUES)), affectedBatches: z.array(z.enum(BATCH_VALUES)).nullable(),
  factSummary: z.string(), safetyNotice: z.string(),
  remedy: z.object({ kinds: z.array(z.enum(['replacement', 'brand_gift_card'])), cashPaymentVerified: z.literal(false), summary: z.string() }).strict(),
  proofRequirements: z.string(), deadline: z.string(), snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const caseSchema = z.object({
  caseId: uuid, synthetic: z.literal(true), recordId: z.enum(RECORD_IDS), snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSnapshot: sourceSchema,
  productFacts: factsSchema, completedLocalSteps: z.array(localStep).max(2), revision: z.number().int().positive(),
  createdAt: stamp, updatedAt: stamp, history: z.array(eventSchema).max(100),
}).strict();
const databaseSchema = z.object({
  version: z.literal(1), cases: z.record(uuid, caseSchema),
  requests: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.object({ caseId: uuid, payloadHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
}).strict();
const queues = new Map();
const LIMITATIONS = [
  'All case observations are synthetic demonstrations, not verified ownership or eligibility.',
  'A field match does not establish safety, recall membership, entitlement, or a cash payment.',
  'No external claim, call, order, message, scheduling, or financial action is implemented.',
  'Catalog evidence is a dated snapshot. Recheck the linked official source before real-world decisions.',
];

/** Single Node process per file. Same-process transactions are serialized by absolute path. */
export class CaseStore {
  constructor(path) { this.path = resolve(path); }
  async transaction(operation) {
    const prior = queues.get(this.path) ?? Promise.resolve();
    const work = prior.catch(() => {}).then(async () => {
      let db;
      try {
        if ((await stat(this.path)).size > 1_000_000) throw new Error('oversized');
        db = databaseSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
        for (const [key, value] of Object.entries(db.cases)) {
          if (key !== value.caseId) throw new Error('identity mismatch');
          const { snapshotId, ...sourceFields } = value.sourceSnapshot;
          if (snapshotId !== value.snapshotId || value.sourceSnapshot.id !== value.recordId || hash(sourceFields) !== snapshotId) throw new Error('source snapshot mismatch');
        }
      } catch (error) {
        if (error.code === 'ENOENT') db = { version: 1, cases: {}, requests: {} };
        else throw new Error('Case storage is invalid; existing file was not overwritten.');
      }
      const { value, changed } = await operation(db);
      if (changed) {
        databaseSchema.parse(db);
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(db, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temporary, this.path);
      }
      return structuredClone(value);
    });
    queues.set(this.path, work.then(() => {}, () => {}));
    return work;
  }
}

function requireCase(db, id) {
  if (!uuid.safeParse(id).success) throw new Error('Case ID must be a UUID returned by start_case.');
  const item = db.cases[id];
  if (!item) throw new Error('Case not found.');
  return item;
}
function verifyFacts(model, batch) {
  if (!MODEL_VALUES.includes(model)) throw new Error('Choose a listed synthetic model; no free text or personal identifiers.');
  if (!BATCH_VALUES.includes(batch)) throw new Error('Choose a listed synthetic batch; no free text or personal identifiers.');
  return { model, batch };
}
function amend(item, action) {
  if (item.history.length >= 100) throw new Error('Synthetic case event limit reached.');
  item.revision++;
  item.updatedAt = new Date().toISOString();
  item.history.push({ revision: item.revision, action, at: item.updatedAt });
}
function view(item) {
  return { ...item, benefitOptions: item.sourceSnapshot.remedy.kinds, cashStatus: 'not_verified_or_received', eligibility: 'not_determined', moneyReceived: false, externalActionTaken: false, limitations: LIMITATIONS };
}
function analyze(item, currentRecord) {
  const record = item.sourceSnapshot;
  const missingFacts = [];
  if (item.productFacts.model === 'unknown') missingFacts.push('model');
  if (record.affectedBatches && item.productFacts.batch === 'unknown') missingFacts.push('batch');
  const matches = record.affectedModels.includes(item.productFacts.model) && (!record.affectedBatches || record.affectedBatches.includes(item.productFacts.batch));
  const comparison = missingFacts.length ? 'insufficient_observations' : matches ? 'matches_synthetic_catalog_fields' : 'differs_from_synthetic_catalog_fields';
  const snapshotChanged = item.snapshotId !== currentRecord.snapshotId;
  let nextStep;
  if (snapshotChanged) nextStep = { id: 'review_changed_source', instruction: 'The catalog snapshot differs from the one used to open this case. Do not rely on the old plan; inspect both versions manually.' };
  else if (missingFacts.length) nextStep = { id: `record_${missingFacts[0]}`, instruction: `Supply the missing synthetic ${missingFacts[0]} from the allowed options. Do not infer it from a product name or prior conversation.` };
  else if (!matches) nextStep = { id: 'resolve_difference', instruction: 'The supplied synthetic fields differ from this record. Review the label and current official source; this difference does not prove the item safe.' };
  else if (!item.completedLocalSteps.includes('read_notice')) nextStep = { id: 'read_notice', instruction: 'Inspect the linked notice and its dated remedy wording. Only mark this local reading step when expressly requested.' };
  else if (!item.completedLocalSteps.includes('prepare_questions')) nextStep = { id: 'prepare_questions', instruction: 'Prepare an offline question list: required proof, exact affected version, current remedy choices, benefit type, and any deadline. Do not contact anyone.' };
  else nextStep = { id: 'human_handoff', instruction: 'Local preparation is recorded. A person must verify ownership and eligibility, current terms, and any claim submission. No remedy or payment has been obtained.' };
  return { ...view(item), comparison, missingFacts, snapshotChanged, nextStep, source: record, currentSource: currentRecord, proofRequirements: record.proofRequirements, deadline: record.deadline };
}

export class CaseService {
  constructor(store, { catalogLookup = getRecord } = {}) { this.store = store; this.catalogLookup = catalogLookup; }
  async start(input) {
    if (input.confirmation !== 'CREATE SYNTHETIC CASE') throw new Error('Exact synthetic creation confirmation required.');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.requestId ?? '')) throw new Error('requestId must be a random 16–64 character request identifier.');
    const record = this.catalogLookup(input.recordId);
    const productFacts = verifyFacts(input.model, input.batch);
    const requestKey = hash(input.requestId);
    const payloadHash = hash({ recordId: record.id, productFacts });
    return this.store.transaction(db => {
      const existing = db.requests[requestKey];
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new Error('requestId already used for different facts.');
        return { value: view(requireCase(db, existing.caseId)), changed: false };
      }
      if (Object.keys(db.cases).length >= 100) throw new Error('Local synthetic demo case limit reached.');
      const now = new Date().toISOString();
      const item = { caseId: randomUUID(), synthetic: true, recordId: record.id, snapshotId: record.snapshotId, sourceSnapshot: record, productFacts, completedLocalSteps: [], revision: 1, createdAt: now, updatedAt: now, history: [{ revision: 1, action: 'created', at: now }] };
      db.cases[item.caseId] = item;
      db.requests[requestKey] = { caseId: item.caseId, payloadHash };
      return { value: view(item), changed: true };
    });
  }
  async resume(id) { return this.store.transaction(db => ({ value: view(requireCase(db, id)), changed: false })); }
  async plan(id) { return this.store.transaction(db => { const item = requireCase(db, id); return { value: analyze(item, this.catalogLookup(item.recordId)), changed: false }; }); }
  async evidence(id) {
    return this.store.transaction(db => {
      const item = requireCase(db, id);
      const record = item.sourceSnapshot;
      const current = this.catalogLookup(item.recordId);
      return { changed: false, value: {
        caseId: item.caseId, revision: item.revision, synthetic: true,
        catalogEvidence: [{ ...record, evidenceRole: 'snapshot_saved_at_case_creation' }],
        currentCatalogEvidence: [{ ...current, evidenceRole: 'current_bundled_snapshot_not_live_web' }],
        snapshotChanged: current.snapshotId !== item.snapshotId,
        observations: Object.entries(item.productFacts).map(([field, value]) => ({ field, value, sourceKind: 'client_supplied_synthetic_observation', independentlyVerified: false })),
        unknowns: ['Personal eligibility', 'Current manufacturer claim requirements', 'Any actual benefit or payment'], limitations: LIMITATIONS,
      } };
    });
  }
  async recordFacts(input) {
    if (input.confirmation !== 'SAVE SYNTHETIC FACTS') throw new Error('Exact synthetic facts confirmation required.');
    const productFacts = verifyFacts(input.model, input.batch);
    return this.store.transaction(db => {
      const item = requireCase(db, input.caseId);
      if (item.revision !== input.expectedRevision) throw new Error('Refusing stale revision; resume the case before changing it.');
      if (JSON.stringify(productFacts) === JSON.stringify(item.productFacts)) return { value: view(item), changed: false };
      amend(item, 'facts_recorded');
      item.productFacts = productFacts;
      item.completedLocalSteps = [];
      return { value: view(item), changed: true };
    });
  }
  async mark(input) {
    if (input.confirmation !== 'MARK LOCAL STEP') throw new Error('Exact local step confirmation required.');
    if (!localStep.safeParse(input.stepId).success) throw new Error('Only a listed local step can be marked; no claims, remedy receipt or money actions.');
    return this.store.transaction(db => {
      const item = requireCase(db, input.caseId);
      if (item.revision !== input.expectedRevision) throw new Error('Refusing stale revision; resume the case before changing it.');
      if (item.completedLocalSteps.includes(input.stepId)) return { value: view(item), changed: false };
      if (analyze(item, this.catalogLookup(item.recordId)).nextStep.id !== input.stepId) throw new Error('That local step is not the current next step. Resolve missing facts or prior steps first.');
      amend(item, 'local_step_marked');
      item.completedLocalSteps.push(input.stepId);
      return { value: view(item), changed: true };
    });
  }
}
