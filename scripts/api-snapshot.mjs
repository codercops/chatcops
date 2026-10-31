// The public API of each package, written to api/<package>.api.md from the
// built .d.ts files: every export of every entry in package.json "exports",
// with comments left out so only type changes show. CI runs it with --check
// and fails when the API changed without the snapshot being updated.
//
//   node scripts/api-snapshot.mjs           # write api/*.api.md (after pnpm -r build)
//   node scripts/api-snapshot.mjs --check   # fail if they're out of date
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(root, 'api');
const check = process.argv.includes('--check');
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/** Each entry's .d.ts: `./locales/*` becomes one file per locale. */
function entries(dir, exportsMap) {
  const found = [];
  for (const [key, value] of Object.entries(exportsMap ?? {})) {
    const types = typeof value === 'string' ? undefined : (value.types ?? value.import?.types);
    if (!types) continue;
    if (!types.includes('*')) {
      found.push({ key, file: join(dir, types) });
      continue;
    }
    // `./dist/locales/*.d.ts`: the folder before the star, the file ending after it.
    const [folderPath, ending] = types.split('*');
    const folder = join(dir, folderPath);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).sort()) {
      if (!name.endsWith(ending)) continue;
      const stem = name.slice(0, -ending.length);
      found.push({ key: key.replace('*', stem), pattern: key, file: join(folder, name) });
    }
  }
  return found;
}

const isPrivate = (member) =>
  (member.name && ts.isPrivateIdentifier(member.name)) ||
  (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private) !== 0;

/** A class without its private members, which aren't part of the API. */
function publicPart(declaration) {
  if (!ts.isClassDeclaration(declaration)) return declaration;
  return ts.factory.updateClassDeclaration(
    declaration,
    declaration.modifiers,
    declaration.name,
    declaration.typeParameters,
    declaration.heritageClauses,
    declaration.members.filter((member) => !isPrivate(member))
  );
}

const memberName = (member) =>
  ts.isPropertySignature(member) && member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
    ? member.name.text
    : undefined;

/**
 * Object types the compiler wrote out itself (such as a zod schema's inferred
 * type) list their properties in an order that changes between a clean and
 * an incremental build. The order means nothing to the type, so properties
 * of anonymous object types are sorted. Interfaces keep their source order.
 */
function sortTypeLiterals(node) {
  const result = ts.transform(node, [
    (context) => (root) => {
      const visit = (child) => {
        const next = ts.visitEachChild(child, visit, context);
        if (!ts.isTypeLiteralNode(next)) return next;
        const named = next.members.filter((member) => memberName(member) !== undefined);
        const others = next.members.filter((member) => memberName(member) === undefined);
        named.sort((a, b) => memberName(a).localeCompare(memberName(b)));
        return context.factory.updateTypeLiteralNode(next, context.factory.createNodeArray([...named, ...others]));
      };
      return ts.visitNode(root, visit);
    },
  ]);
  const [transformed] = result.transformed;
  result.dispose();
  return transformed;
}

/** A declaration as it reads in a .d.ts, without `export`/`default`. */
function print(original) {
  const sourceFile = original.getSourceFile();
  const declaration = sortTypeLiterals(publicPart(original));
  if (ts.isVariableDeclaration(declaration)) {
    const list = original.parent;
    const keyword = list.flags & ts.NodeFlags.Const ? 'const' : list.flags & ts.NodeFlags.Let ? 'let' : 'var';
    return `declare ${keyword} ${printer.printNode(ts.EmitHint.Unspecified, declaration, sourceFile)};`;
  }
  return printer
    .printNode(ts.EmitHint.Unspecified, declaration, sourceFile)
    .replace(/^export\s+/, '')
    .replace(/^default\s+/, '');
}

function nameOf(declaration) {
  return declaration.name && ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
}

const resolve = (checker, symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);

/**
 * The package's own types that `declarations` name, outside private class
 * members: they're part of the API even when no entry exports them.
 */
function referencedTypes(checker, declarations, ownDir) {
  const found = new Set();
  const visit = (node) => {
    if (ts.isClassElement(node) && isPrivate(node)) return;
    const name = ts.isTypeReferenceNode(node)
      ? node.typeName
      : ts.isExpressionWithTypeArguments(node)
        ? node.expression
        : ts.isTypeQueryNode(node)
          ? node.exprName
          : undefined;
    if (name) {
      const symbol = checker.getSymbolAtLocation(ts.isQualifiedName(name) ? name.right : name);
      const target = symbol && resolve(checker, symbol);
      const own = target?.declarations?.some((d) =>
        d.getSourceFile().fileName.replaceAll('\\', '/').startsWith(`${ownDir.replaceAll('\\', '/')}/`)
      );
      if (own && !(target.flags & ts.SymbolFlags.TypeParameter)) found.add(target);
    }
    ts.forEachChild(node, visit);
  };
  for (const declaration of declarations) visit(declaration);
  return found;
}

const declarationsOf = (symbol) => (symbol.declarations ?? []).filter((d) => !ts.isSourceFile(d));

/**
 * Every export of one entry, sorted by name, and the symbols it exports.
 * A default export's own name isn't part of the API, so it reads `_default`.
 */
