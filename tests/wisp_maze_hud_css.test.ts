import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps maze instruments nonblocking and restores combat bar geometry with a touch-sized exit', () => {
  const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.wisp-maze-hud\s*\{[^}]*pointer-events:\s*none/);
  expect(css).toMatch(/\.wisp-maze-leave\s*\{[^}]*min-height:\s*40px/);
  expect(css).toMatch(/body\.playing-wisp-maze\s*:is\([^}]+visibility:\s*hidden/);
  expect(css).toMatch(/\.wisp-maze-power\s*\{[^}]*forced-color-adjust:\s*none/);
  expect(mobile).toMatch(/body\.mobile-touch \.wisp-maze-hud\s*\{[^}]*transform:\s*none/);
});
