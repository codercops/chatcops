import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');
const packagePaths = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')))
  .sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((entry) => ['src', 'tests']
    .map((directory) => join(packagesDir, entry.name, directory))
    .filter((directory) => existsSync(directory))
    .map((directory) => relative(root, directory).split(sep).join('/')));
const paths = [...packagePaths, 'website/src'];
const biome = join(root, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
const result = spawnSync(process.execPath, [biome, 'check', ...paths], {
  cwd: root,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Failed to run Biome: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
