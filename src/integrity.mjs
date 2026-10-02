import { createHash } from 'node:crypto';

// JSON field order is not semantic. Schema parsers may reorder optional fields.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
