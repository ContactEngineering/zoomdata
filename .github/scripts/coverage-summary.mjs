// Turn coverage/coverage-summary.json into a Markdown table for the job
// summary of a GitHub Actions run.
import { readFileSync } from 'node:fs';

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const metrics = ['lines', 'branches', 'functions', 'statements'];
const pct = (m) => `${m.pct.toFixed(1)}%`;

const rows = Object.entries(summary)
  .filter(([file]) => file !== 'total')
  .map(([file, m]) => [file.slice(file.lastIndexOf('/src/') + 1), m])
  // Files without code, e.g. pure re-exports
  .filter(([, m]) => m.lines.total > 0)
  .sort(([a], [b]) => a.localeCompare(b));

const lines = [
  '## Test coverage',
  '',
  'Unit tests and render tests together.',
  '',
  `| File | ${metrics.map((m) => m[0].toUpperCase() + m.slice(1)).join(' | ')} |`,
  `|---|${metrics.map(() => '--:').join('|')}|`,
  `| **All files** | ${metrics.map((m) => `**${pct(summary.total[m])}**`).join(' | ')} |`,
  ...rows.map(([file, m]) => `| \`${file}\` | ${metrics.map((k) => pct(m[k])).join(' | ')} |`),
];
console.log(lines.join('\n'));
