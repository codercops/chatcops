import { describe, expect, it } from 'vitest';
import { redactPII } from '../../src/analytics/redact.js';

const same = (text: string) => expect(redactPII(text)).toBe(text);

describe('redactPII: email', () => {
  it('replaces email addresses', () => {
    expect(redactPII('Write to jane.doe+news@example.com please')).toBe('Write to [email] please');
    expect(redactPII('a@b.co')).toBe('[email]');
    expect(redactPII('first_last@mail.sub-domain.example.org.')).toBe('[email].');
    expect(redactPII('x@a.io and y@b.io')).toBe('[email] and [email]');
  });

  it('leaves look-alikes alone', () => {
    same('Follow us @chatcops on social');
    same('user@localhost');
    same('Meet at 5 @ the cafe');
    same('name@ example.com');
  });
});

describe('redactPII: phone', () => {
  it('replaces E.164 numbers, with or without separators', () => {
    expect(redactPII('Call +14155550100 now')).toBe('Call [phone] now');
    expect(redactPII('Call +44 20 7946 0958.')).toBe('Call [phone].');
    expect(redactPII('+1-415-555-0100')).toBe('[phone]');
    expect(redactPII('+49.30.901820')).toBe('[phone]');
    expect(redactPII('+1 (415) 555-0100')).toBe('[phone]');
  });

  it('replaces local formats that have separators', () => {
    expect(redactPII('(415) 555-0100')).toBe('[phone]');
    expect(redactPII('(415)555-0100')).toBe('[phone]');
    expect(redactPII('415-555-0100')).toBe('[phone]');
    expect(redactPII('415 555 0100')).toBe('[phone]');
    expect(redactPII('415.555.0100')).toBe('[phone]');
    expect(redactPII('1-415-555-0100')).toBe('[phone]');
    expect(redactPII('020 7946 0958')).toBe('[phone]');
    expect(redactPII('0161-496-0000')).toBe('[phone]');
    expect(redactPII('07911 123456')).toBe('[phone]');
    expect(redactPII('My number is 415-555-0100, thanks')).toBe('My number is [phone], thanks');
  });

  it('leaves look-alikes alone', () => {
    same('Order 12345678');
    same('Order 4155550100');
    same('It costs $1,234.56');
    same('Due 2026-10-31 at 14:05');
    same('Version 1.2.3 and 10.150.200');
    same('SSN 123-45-6789');
    same('Page 03-10-2026');
    same('+123456');
    same('+12345678901234567');
  });
});

describe('redactPII: card', () => {
  it('replaces card numbers that pass the Luhn check', () => {
    expect(redactPII('Card 4111111111111111 expires soon')).toBe('Card [card] expires soon');
    expect(redactPII('4111 1111 1111 1111')).toBe('[card]');
    expect(redactPII('4111-1111-1111-1111')).toBe('[card]');
    expect(redactPII('3782 822463 10005')).toBe('[card]');
    expect(redactPII('378282246310005')).toBe('[card]');
    expect(redactPII('6011 1111 1111 1117')).toBe('[card]');
    expect(redactPII('4222222222222')).toBe('[card]');
    expect(redactPII('6200000000000000000')).toBe('[card]');
  });

  it('leaves look-alikes alone', () => {
    same('Card 4111111111111112');
    same('4111 1111 1111 1112');
    same('ID 12345678901234567890');
    same('Dates 2026-10-31 2026-11-30');
    same('Tracking 1234567890');
    same('4111 1111 1111-1111');
    same('4111 1111 1117');
  });
});

describe('redactPII: iban', () => {
  it('replaces IBANs that pass the mod-97 check', () => {
    expect(redactPII('Pay to GB82 WEST 1234 5698 7654 32 today')).toBe('Pay to [iban] today');
    expect(redactPII('DE89370400440532013000')).toBe('[iban]');
    expect(redactPII('FR14 2004 1010 0505 0001 3M02 606')).toBe('[iban]');
    expect(redactPII('NO93 8601 1117 947')).toBe('[iban]');
    expect(redactPII('gb82 west 1234 5698 7654 32')).toBe('[iban]');
  });

  it('keeps words that follow the IBAN', () => {
    expect(redactPII('IBAN BE68 5390 0754 7034 and BIC')).toBe('IBAN [iban] and BIC');
    expect(redactPII('GB82 WEST 1234 5698 7654 32 pls')).toBe('[iban] pls');
  });

  it('leaves look-alikes alone', () => {
    same('GB82 WEST 1234 5698 7654 33');
    same('DE89370400440532013001');
    same('AB12 CDEF GHIJ');
    same('GB82WEST12345698765432X');
    same('NO93 8601 1117 94');
  });
});

