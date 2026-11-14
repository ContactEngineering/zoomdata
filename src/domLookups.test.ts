import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

// Components take their elements through options, so several viewers can
// share a page and frameworks can own the DOM. The only lookup by id is the
// convenience of passing the main canvas' id to ZoomData.start().
it('looks up elements by id only in ZoomData.start', () => {
  const lookups: string[] = [];
  for (const file of readdirSync(__dirname)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const lines = readFileSync(resolve(__dirname, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/getElementById|querySelector/.test(line)) lookups.push(`${file}:${i + 1}`);
    });
  }
  expect(lookups).toHaveLength(1);
  expect(lookups[0]).toMatch(/^ZoomData\.ts:/);
});
