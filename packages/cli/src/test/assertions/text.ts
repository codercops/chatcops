import type { AssertionCheck } from '../types.js';
import { asStrings, quoted } from './values.js';

/** `contains: "$19"` or `contains: [Team, "$19"]`: the reply has every one of them. */
export const contains: AssertionCheck = (value, turn) => {
  const wanted = asStrings(value, 'contains');
  const missing = wanted.filter((text) => !turn.text.includes(text));
  return missing.length
    ? { pass: false, reason: `the reply doesn't contain ${quoted(missing)}` }
    : { pass: true, reason: `the reply contains ${quoted(wanted)}` };
};
