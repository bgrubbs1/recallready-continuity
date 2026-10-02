import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPublicSource, PUBLIC_API_URL, PUBLIC_SOURCE_URL } from '../src/public-source.mjs';

const record = {
  RecallID: 9555, RecallNumber: '23145', URL: 'https://www.cpsc.gov/Recalls/2023/YETI-Recalls-1-9-Million-Soft-Coolers-and-Gear-Cases-Due-to-Magnet-Ingestion-Hazard',
  Title: 'YETI public recall fixture', LastPublishDate: '2023-03-09T00:00:00',
  Remedies: [{ Name: 'Synthetic API fixture: return for replacement or refund as a YETI gift card.' }],
  RemedyOptions: [{ Option: 'Refund' }, { Option: 'Replace' }],
  ConsumerContact: 'CONTACT FIELD MUST NOT BE EXPOSED',
};
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8' } });

test('source check is disabled by default and takes no arbitrary record or URL', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response([record]); };
  await assert.rejects(() => checkPublicSource({ fetchImpl }), /disabled/);
  await assert.rejects(() => checkPublicSource({ enabled: true, recordId: 'DEMO-KETTLE-01', fetchImpl }), /bundled CPSC-23-145/);
  assert.equal(calls, 0);
});

test('positive check uses fixed GET, preserves detail vs category and separates receipt date', async () => {
  let calls = 0;
  const before = Date.now();
  const actual = await checkPublicSource({ enabled: true, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://www.saferproducts.gov/RestWebServices/Recall?RecallNumber=23145&format=json');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.authorization, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return response([record]);
  } });
  assert.equal(calls, 1);
  assert.equal(actual.verificationStatus, 'fetched_and_identity_checked');
  assert.ok(Date.parse(actual.checkedAt) >= before);
  assert.equal(actual.upstreamLastPublishDate, '2023-03-09T00:00:00');
  assert.equal(actual.upstreamDateTimezone, 'not_specified_in_api_value');
  assert.deepEqual(actual.remedyCategories, ['Refund', 'Replace']);
  assert.deepEqual(actual.detailedRemedy, [record.Remedies[0].Name]);
  assert.equal(actual.cashStatus, 'cash_not_verified');
  assert.equal(actual.interpretationNeeded, true);
  assert.equal(actual.caseOrCatalogMutated, false);
  assert.ok(!JSON.stringify(actual).includes('CONTACT FIELD'));
});

test('timeout fails closed even if injected fetch ignores abort', async () => {
  let signal;
  await assert.rejects(() => checkPublicSource({ enabled: true, timeoutMs: 20, fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}); } }), /timed out/);
  assert.equal(signal.aborted, true);
  let cancelled = false;
  await assert.rejects(() => checkPublicSource({ enabled: true, timeoutMs: 20, fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }) }), /timed out/);
  assert.equal(cancelled, true);
});

test('non200, redirect, bad JSON and wrong content type never produce a verified receipt', async () => {
  const scenarios = [
    [() => new Response('private upstream detail', { status: 503 }), /HTTP 503/],
    [() => new Response('', { status: 302, headers: { location: 'https://untrusted.example.invalid/' } }), /redirect/],
    [() => ({ ok: true, status: 200, redirected: true }), /redirect/],
    [() => new Response('{broken', { headers: { 'content-type': 'application/json' } }), /valid JSON/],
    [() => new Response('[]', { headers: { 'content-type': 'text/html' } }), /content type/],
  ];
  for (const [make, expected] of scenarios) await assert.rejects(() => checkPublicSource({ enabled: true, fetchImpl: async () => make() }), expected);
});

test('oversize declared and streamed bodies are rejected', async () => {
  await assert.rejects(() => checkPublicSource({ enabled: true, fetchImpl: async () => new Response('[]', { headers: { 'content-type': 'application/json', 'content-length': '40000' } }) }), /size limit/);
  await assert.rejects(() => checkPublicSource({ enabled: true, fetchImpl: async () => new Response('x'.repeat(40000), { headers: { 'content-type': 'application/json' } }) }), /size limit/);
});

test('record count, identity, URL and required details are checked exactly', async () => {
  for (const payload of [[], [record, record], [{ ...record, RecallID: 1 }], [{ ...record, RecallNumber: '23146' }], [{ ...record, URL: 'https://www.cpsc.gov.evil.example.invalid/' }], [{ ...record, Remedies: [] }], [{ ...record, LastPublishDate: 'yesterday' }]]) {
    await assert.rejects(() => checkPublicSource({ enabled: true, fetchImpl: async () => response(payload) }), /identity|exactly one|details|date/);
  }
  assert.ok(PUBLIC_API_URL.startsWith('https://www.saferproducts.gov/'));
  assert.equal(PUBLIC_SOURCE_URL, record.URL);
});
