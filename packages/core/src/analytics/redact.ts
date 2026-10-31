export interface RedactOptions {
  /** Extra patterns, each replaced with `[redacted]`. */
  patterns?: RegExp[];
}

// Every pattern below starts with a lookbehind, so a match can only begin at the start of a token. Without
// it, a long run of characters that nearly matches would be rescanned from each position, and the cost
// would grow with the square of the text length. The repeats inside the patterns all have an upper bound.

const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;

// Two letters, two check digits, then 11 to 30 more letters or digits, in groups of four when spaced.
const IBAN = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])/gi;

// Colons with up to four hex digits between them, and an optional IPv4 tail (`::ffff:192.0.2.1`).
const IPV6 = /(?<![0-9A-Za-z:.])(?:[0-9A-Fa-f]{0,4}:){2,7}(?:[0-9A-Fa-f]{0,4}|\d{1,3}(?:\.\d{1,3}){3})(?![0-9A-Za-z:]|\.\d)/g;

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
// Exactly four parts: `1.1.1` and `1.2.3.4.5` are version numbers.
const IPV4 = new RegExp(`(?<![\\d.])(?:${OCTET}\\.){3}${OCTET}(?!\\.?\\d)`, 'g');

// 13 to 19 digits in one run, or in groups (4-4-4-4, 4-6-5, 4-6-4) joined by the same space or dash.
const CARD = /(?<!\d)(?:\d{13,19}|\d{4}([ -])\d{4,6}\1\d{4,6}(?:\1\d{1,7})?)(?!\d)/g;

const PHONES = [
  // E.164: `+`, then 8 to 15 digits, with spaces, dots, dashes or brackets between them.
  /(?<![\w+])\+(?:[ .\-()]{0,2}\d){8,15}(?!\d)/g,
  // (415) 555-0100, with an optional leading 1.
  /(?<![\w(])(?:1[ .-])?\(\d{3}\)[ .-]?\d{3}[ .-]\d{4}(?!\d|[-.]\d)/g,
  // 415-555-0100, 415 555 0100, 415.555.0100, with an optional leading 1.
  /(?<![\d-])(?:1([ .-]))?\d{3}([ .-])\d{3}\2\d{4}(?!\d|[-.]\d)/g,
  // 020 7946 0958, 0161-496-0000: a leading 0, then two more groups. Dots are left out, as in `01.234.567`.
  /(?<![\d-])0\d{1,4}([ -])\d{3,4}\1\d{3,4}(?!\d|-\d)/g,
  // 07911 123456
  /(?<![\d-])0\d{3,4} \d{6}(?!\d)/g,
];

function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

function isIbanValid(iban: string): boolean {
  if (iban.length < 15 || iban.length > 34) return false;
  const moved = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of moved) {
    // Digits stay as they are; A is 10, B is 11, up to Z at 35.
    const value = char >= 'A' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/** An IBAN can be followed by a short word that the pattern also took: drop trailing groups until it checks out. */
function redactIban(candidate: string): string {
  let head = candidate;
  for (;;) {
    if (isIbanValid(head.replace(/ /g, '').toUpperCase())) return `[iban]${candidate.slice(head.length)}`;
    const cut = head.lastIndexOf(' ');
    if (cut === -1) return candidate;
    head = head.slice(0, cut);
  }
}

function isIPv6(candidate: string): boolean {
  let address = candidate;
  let groups = 0;
  const tail = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (tail) {
    const v4 = tail[1] as string;
    if (!new RegExp(`^(?:${OCTET}\\.){3}${OCTET}$`).test(v4)) return false;
    address = `${address.slice(0, address.length - v4.length)}0:0`;
  }
  if (!/[0-9A-Fa-f]/.test(address)) return false;
  const halves = address.split('::');
  for (const half of halves) {
    if (half === '') continue;
    for (const group of half.split(':')) {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(group)) return false;
      groups++;
    }
  }
  // Written out in full it has eight groups; with `::` standing in for at least one, fewer.
  return halves.length === 2 ? groups <= 7 : groups === 8;
}

function withGlobal(pattern: RegExp): RegExp {
  // `y` would stop at the first gap, and without `g` only the first match is replaced.
  const flags = pattern.flags.replace('y', '');
  return new RegExp(pattern.source, flags.includes('g') ? flags : `${flags}g`);
}

/**
 * Takes personal data out of `text`: email addresses, phone numbers, card numbers (Luhn-checked), IBANs
 * (mod-97-checked) and IP addresses, each replaced with a tag such as `[email]`. Patterns in
 * `options.patterns` run first, so they win over the built-in ones.
 *
 * It is best effort and leans towards leaving text alone: a plain run of digits, a price, a date or a
 * version number is not touched. Names, addresses and anything written in free text are not found.
 */
export function redactPII(text: string, options: RedactOptions = {}): string {
  let out = text;
  for (const pattern of options.patterns ?? []) {
    out = out.replace(withGlobal(pattern), (match) => (match === '' ? match : '[redacted]'));
  }
  out = out.replace(EMAIL, '[email]');
  out = out.replace(IBAN, redactIban);
  out = out.replace(IPV6, (match) => (isIPv6(match) ? '[ip]' : match));
  out = out.replace(IPV4, '[ip]');
  out = out.replace(CARD, (match) => {
    const digits = match.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && isLuhnValid(digits) ? '[card]' : match;
  });
  for (const phone of PHONES) out = out.replace(phone, '[phone]');
  return out;
}
