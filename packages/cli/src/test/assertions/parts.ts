import { globToRegExp } from '@chatcops/ingest';
import type { AssertionCheck } from '../types.js';
import { quoted } from './values.js';

/**
 * `cites: "https://acme.test/pricing*"` or a list of URL globs: each one
 * matches a page the reply cites. `cites: true`: it cites at least one.
 */
export const cites: AssertionCheck = (value, turn) => {
  const urls = turn.sources.map((source) => source.url);
  if (value === true) {
    return urls.length ? { pass: true, reason: `the reply cites ${quoted(urls)}` } : { pass: false, reason: 'the reply cites no pages' };
  }
  const globs = [value].flat() as string[];
  if (!globs.length || globs.some((glob) => typeof glob !== 'string')) throw new Error('cites takes true, a URL glob or a list of them');
  const missing = globs.filter((glob) => !urls.some((url) => globToRegExp(glob).test(url)));
  if (!missing.length) return { pass: true, reason: `the reply cites ${quoted(globs)}` };
  const cited = urls.length ? `it cites ${quoted(urls)}` : 'it cites no pages';
  return { pass: false, reason: `the reply doesn't cite ${quoted(missing)} (${cited})` };
};

/**
 * `lead-captured: true`: the turn captured a lead. An object, such as
 * `lead-captured: { email: jane@acme.test }`, also has to match those fields.
 */
export const leadCaptured: AssertionCheck = (value, turn) => {
  const isFields = value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
  if (value !== true && !isFields) throw new Error('lead-captured takes true, or the fields the lead should have');
  if (!turn.leads.length) return { pass: false, reason: 'the turn captured no lead' };
  if (!isFields) return { pass: true, reason: 'the turn captured a lead' };
  const wanted = Object.entries(value as Record<string, unknown>);
  const fields = wanted.map(([key, field]) => `${key} ${JSON.stringify(field)}`).join(', ');
  return turn.leads.some((lead) => wanted.every(([key, field]) => lead[key] === field))
    ? { pass: true, reason: `the turn captured a lead with ${fields}` }
    : { pass: false, reason: `no lead the turn captured has ${fields}` };
};
