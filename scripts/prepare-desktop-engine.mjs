#!/usr/bin/env node
/**
 * Copies the built Koda CLI engine into apps/desktop/koda-engine
 * so electron-builder can bundle it for macOS/Windows installers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const engineRoot = path.join(repoRoot, 'apps', 'desktop', 'koda-engine');
const distDir = path.join(repoRoot, 'dist');
const binDir = path.join(repoRoot, 'bin');
const nodeModules = path.join(repoRoot, 'node_modules');
const pkgPath = path.join(repoRoot, 'package.json');

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: true, force: true });
}

if (!fs.existsSync(distDir)) {
  console.error('Missing dist/. Run `pnpm build` at the repo root first.');
  process.exit(1);
}

if (!fs.existsSync(binDir)) {
  console.error('Missing bin/. Run `pnpm build` at the repo root first.');
  process.exit(1);
}

if (!fs.existsSync(nodeModules)) {
  console.error('Missing node_modules/. Run `pnpm install` at the repo root first.');
  process.exit(1);
}

console.log('Preparing Koda engine bundle for desktop…');
rmrf(engineRoot);
fs.mkdirSync(engineRoot, { recursive: true });

copyDir(distDir, path.join(engineRoot, 'dist'));
copyDir(binDir, path.join(engineRoot, 'bin'));
copyDir(nodeModules, path.join(engineRoot, 'node_modules'));

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const runtimePkg = {
  name: pkg.name,
  version: pkg.version,
  type: pkg.type,
  private: true,
  dependencies: pkg.dependencies,
};
fs.writeFileSync(path.join(engineRoot, 'package.json'), JSON.stringify(runtimePkg, null, 2));

console.log(`Engine bundle ready: ${engineRoot}`);
