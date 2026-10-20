import { glob } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';

const comparePaths = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function normalizeGlobPattern(pattern: string): string {
  return pattern.replace(/\\/g, '/');
}

export function parseGlobPatterns(input: string): string[] {
  const patterns: string[] = [];
  let current = '';
  let braceDepth = 0;
  for (const character of input) {
    if (character === '{') braceDepth++;
    if (character === '}' && braceDepth > 0) braceDepth--;
    if (braceDepth === 0 && (character === ',' || /\s/.test(character))) {
      if (current) patterns.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (current) patterns.push(current);
  return patterns;
}

export async function discoverFiles(patterns: readonly string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const rawPattern of patterns) {
    const pattern = normalizeGlobPattern(rawPattern);
    // Permit literal ancestors such as macOS /var, but do not follow directory
    // links discovered while expanding a wildcard.
    const magic = pattern.search(/[*?{\[]/);
    const literalRoot = path.resolve(magic < 0 ? path.dirname(pattern) : pattern.slice(0, magic).replace(/[^/]*$/, '') || '.');
    for await (const entry of glob(pattern, {
      withFileTypes: true,
      exclude: (entry) => {
        if (entry.name === 'node_modules') return true;
        if (!entry.isSymbolicLink()) return false;
        try {
          const absolute = path.join(entry.parentPath, entry.name);
          if (literalRoot === absolute || literalRoot.startsWith(absolute + path.sep)) return false;
          return !statSync(absolute).isFile();
        } catch {
          return true;
        }
      },
    })) {
      const absolute = path.join(entry.parentPath, entry.name);
      if (entry.isDirectory() || absolute.split(path.sep).includes('node_modules')) continue;
      try {
        if (!statSync(absolute).isFile()) continue;
      } catch {
        continue;
      }
      const match = path.isAbsolute(pattern) ? absolute : path.relative(process.cwd(), absolute);
      files.add(match.replace(/\\/g, '/'));
    }
  }
  return Array.from(files).sort(comparePaths);
}
