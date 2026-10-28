/** Helpers for reading an assertion's value. A bad value throws, and the assertion fails with the message. */

/** A string or a non-empty list of strings, as a list. */
export function asStrings(value: unknown, name: string): string[] {
  const list = Array.isArray(value) ? value : [value];
  if (!list.length || list.some((item) => typeof item !== 'string')) throw new Error(`${name} takes a string or a list of strings`);
  return list as string[];
}

/** `"a", "b"`, for reasons. */
export function quoted(texts: string[]): string {
  return texts.map((text) => JSON.stringify(text)).join(', ');
}

/** A number of 0 or more, such as a token, millisecond or dollar limit. */
export function asLimit(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name} takes a number of 0 or more`);
  return value;
}
