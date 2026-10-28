import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = join(root, 'website', 'src', 'content', 'docs');
const tempRoot = await mkdtemp(join(root, 'website', '.docs-check-'));
const samplesRoot = join(tempRoot, 'samples');
const samples = [];
const skipped = [];

async function findMdxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findMdxFiles(path);
    return entry.isFile() && entry.name.endsWith('.mdx') ? [path] : [];
  }));
  return nested.flat();
}

try {
  const files = (await findMdxFiles(docsRoot)).sort();

  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    const lines = contents.split(/\r?\n/);
    let inTypeScript = false;
    let blockLines = [];
    let firstLine = 0;

    for (let i = 0; i < lines.length; i++) {
      if (!inTypeScript && /^```(?:typescript|ts)\s*$/.test(lines[i])) {
        inTypeScript = true;
        firstLine = i + 2;
        blockLines = [];
      } else if (inTypeScript && /^```\s*$/.test(lines[i])) {
        const label = `${relative(root, file).split(sep).join('/')}:${firstLine}`;
        if (blockLines[0]?.trim().startsWith('// docs-check: skip')) {
          skipped.push(label);
        } else {
          samples.push({ label, file, line: firstLine, code: blockLines.join('\n') });
        }
        inTypeScript = false;
      } else if (inTypeScript) {
        blockLines.push(lines[i]);
      }
    }
  }

  await mkdir(samplesRoot, { recursive: true });
  const labelByPath = new Map();

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const path = join(samplesRoot, `${String(i + 1).padStart(3, '0')}.ts`);
    await writeFile(path, `${sample.code}\n\nexport {};\n`, 'utf8');
    labelByPath.set(resolve(path).toLowerCase(), sample);
  }

  const globalsPath = join(tempRoot, 'globals.d.ts');
  await writeFile(globalsPath, [
    'type D1Database = any;',
    'type ExecutionContext = any;',
    'interface DurableObjectId { toString(): string; equals(other: DurableObjectId): boolean; name?: string; }',
    'type DurableObjectStub<T = unknown> = { id: DurableObjectId; name?: string } & T;',
    'interface DurableObjectNamespace<T = unknown> { newUniqueId(options?: { jurisdiction?: string }): DurableObjectId; idFromName(name: string): DurableObjectId; idFromString(id: string): DurableObjectId; get(id: DurableObjectId): DurableObjectStub<T>; }',
    'type ScheduledEvent = any;',
    'type NextRequest = any;',
    'type Env = any;',
    'declare const ChatCops: typeof import("@chatcops/widget").default;',
    'declare const gtag: (command: "event", eventName: string) => void;',
    'declare const Bun: { serve(options: { port: number; idleTimeout?: number; fetch: (request: Request, server: { requestIP(request: Request): { address?: string } | null }) => Response | Promise<Response> }): unknown };',
    'declare const Deno: { env: { get(name: string): string | undefined }; serve(options: { port?: number }, handler: (request: Request, info: Deno.ServeHandlerInfo) => Response | Promise<Response>): unknown };',
    'declare namespace Deno { interface NetAddr { hostname: string; } interface ServeHandlerInfo { remoteAddr: NetAddr; } }',
    'declare module "@cloudflare/workers-types";',
    'declare module "@neondatabase/serverless" { export function neon(url: string): any; }',
    'declare module "next/server" { export const NextResponse: any; export type NextRequest = any; }',
    'declare module "hono" { export class Hono { on(methods: string | string[], path: string, handler: (context: { req: { raw: Request } }) => unknown): void; } }',
    'declare module "node-cron" { export function schedule(expression: string, callback: () => void): unknown; }',
    '',
  ].join('\n'), 'utf8');

  const packagePath = (name, subpath = 'index.d.ts') => join(root, 'packages', name, 'dist', subpath);
  const paths = {
    '@chatcops/core': [packagePath('core')],
    '@chatcops/core/*': [packagePath('core', '*')],
    '@chatcops/server': [packagePath('server')],
    '@chatcops/server/*': [packagePath('server', '*')],
    '@chatcops/widget': [packagePath('widget')],
    '@chatcops/store-postgres': [packagePath('store-postgres')],
    '@chatcops/store-redis': [packagePath('store-redis')],
    '@chatcops/store-sqlite': [packagePath('store-sqlite')],
    '@chatcops/store-cloudflare': [packagePath('store-cloudflare')],
    '@chatcops/store-upstash-vector': [packagePath('store-upstash-vector')],
    '@chatcops/ingest': [packagePath('ingest')],
    '@chatcops/cli': [packagePath('cli')],
    express: [join(root, 'packages', 'server', 'node_modules', '@types', 'express', 'index.d.ts')],
    '@neondatabase/serverless': [join(root, 'packages', 'store-postgres', 'node_modules', '@neondatabase', 'serverless')],
    '@upstash/vector': [join(root, 'packages', 'store-upstash-vector', 'node_modules', '@upstash', 'vector')],
    '@upstash/redis': [join(root, 'packages', 'store-redis', 'node_modules', '@upstash', 'redis')],
    '@upstash/redis/*': [join(root, 'packages', 'store-redis', 'node_modules', '@upstash', 'redis', '*')],
    ioredis: [join(root, 'packages', 'store-redis', 'node_modules', 'ioredis')],
  };
  const tsconfigPath = join(tempRoot, 'tsconfig.json');
  await writeFile(tsconfigPath, JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ES2022',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      types: ['node'],
      typeRoots: [join(root, 'packages', 'store-postgres', 'node_modules', '@types')],
      baseUrl: root,
      paths,
      noEmit: true,
    },
    include: [join(samplesRoot, '**/*.ts'), globalsPath],
  }, null, 2), 'utf8');

  const tscPath = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [
    tscPath,
    '--pretty', 'false',
    '--project', tsconfigPath,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

  const diagnostics = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (diagnostics) {
    const lines = diagnostics.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^(.+\.ts)\((\d+),(\d+)\): error (TS\d+): (.*)$/);
      if (!match) {
        console.error(line);
        continue;
      }
      const sample = labelByPath.get(resolve(match[1]).toLowerCase());
      if (sample) {
        const originalLine = sample.line + Number(match[2]) - 1;
        console.error(`${sample.label.replace(/:\d+$/, `:${originalLine}`)}: error ${match[4]}: ${match[5]}`);
      } else {
        console.error(line);
      }
    }
  }

  console.log(`Checked ${samples.length} TypeScript blocks; skipped ${skipped.length}.`);
  if (skipped.length > 0) console.log(`Skipped: ${skipped.join(', ')}`);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
