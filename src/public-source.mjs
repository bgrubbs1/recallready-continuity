export const PUBLIC_API_URL = 'https://www.saferproducts.gov/RestWebServices/Recall?RecallNumber=23145&format=json';
export const PUBLIC_SOURCE_URL = 'https://www.cpsc.gov/Recalls/2023/YETI-Recalls-1-9-Million-Soft-Coolers-and-Gear-Cases-Due-to-Magnet-Ingestion-Hazard';
const MAX_BYTES = 32_768;

class SourceCheckError extends Error {}
function fail(message) { throw new SourceCheckError(message); }
function boundedText(value, maximum) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function validUpstreamDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

async function readBounded(response, controller) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) fail('Public source response exceeds the size limit.');
  if (!response.body) fail('Public source returned no JSON body.');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  controller.signal.addEventListener('abort', cancel, { once: true });
  const parts = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        controller.abort();
        void reader.cancel().catch(() => {});
        fail('Public source response exceeds the size limit.');
      }
      parts.push(Buffer.from(value));
    }
  } finally { controller.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { fail('Public source response must be valid JSON.'); }
}

/** Fixed, read-only public GET. Does not import or write catalog/case storage. */
export async function checkPublicSource({ enabled = false, recordId = 'CPSC-23-145', fetchImpl = fetch, timeoutMs = 4_000 } = {}) {
  if (enabled !== true) fail('Public source network check is disabled; explicit operator opt-in is required.');
  if (recordId !== 'CPSC-23-145') fail('Only the bundled CPSC-23-145 public source can be checked.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) fail('Invalid public source timeout.');
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new SourceCheckError('Public source check timed out; no source was verified.')); }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(PUBLIC_API_URL, {
        method: 'GET', headers: { accept: 'application/json' }, credentials: 'omit',
        redirect: 'error', cache: 'no-store', signal: controller.signal,
      });
      if (response.redirected || (response.status >= 300 && response.status < 400)) fail('Public source redirects are not allowed.');
      if (response.status !== 200 || !response.ok) fail(`Public source returned HTTP ${response.status}; no source was verified.`);
      if ((response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') fail('Public source returned an unexpected content type.');
      const records = await readBounded(response, controller);
      if (!Array.isArray(records) || records.length !== 1) fail('Public source must return exactly one recall.');
      const record = records[0];
      if (!record || record.RecallID !== 9555 || record.RecallNumber !== '23145' || record.URL !== PUBLIC_SOURCE_URL) fail('Public source recall identity does not match the bundled record.');
      if (!boundedText(record.Title, 800) || !Array.isArray(record.Remedies) || record.Remedies.length < 1 || record.Remedies.length > 5 || !record.Remedies.every(item => boundedText(item?.Name, 4_000)) || !Array.isArray(record.RemedyOptions) || record.RemedyOptions.length < 1 || record.RemedyOptions.length > 10 || !record.RemedyOptions.every(item => boundedText(item?.Option, 100))) fail('Public source remedy details are missing or invalid.');
      if (!validUpstreamDate(record.LastPublishDate)) fail('Public source publication date is invalid.');
      if (controller.signal.aborted) fail('Public source check timed out; no source was verified.');
      return {
        recordId, verificationStatus: 'fetched_and_identity_checked', checkedAt: new Date().toISOString(),
        officialUrl: PUBLIC_SOURCE_URL, apiUrl: PUBLIC_API_URL, sourceTitle: record.Title,
        upstreamLastPublishDate: record.LastPublishDate,
        upstreamDateTimezone: /(?:Z|[+-]\d{2}:\d{2})$/.test(record.LastPublishDate) ? 'specified_in_api_value' : 'not_specified_in_api_value',
        remedyCategories: record.RemedyOptions.map(item => item.Option),
        detailedRemedy: record.Remedies.map(item => item.Name),
        interpretationNeeded: true, cashStatus: 'cash_not_verified',
        interpretation: 'The API category Refund does not establish a cash benefit. Read the detailed remedy and linked notice; gift cards and replacement products are distinct from cash. This check does not establish ownership, eligibility, manufacturer availability, claim approval or payment.',
        caseOrCatalogMutated: false,
      };
    })()]);
  } catch (error) {
    if (error instanceof SourceCheckError) throw error;
    fail('Public source request failed; no source was verified.');
  } finally { clearTimeout(timer); controller.abort(); }
}
