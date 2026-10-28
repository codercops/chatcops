import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { globToRegExp } from '@chatcops/ingest';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ConfigError } from '../config.js';
import type { Fixture, TestCase } from './types.js';

export const DEFAULT_PATTERN = 'evals/**/*.chat.yaml';
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '__cassettes__']);

const assertion = z.record(z.unknown()).refine((value) => Object.keys(value).length === 1, {
  message: 'an assertion has exactly one key, such as `contains: "$19"`',
});
const pageContext = z.object({
  url: z.string().url(),
  title: z.string(),
  description: z.string().optional(),
  contentSnippet: z.string().optional(),
});
const toolResult = z.object({ success: z.boolean(), data: z.unknown().optional(), message: z.string().optional() });
const common = {
  tags: z.array(z.string()).optional(),
  locale: z.string().optional(),
  pageContext: pageContext.optional(),
  userData: z.record(z.string()).optional(),
  mocks: z.object({ tools: z.record(toolResult).optional() }).strict().optional(),
  repeat: z.number().int().min(1).max(100).optional(),
  passRate: z.number().min(0).max(1).optional(),
};
const turn = z.object({ user: z.string().min(1), expect: z.array(assertion).optional() }).strict();
const testCase = z.object({ name: z.string().min(1), turns: z.array(turn).min(1), ...common }).strict();
const fixtureSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    defaults: z.object(common).strict().optional(),
    tests: z.array(testCase).min(1),
  })
  .strict();

/** A fixture file, checked, with defaults applied to each test. */
export async function loadFixture(file: string): Promise<Fixture> {
  let raw: unknown;
  try {
    if (/\.ya?ml$/i.test(file)) {
      raw = parseYaml(await readFile(file, 'utf8'));
    } else {
      raw = ((await import(pathToFileURL(file).href)) as { default?: unknown }).default;
    }
  } catch (error) {
    throw new ConfigError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = fixtureSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new ConfigError(`${file} isn't a valid eval file:\n${issues.join('\n')}`);
  }
  const fixture = parsed.data as Fixture;
  return { ...fixture, tests: fixture.tests.map((test) => withDefaults(test, fixture.defaults)) };
}

function withDefaults(test: TestCase, defaults: Fixture['defaults']): TestCase {
  if (!defaults) return test;
  return {
    ...defaults,
    ...test,
    mocks: { tools: { ...defaults.mocks?.tools, ...test.mocks?.tools } },
  };
}

/** Files under `cwd` matching any of the globs (relative to `cwd`). */
export async function findFixtures(cwd: string, patterns: string[]): Promise<string[]> {
  const regexes = patterns.map((pattern) => globToRegExp(pattern.replace(/^\.\//, '')));
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        const path = relative(cwd, join(dir, entry.name)).split(sep).join('/');
        if (regexes.some((regex) => regex.test(path))) found.push(resolve(cwd, path));
      }
    }
  }
  await walk(cwd);
  return found.sort();
}

/** `--filter`: a substring of the test name, or `tag:<name>`. */
export function matchesFilter(test: TestCase, filter: string | undefined): boolean {
  if (!filter) return true;
  if (filter.startsWith('tag:')) return test.tags?.includes(filter.slice(4)) ?? false;
  return test.name.toLowerCase().includes(filter.toLowerCase());
}
