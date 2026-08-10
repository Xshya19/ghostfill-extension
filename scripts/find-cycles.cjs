/* eslint-disable no-console */
/**
 * Circular dependency detector for the GhostFill background bundle.
 * Usage: node scripts/find-cycles.cjs [--entry src/background/index.ts] [--depth N]
 * Prints all dependency cycles reachable from the entry module.
 */
const ts = require('typescript');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');

const entry =
  process.argv.find((a) => a.startsWith('--entry='))?.split('=')[1] ??
  'src/background/index.ts';
const maxDepth = Number(
  process.argv.find((a) => a.startsWith('--depth='))?.split('=')[1] ?? 60
);

const fileCache = new Map();
const unresolvedMap = new Map();

function resolveModule(fromFile, specifier) {
  if (specifier.startsWith('@types/') || specifier.endsWith('.json')) {
    return [];
  }
  try {
    let resolved;
    if (specifier.startsWith('.')) {
      resolved = path.resolve(path.dirname(fromFile), specifier);
    } else {
      // Try tsconfig paths alias '@'
      const tsconfig = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        tsconfig.config,
        ts.sys,
        root
      );
      const lookup = ts.resolveModuleName(specifier, fromFile, parsed.options, ts.sys);
      if (lookup.resolvedModule) resolved = lookup.resolvedModule.resolvedFileName;
    }
    if (!resolved) return [];
    // If the resolved path already exists as a FILE, use it directly.
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return [path.resolve(resolved).replace(/\\/g, '/')];
    }
    // Otherwise probe extensions regardless of any dot in the basename
    // (e.g. `./email.types` -> `email.types.ts`).
    let found = null;
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      if (fs.existsSync(resolved + ext)) {
        found = resolved + ext;
        break;
      }
    }
    if (!found) {
      for (const idx of ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']) {
        if (fs.existsSync(resolved + idx)) {
          found = resolved + idx;
          break;
        }
      }
    }
    if (!found) {
      const rel = path.relative(root, fromFile).replace(/\\/g, '/');
      if (!unresolvedMap.has(rel)) unresolvedMap.set(rel, []);
      unresolvedMap.get(rel).push(specifier);
      return [];
    }
    return [path.resolve(found).replace(/\\/g, '/')];
  } catch {
    return [];
  }
}

function getImports(file) {
  if (fileCache.has(file)) return fileCache.get(file);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const specifiers = [];
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) {
        specifiers.push(spec.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const resolved = [];
  for (const spec of specifiers) {
    // Skip runtime-only type-ish imports and node_modules that are self-contained
    if (spec.startsWith('@types/')) continue;
    const targets = resolveModule(file, spec);
    resolved.push(...targets);
  }
  // dedupe
  const unique = [...new Set(resolved)];
  fileCache.set(file, unique);
  return unique;
}

const entryFile = path.resolve(root, entry).replace(/\\/g, '/');
const adj = new Map(); // file -> [files]

function collect(file, depth) {
  if (adj.has(file) || depth > maxDepth) return;
  adj.set(file, []);
  const targets = getImports(file).filter(
    (f) => !f.includes('/node_modules/')
  );
  adj.set(file, targets);
  for (const t of targets) collect(t, depth + 1);
}
collect(entryFile, 0);

// Find cycles via DFS with a stack-based coloring algorithm.
const WHITE = 0;
const GRAY = 1;
const BLACK = 2;
const color = new Map();
const stack = [];
const cycles = [];

function dfs(node) {
  color.set(node, GRAY);
  stack.push(node);
  const stackPos = new Map(stack.map((n, i) => [n, i]));
  for (const next of adj.get(node) ?? []) {
    const c = color.get(next) ?? WHITE;
    if (c === WHITE) {
      dfs(next);
    } else if (c === GRAY) {
      const startIdx = stackPos.get(next);
      const cycle = stack.slice(startIdx).concat(next);
      cycles.push(cycle);
    }
  }
  stack.pop();
  color.set(node, BLACK);
}

for (const node of adj.keys()) {
  if ((color.get(node) ?? WHITE) === WHITE) dfs(node);
}

// Deduplicate cycles (same members, rotation-independent)
const seen = new Set();
const uniqueCycles = [];
for (const cyc of cycles) {
  const canon = [...cyc]
    .map((f) => path.relative(root, f).replace(/\\/g, '/'))
    .sort()
    .join(' -> ');
  if (!seen.has(canon)) {
    seen.add(canon);
    uniqueCycles.push(cyc);
  }
}

console.log(`Total modules reachable from ${entry}: ${adj.size}`);
console.log(`Cycles found: ${uniqueCycles.length}\n`);

if (unresolvedMap.size > 0) {
  console.log('⚠️  Unresolved imports (edges may be missing):');
  for (const [file, specs] of unresolvedMap) {
    console.log(`  ${file}: ${specs.join(', ')}`);
  }
  console.log('');
}
uniqueCycles.forEach((cyc, i) => {
  const names = cyc.map((f) => path.relative(root, f).replace(/\\/g, '/'));
  console.log(`Cycle ${i + 1} (${names.length} modules):`);
  console.log('  ' + names.join('\n    -> '));
  console.log('');
});

// Report module load order stats (top 20 modules with most deps)
const sorted = [...adj.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 20);
console.log('Top 20 modules by dependency count:');
for (const [f, deps] of sorted) {
  console.log(
    `  ${path.relative(root, f).replace(/\\/g, '/')} (${deps.length} deps)`
  );
}