function apiOf(checker, sourceFile) {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return { text: '', exported: [] };
  const blocks = [];
  const exports = checker.getExportsOfModule(moduleSymbol).sort((a, b) => a.name.localeCompare(b.name));
  for (const symbol of exports) {
    const declarations = declarationsOf(resolve(checker, symbol));
    if (declarations.length === 0) {
      blocks.push(`export { ${symbol.name} };`);
      continue;
    }
    let text = declarations.map(print).join('\n');
    let declared = nameOf(declarations[0]) ?? '?';
    if (symbol.name === 'default' && declared !== '?') {
      text = text.replace(new RegExp(`\\b${declared}\\b`), '_default');
      declared = '_default';
    }
    blocks.push(declared === symbol.name ? `export ${text}` : `${text}\nexport { ${declared} as ${symbol.name} };`);
  }
  return { text: blocks.join('\n\n'), exported: exports.map((symbol) => resolve(checker, symbol)) };
}

/** The package's own types that its API uses but no entry exports, printed once. */
function internalTypes(checker, exported, ownDir) {
  const exportedSet = new Set(exported);
  const queue = [];
  const queued = new Set();
  const follow = (symbol) => {
    for (const found of referencedTypes(checker, declarationsOf(symbol), ownDir)) {
      if (exportedSet.has(found) || queued.has(found)) continue;
      queued.add(found);
      queue.push(found);
    }
  };
  for (const symbol of exported) follow(symbol);
  for (let i = 0; i < queue.length; i++) follow(queue[i]);
  return queue
    .map((symbol) => ({ name: symbol.name, text: declarationsOf(symbol).map(print).join('\n') }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.text.localeCompare(b.text))
    .map((item) => item.text)
    .join('\n\n');
}

function snapshot(packageDir) {
  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const list = entries(packageDir, pkg.exports);
  const missing = list.filter((entry) => !existsSync(entry.file));
  if (list.length === 0 || missing.length) {
    throw new Error(`${pkg.name}: no built types at ${missing.map((m) => relative(root, m.file)).join(', ') || 'any entry'}. Run pnpm -r build first.`);
  }
  const program = ts.createProgram(
    list.map((entry) => entry.file),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      types: ['node'],
      skipLibCheck: true,
      noEmit: true,
      strict: true,
    }
  );
  const checker = program.getTypeChecker();

  const sections = [];
  const allExported = [];
  const patterns = new Map();
  for (const entry of list) {
    const { text: api, exported } = apiOf(checker, program.getSourceFile(entry.file));
    allExported.push(...exported);
    if (entry.pattern) {
      // Files of one pattern (every locale) are listed once while they match.
      const seen = patterns.get(entry.pattern);
      if (seen && seen.api === api) {
        seen.keys.push(entry.key);
        continue;
      }
      if (!seen) {
        const group = { api, keys: [entry.key], pattern: entry.pattern };
        patterns.set(entry.pattern, group);
        sections.push(group);
        continue;
      }
    }
    sections.push({ api, keys: [entry.key] });
  }

  const title = (keys) => keys.map((key) => `\`${key === '.' ? pkg.name : `${pkg.name}${key.slice(1)}`}\``).join(', ');
  const heading = (section) =>
    section.pattern && section.keys.length > 1
      ? `## ${title([section.pattern])}\n\nThe same for each of: ${section.keys.map((key) => `\`${key.split('/').pop()}\``).join(', ')}.`
      : `## ${title(section.keys)}`;
  let body = sections.map((section) => `${heading(section)}\n\n\`\`\`ts\n${section.api}\n\`\`\``).join('\n\n');
  const internal = internalTypes(checker, allExported, join(packageDir, 'dist'));
  if (internal) body += `\n\n## Types no entry exports\n\nThey're part of the API above all the same: a change to one is a change to the API.\n\n\`\`\`ts\n${internal}\n\`\`\``;
  return {
    name: pkg.name,
    file: join(apiDir, `${basename(packageDir)}.api.md`),
    text: `# ${pkg.name} public API\n\nMade by \`node scripts/api-snapshot.mjs\` from the built types. Don't edit it by hand: change the code, build, and run the script again.\n\n${body}\n`,
  };
}

const packagesDir = join(root, 'packages');
const results = readdirSync(packagesDir)
  .filter((dir) => existsSync(join(packagesDir, dir, 'package.json')))
  .sort()
  .map((dir) => snapshot(join(packagesDir, dir)));

if (!check) {
  mkdirSync(apiDir, { recursive: true });
  for (const result of results) writeFileSync(result.file, result.text);
  console.log(`Wrote ${results.length} API snapshots to api/.`);
} else {
  const stale = results.filter((result) =>
    !existsSync(result.file) || readFileSync(result.file, 'utf8').replaceAll('\r\n', '\n') !== result.text
  );
  if (stale.length === 0) {
    console.log(`The API snapshots of ${results.length} packages are up to date.`);
  } else {
    for (const result of stale) {
      const shown = relative(root, result.file);
      console.error(`\n${result.name}: the public API changed, and ${shown} wasn't updated.`);
      if (existsSync(result.file)) {
        const next = join(root, 'node_modules', '.cache', `${result.name.replace('/', '__')}.api.md`);
        mkdirSync(dirname(next), { recursive: true });
        writeFileSync(next, result.text);
        spawnSync('diff', ['-u', result.file, next], { stdio: 'inherit' });
      }
    }
    console.error(
      '\nIf the change is meant to happen, run `node scripts/api-snapshot.mjs` and commit api/. ' +
        'Before 1.0 that is fine; after it, a change here needs a changeset of the right size.'
    );
    process.exit(1);
  }
}