describe('redactPII: ip', () => {
  it('replaces IPv4 addresses', () => {
    expect(redactPII('Server 192.168.1.10 is down')).toBe('Server [ip] is down');
    expect(redactPII('from 8.8.8.8.')).toBe('from [ip].');
    expect(redactPII('0.0.0.0 and 255.255.255.255')).toBe('[ip] and [ip]');
  });

  it('replaces IPv6 addresses', () => {
    expect(redactPII('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('[ip]');
    expect(redactPII('at 2001:db8::1 now')).toBe('at [ip] now');
    expect(redactPII('::1')).toBe('[ip]');
    expect(redactPII('fe80::')).toBe('[ip]');
    expect(redactPII('::ffff:192.0.2.1')).toBe('[ip]');
    expect(redactPII('Is it ::1?')).toBe('Is it [ip]?');
  });

  it('leaves look-alikes alone', () => {
    same('Version 1.1.1');
    same('Version 1.2.3.4.5');
    same('Release 256.1.1.1');
    same('Release 1.2.3.999');
    same('Time 14:05 and 14:05:30');
    same('std::vector and Foo::bar');
    same('Ratio 1:2:3');
    same('Mac 00:1a:2b:3c:4d:5e');
    same('1:2:3:4:5:6:7:8:9');
    same('2001:db8::1::2');
    same('::ffff:192.0.2.999');
    same('::');
  });
});

describe('redactPII: combined', () => {
  it('replaces several kinds in one sentence', () => {
    expect(
      redactPII('Email jo@example.com or call (415) 555-0100; card 4111 1111 1111 1111, IBAN DE89370400440532013000, from 10.0.0.7.'),
    ).toBe('Email [email] or call [phone]; card [card], IBAN [iban], from [ip].');
  });

  it('does not let an IBAN be read as a card, or an email as a phone number', () => {
    expect(redactPII('DE89 3704 0044 0532 0130 00')).toBe('[iban]');
    expect(redactPII('4155550100@example.com')).toBe('[email]');
  });

  it('returns text with nothing to redact as it is', () => {
    expect(redactPII('')).toBe('');
    same('Hello, how can I reset my password?');
  });
});

describe('redactPII: options.patterns', () => {
  it('replaces every match of a global pattern', () => {
    expect(redactPII('ORD-1 and ORD-22 and ORD-333', { patterns: [/ORD-\d+/g] })).toBe('[redacted] and [redacted] and [redacted]');
  });

  it('replaces every match of a non-global pattern too', () => {
    expect(redactPII('ORD-1 and ORD-22 and ORD-333', { patterns: [/ORD-\d+/] })).toBe('[redacted] and [redacted] and [redacted]');
  });

  it('keeps other flags, drops sticky, and runs each pattern', () => {
    expect(redactPII('Secret, secret, SECRET', { patterns: [/secret/i] })).toBe('[redacted], [redacted], [redacted]');
    expect(redactPII('ab ab', { patterns: [/ab/y] })).toBe('[redacted] [redacted]');
    expect(redactPII('cat dog', { patterns: [/cat/, /dog/] })).toBe('[redacted] [redacted]');
  });

  it('does not change a pattern it was given, so calls give the same result', () => {
    const pattern = /ORD-\d+/g;
    const text = 'ORD-1 ORD-2';
    expect(redactPII(text, { patterns: [pattern] })).toBe('[redacted] [redacted]');
    expect(redactPII(text, { patterns: [pattern] })).toBe('[redacted] [redacted]');
    expect(pattern.lastIndex).toBe(0);
  });

  it('ignores a pattern that matches nothing, including an empty match', () => {
    expect(redactPII('abc', { patterns: [/x*/g] })).toBe('abc');
    expect(redactPII('abc', { patterns: [/zzz/] })).toBe('abc');
  });

  it('runs before the built-in patterns', () => {
    expect(redactPII('id 415-555-0100', { patterns: [/id \d{3}-\d{3}-\d{4}/] })).toBe('[redacted]');
  });
});

describe('redactPII: long input', () => {
  const LENGTH = 100_000;
  const shapes: Record<string, string> = {
    'plain text': 'lorem ipsum dolor sit amet '.repeat(Math.ceil(LENGTH / 27)),
    letters: 'a'.repeat(LENGTH),
    'letters and dots': 'a.'.repeat(LENGTH / 2),
    'email-like': 'a.b-c_d+e%'.repeat(LENGTH / 10),
    digits: '1'.repeat(LENGTH),
    'digits and spaces': '1 '.repeat(LENGTH / 2),
    'digits and dashes': '1-'.repeat(LENGTH / 2),
    'groups of four': '4111 '.repeat(LENGTH / 5),
    'IBAN-like': 'GB82 '.repeat(LENGTH / 5),
    colons: ':'.repeat(LENGTH),
    'hex and colons': 'ab:'.repeat(LENGTH / 3),
    dots: '.'.repeat(LENGTH),
    'ip-like': '1.'.repeat(LENGTH / 2),
    pluses: '+'.repeat(LENGTH),
    'plus and spaces': '+ '.repeat(LENGTH / 2),
    'plus and digits': '+1 '.repeat(LENGTH / 3),
    'brackets and digits': '(1) '.repeat(LENGTH / 4),
    ats: '@'.repeat(LENGTH),
    'at signs': 'a@'.repeat(LENGTH / 2),
  };

  for (const [name, text] of Object.entries(shapes)) {
    it(`finishes quickly on ${LENGTH} characters of ${name}`, () => {
      const start = performance.now();
      redactPII(text);
      expect(performance.now() - start).toBeLessThan(1000);
    });
  }

  it('finds an email at the end of a long text', () => {
    expect(redactPII(`${'x '.repeat(50_000)}jo@example.com`).endsWith('x [email]')).toBe(true);
  });
});
