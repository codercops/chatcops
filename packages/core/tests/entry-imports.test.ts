import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Importing anything from @chatcops/core must not load a provider SDK: it costs
// startup time on every serverless cold start. createProvider() loads the SDK it
// needs with import(), and the provider classes are imported from subpaths.
// This reads the built output, so it needs `pnpm build` first.

const PACKAGE_DIR = join(import.meta.dirname, '..');
const DIST = join(PACKAGE_DIR, 'dist');
const SDK_PACKAGES = ['@anthropic-ai/sdk', 'openai', '@google/genai'];

// `import x from 'a'`, `import 'a'`, `export { x } from 'a'`, `export * from 'a'`.
// A dynamic `import('a')` has no `from` and no quote right after `import`, so it never matches.
const STATIC_IMPORT = /(?:^|\n)[ \t]*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function staticSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(STATIC_IMPORT)].map((m) => m[1]);
}

function isSdk(specifier: string): boolean {
  return SDK_PACKAGES.some((sdk) => specifier === sdk || specifier.startsWith(`${sdk}/`));
}

/** Follows static relative imports from `entry`. Returns reached files and any SDK imports found. */
function walk(entry: string) {
  const reached = new Set<string>();
  const sdkImports: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    for (const specifier of staticSpecifiers(file)) {
      if (isSdk(specifier)) {
        sdkImports.push(`${file.slice(DIST.length + 1)} imports ${specifier}`);
      } else if (specifier.startsWith('.')) {
        queue.push(resolve(dirname(file), specifier));
      }
    }
  }
  return { reached, sdkImports };
}

describe('@chatcops/core entry point', () => {
  it('has been built', () => {
    expect(existsSync(join(DIST, 'index.js')), 'dist/index.js is missing, run `pnpm build` first').toBe(true);
  });

  it('does not statically import a provider SDK', () => {
    const { reached, sdkImports } = walk(join(DIST, 'index.js'));

    // Guards against the walk silently reaching nothing.
    expect(reached).toContain(join(DIST, 'providers', 'base.js'));
    expect(reached).toContain(join(DIST, 'knowledge', 'index.js'));

    expect(sdkImports).toEqual([]);
  });

  it('finds the SDK imports when starting from a provider module', () => {
    for (const [name, sdk] of [['claude', '@anthropic-ai/sdk'], ['openai', 'openai'], ['gemini', '@google/genai']]) {
      const { sdkImports } = walk(join(DIST, 'providers', `${name}.js`));
      expect(sdkImports.join('\n')).toContain(sdk);
    }
  });

  it('exports each provider class from its own subpath', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'));
    for (const name of ['claude', 'openai', 'gemini']) {
      const entry = pkg.exports[`./providers/${name}`];
      expect(entry, `exports["./providers/${name}"]`).toBeDefined();
      expect(existsSync(join(PACKAGE_DIR, entry.import)), entry.import).toBe(true);
      expect(existsSync(join(PACKAGE_DIR, entry.types)), entry.types).toBe(true);
    }
  });
});
