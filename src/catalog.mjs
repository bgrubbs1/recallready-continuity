import { digest } from './integrity.mjs';

// Only deliberate fixtures/public source facts live here. No household inventory.
export const MODEL_VALUES = ['unknown', 'K100', 'K200', 'Hopper M20', 'Hopper M30 1.0', 'Hopper M30 2.0', 'SideKick Dry', 'Other model'];
export const BATCH_VALUES = ['unknown', 'A1', 'B9', 'not_published'];
const publicUrl = 'https://www.cpsc.gov/Recalls/2023/YETI-Recalls-1-9-Million-Soft-Coolers-and-Gear-Cases-Due-to-Magnet-Ingestion-Hazard';
const records = [
  {
    id: 'DEMO-KETTLE-01', title: 'Fictional kettle recall — deterministic test fixture',
    sourceKind: 'synthetic_fixture', sourceUrl: 'recallready://catalog/DEMO-KETTLE-01',
    sourceCheckedAt: '2026-10-02T00:00:00Z', sourcePublishedAt: null,
    affectedModels: ['K100'], affectedBatches: ['A1'],
    factSummary: 'Fictional example: model K100, batch A1. This is not a real recall or product.',
    safetyNotice: 'Synthetic fixture only. Never use these instructions for a real product.',
    remedy: { kinds: ['replacement'], cashPaymentVerified: false, summary: 'Fictional replacement route. No real claim or benefit exists.' },
    proofRequirements: 'unverified', deadline: 'unverified',
  },
  {
    id: 'CPSC-23-145', title: 'YETI soft coolers and gear cases — public CPSC snapshot',
    sourceKind: 'official_public_snapshot', sourceUrl: publicUrl,
    sourceCheckedAt: '2026-10-02T04:19:15Z', sourcePublishedAt: '2023-03-09',
    verificationMethod: 'Official CPSC page text retrieved with a web tool and reviewed 2026-10-02; retrieved text may be cached. Not a live manufacturer-offer or personal-eligibility check.',
    sourceUpdateNote: 'CPSC page says remedy section updated 2026-07-22.',
    affectedModels: ['Hopper M20', 'Hopper M30 1.0', 'Hopper M30 2.0', 'SideKick Dry'],
    affectedBatches: null,
    factSummary: 'CPSC recall 23-145 covers specified YETI soft coolers and gear cases with magnet-lined closures.',
    safetyNotice: 'CPSC instructs owners of recalled products to stop using them and contact YETI. Detached magnets pose an ingestion hazard.',
    remedy: { kinds: ['replacement', 'brand_gift_card'], cashPaymentVerified: false, summary: 'The current CPSC remedy text describes free return for replacement or refund in the form of a YETI gift card; do not call it cash.' },
    proofRequirements: 'unverified from this snapshot; inspect the current manufacturer process yourself',
    deadline: 'unverified; absence of a listed date is not a guarantee that no deadline applies',
  },
];
for (const record of records) {
  record.snapshotId = digest(record);
  Object.freeze(record);
}
export const RECORD_IDS = records.map(x => x.id);
export function getRecord(id) {
  const record = records.find(x => x.id === id);
  if (!record) throw new Error('Unknown catalog record. Choose a listed record, not a URL.');
  return structuredClone(record);
}
export function listCatalog() {
  return records.map(({ id, title, sourceKind, sourceUrl, sourceCheckedAt, snapshotId }) => ({ id, title, sourceKind, sourceUrl, sourceCheckedAt, snapshotId }));
}
