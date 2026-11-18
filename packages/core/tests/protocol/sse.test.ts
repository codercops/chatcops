import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.js';
import { encodeSSE, SSE_DONE, SSE_HEADERS, SSE_PING } from '../../src/protocol/index.js';
import type { WirePart } from '../../src/protocol/index.js';

describe('SSE encoder and constants', () => {
  describe('public exports', () => {
    it('exports all SSE utilities from @chatcops/core package entry', () => {
      expect(core.encodeSSE).toBe(encodeSSE);
      expect(core.SSE_PING).toBe(SSE_PING);
      expect(core.SSE_DONE).toBe(SSE_DONE);
      expect(core.SSE_HEADERS).toBe(SSE_HEADERS);
    });
  });

  describe('A. Basic event formatting', () => {
    it('encodes a representative WirePart with data: <json>\\n\\n format', () => {
      const part: WirePart = {
        type: 'text-delta',
        id: 't1',
        delta: 'Hello, world!',
      };

      const encoded = encodeSSE(part);
      const expectedJson = JSON.stringify(part);

      expect(encoded).toBe(`data: ${expectedJson}\n\n`);
      expect(encoded.endsWith('\n\n')).toBe(true);
      expect(encoded.startsWith('data: ')).toBe(true);

      const jsonPayload = encoded.slice('data: '.length, -2);
      expect(JSON.parse(jsonPayload)).toEqual(part);
    });

    it('encodes a custom record as well', () => {
      const record = { foo: 'bar', count: 42 };
      const encoded = encodeSSE(record);
      expect(encoded).toBe(`data: ${JSON.stringify(record)}\n\n`);
    });
  });

  describe('B. Newline and carriage-return handling', () => {
    it('escapes line breaks within the serialized JSON payload and keeps a single data: line', () => {
      const multilineText = 'first line\nsecond line\rthird line\r\nfourth line';
      const part: WirePart = {
        type: 'text-delta',
        id: 't2',
        delta: multilineText,
      };

      const encoded = encodeSSE(part);

      // Verify that the frame ends with exactly \n\n and has no other raw newlines
      expect(encoded.endsWith('\n\n')).toBe(true);

      const frameWithoutTerminator = encoded.slice(0, -2);
      // There must be only one physical data: line (no embedded newlines before the \n\n terminator)
      expect(frameWithoutTerminator.includes('\n')).toBe(false);
      expect(frameWithoutTerminator.includes('\r')).toBe(false);

      // The JSON payload should contain escaped sequences (\n, \r) rather than raw control characters
      expect(frameWithoutTerminator).toContain('\\n');
      expect(frameWithoutTerminator).toContain('\\r');

      // Parsing the serialized JSON extracts the original text exactly
      const jsonPayload = frameWithoutTerminator.slice('data: '.length);
      const parsed = JSON.parse(jsonPayload) as WirePart;
      expect(parsed).toEqual(part);
      if (parsed.type === 'text-delta') {
        expect(parsed.delta).toBe(multilineText);
      }
    });
  });

  describe('C. U+2028 and U+2029 round-trip handling', () => {
    it('preserves U+2028 and U+2029 by parsing JSON back out of the frame', () => {
      const textWithSeparators = 'before\u2028middle\u2029after';
      const part: WirePart = {
        type: 'text-delta',
        id: 't3',
        delta: textWithSeparators,
      };

      const encoded = encodeSSE(part);

      // Extract JSON payload from data: frame
      expect(encoded.startsWith('data: ')).toBe(true);
      expect(encoded.endsWith('\n\n')).toBe(true);

      const rawJson = encoded.slice('data: '.length, -2);
      const decoded = JSON.parse(rawJson) as WirePart;

      // Maintainer rule: compare decoded result back to original string,
      // not by matching raw string representation.
      expect(decoded).toEqual(part);
      if (decoded.type === 'text-delta') {
        expect(decoded.delta).toBe(textWithSeparators);
        expect(decoded.delta.includes('\u2028')).toBe(true);
        expect(decoded.delta.includes('\u2029')).toBe(true);
      }
    });
  });

  describe('D. Header values', () => {
    it('provides the exact standard SSE headers with correct values and no Connection property', () => {
      expect(SSE_HEADERS).toEqual({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });

      expect(SSE_HEADERS['Content-Type']).toBe('text/event-stream; charset=utf-8');
      expect(SSE_HEADERS['Cache-Control']).toBe('no-cache, no-transform');
      expect(SSE_HEADERS['X-Accel-Buffering']).toBe('no');

      // The Connection header must be absent (HTTP/2 incompatibility)
      expect('Connection' in SSE_HEADERS).toBe(false);
      expect((SSE_HEADERS as Record<string, unknown>).Connection).toBeUndefined();

      // Verify immutability
      expect(Object.isFrozen(SSE_HEADERS)).toBe(true);
    });
  });

  describe('E. Ping and completion constants', () => {
    it('defines exact SSE_PING and SSE_DONE strings', () => {
      expect(SSE_PING).toBe(': ping\n\n');
      expect(SSE_DONE).toBe('data: [DONE]\n\n');
    });
  });
});
