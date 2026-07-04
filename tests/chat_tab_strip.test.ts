import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source guards for the #1365 chat tab-strip fix. The behavior is otherwise only
// reachable in a live browser, so these pin the load-bearing declarations: a future
// edit that reintroduces the wrap, unpins the add button, or drops the mobile
// touch-pan (the exact regressions this PR fixes) fails here instead of silently.
const hud = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');

// First declaration block for an exact `selector {` (not a descendant/pseudo rule).
function block(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('chat tab strip layout (issue #1365)', () => {
  it('#chatlog-tabs stays a single nowrap row that scrolls horizontally on overflow', () => {
    const b = block(hud, '#chatlog-tabs');
    expect(b).toMatch(/flex-wrap:\s*nowrap/);
    expect(b).toMatch(/overflow-x:\s*auto/);
  });

  it('the add-channel button stays pinned inline (never drops to its own row)', () => {
    expect(block(hud, '.chat-tab-add')).toMatch(/position:\s*sticky/);
  });

  it('desktop suppresses the browser touch gesture on the move-handle strip', () => {
    expect(block(hud, '#chatlog-tabs')).toMatch(/touch-action:\s*none/);
  });

  it('mobile keeps the strip horizontally swipeable so overflowed tabs stay reachable', () => {
    expect(block(mobile, 'body.mobile-touch #chatlog-tabs')).toMatch(/touch-action:\s*pan-x/);
  });
});
