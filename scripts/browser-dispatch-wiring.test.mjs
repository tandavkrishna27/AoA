import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BROWSER_DISPATCH_LINKS, inspectBrowserDispatchComposition } from './browser-dispatch-wiring.mjs';
const root = process.cwd();
test('production staged browser composition satisfies every structural link', () => {
  assert.deepEqual(inspectBrowserDispatchComposition(root), []);
});
for (const link of BROWSER_DISPATCH_LINKS) {
  test(`deleting ${link.id} fails even when its source survives in a comment and diagnostic string`, () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'aoa-browser-wiring-'));
    try {
      for (const file of new Set(BROWSER_DISPATCH_LINKS.map(item => item.file))) {
        const destination = path.join(fixture, file);
        mkdirSync(path.dirname(destination), { recursive: true });
        let source = readFileSync(path.join(root, file), 'utf8');
        if (file === link.file) {
          assert.ok(source.includes(link.code), `mutation target exists: ${link.id}`);
          source = source.replace(link.code, '') + '\n/* ' + link.code + ' */\nconst diagnostic = ' + JSON.stringify(link.code) + ';\n';
        }
        writeFileSync(destination, source);
      }
      assert.ok(inspectBrowserDispatchComposition(fixture).some(problem => problem.id === link.id));
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });
}

test('E8-1 enrolls the structural composition instead of a staged-guest caller count', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'scripts/gate-clause-wiring.json'), 'utf8'));
  assert.equal(manifest.clauses['E8-1-sandbox-local-browser'].status, 'wired');
  assert.equal(manifest.clauses['E8-1-sandbox-local-browser'].composition, 'staged_browser_dispatch_v1');
});
