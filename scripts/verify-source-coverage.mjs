import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';

// Resolve through pinned c8's own dependencies, rather than adding a product dependency.
const require = createRequire(import.meta.url);
const c8Require = createRequire(require.resolve('c8/package.json'));
const { createCoverageMap } = c8Require('istanbul-lib-coverage');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
      ? [fs.realpathSync(file)] : [];
  });
}

function counterKeys(map, counters, label) {
  if (!map || !counters || typeof map !== 'object' || typeof counters !== 'object'
    || Array.isArray(map) || Array.isArray(counters)) {
    throw new Error(`Invalid ${label} coverage counters`);
  }
  const keys = Object.keys(map).sort();
  if (JSON.stringify(keys) !== JSON.stringify(Object.keys(counters).sort())) {
    throw new Error(`Mismatched ${label} coverage counters`);
  }
  return keys;
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function verifyDirectSourceMaps({ projectRoot, buildDirectory }) {
  const root = fs.realpathSync(projectRoot);
  for (const source of sourceFiles(path.join(root, 'src'))) {
    const relative = path.relative(path.join(root, 'src'), source);
    const emitted = path.join(buildDirectory, relative.replace(/\.ts$/, '.js'));
    const mapFile = `${emitted}.map`;
    if (!fs.existsSync(emitted) || !fs.existsSync(mapFile)) {
      throw new Error(`Missing emitted JavaScript or source map for ${relative}`);
    }
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    if (map.version !== 3 || map.file !== path.basename(emitted)
      || !Array.isArray(map.sources) || map.sources.length !== 1
      || typeof map.sources[0] !== 'string'
      || fs.realpathSync(path.resolve(path.dirname(mapFile), map.sourceRoot ?? '', map.sources[0])) !== source
      || !Array.isArray(map.sourcesContent) || map.sourcesContent.length !== 1
      || map.sourcesContent[0] !== fs.readFileSync(source, 'utf8')
      || typeof map.mappings !== 'string' || map.mappings.length === 0) {
      throw new Error(`Invalid direct source map for ${relative}`);
    }
    const js = fs.readFileSync(emitted, 'utf8');
    if (!js.trimEnd().endsWith(`//# sourceMappingURL=${path.basename(mapFile)}`)) {
      throw new Error(`Missing emitted sourceMappingURL for ${relative}`);
    }
  }
}

// Inspect Istanbul's detailed source counters, not rounded summary percentages.
export function verifySourceCoverage({ projectRoot, coverage }) {
  const root = fs.realpathSync(projectRoot);
  const expected = sourceFiles(path.join(root, 'src')).sort();
  if (expected.length === 0) throw new Error('No TypeScript source files found');
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
    throw new Error('Invalid source coverage report');
  }
  const seen = new Set();
  for (const [file, item] of Object.entries(coverage)) {
    const canonical = fs.realpathSync(file);
    if (!expected.includes(canonical)) {
      throw new Error(`Unexpected coverage file outside source inventory: ${file}`);
    }
    if (seen.has(canonical)) throw new Error(`Duplicate source coverage: ${file}`);
    seen.add(canonical);
    if (!item || fs.realpathSync(item.path) !== canonical) {
      throw new Error(`Mismatched coverage source path: ${file}`);
    }
    const statements = counterKeys(item.statementMap, item.s, 'statement');
    const functions = counterKeys(item.fnMap, item.f, 'function');
    const branches = counterKeys(item.branchMap, item.b, 'branch');
    if (statements.length === 0) throw new Error(`Missing source statement counters: ${file}`);
    if (![...Object.values(item.s), ...Object.values(item.f)].every(validCount)) {
      throw new Error(`Invalid source execution counts: ${file}`);
    }
    for (const id of branches) {
      const values = item.b[id];
      if (!Array.isArray(values) || !values.every(validCount)
        || !Array.isArray(item.branchMap[id].locations)
        || values.length !== item.branchMap[id].locations.length) {
        throw new Error(`Invalid source branch counts: ${file}`);
      }
    }
    if (canonical === path.join(root, 'src', 'index.ts')) {
      const branchCounts = Object.values(item.b).flat();
      if (functions.length === 0 || branchCounts.length === 0
        || !Object.values(item.f).some(count => count > 0)
        || !branchCounts.some(count => count > 0)) {
        throw new Error('Action entry point has missing or unexecuted function/branch counters');
      }
    }
  }
  const missing = expected.filter(file => !seen.has(file));
  if (missing.length) throw new Error(`Missing source coverage: ${missing.join(', ')}`);
  return expected.map(file => path.relative(root, file));
}

export function verifyCoverageSummary({ projectRoot, coverage, summary }) {
  const sources = verifySourceCoverage({ projectRoot, coverage });
  const map = createCoverageMap(coverage);
  const expected = { total: map.getCoverageSummary().toJSON() };
  for (const file of map.files()) {
    expected[file] = map.fileCoverageFor(file).toSummary().toJSON();
  }
  // Includes per-file/aggregate counts, skipped values and Istanbul's exact
  // percentages, including line aggregation and empty-metric representation.
  if (!isDeepStrictEqual(summary, expected)) {
    throw new Error('Coverage summary does not match detailed source counters');
  }
  return sources;
}
