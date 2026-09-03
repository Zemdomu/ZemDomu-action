import { glob } from 'glob';

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
    const matches = await glob(normalizeGlobPattern(rawPattern), {
      dot: false,
      follow: false,
      ignore: '**/node_modules/**',
      nodir: true,
    });
    matches.sort(comparePaths);
    for (const match of matches) files.add(match.replace(/\\/g, '/'));
  }
  return Array.from(files).sort(comparePaths);
}
