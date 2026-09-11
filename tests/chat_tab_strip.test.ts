import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source guards for the #1365 chat tab-strip fix. The behavior is otherwise only
// reachable in a live browser, so these pin the load-bearing declarations: a future
// edit that reintroduces the wrap, unpins the add button, or drops the mobile
// touch-pan (the exact regressions this PR fixes) fails here instead of silently.
const hud = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');
const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const play = readFileSync(new URL('../play.html', import.meta.url), 'utf8');

// First declaration block for an exact `selector {` (not a descendant/pseudo rule).
function block(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('chat tab strip layout (issue #1365)', () => {
  it('composes the shared panel, tabs, and input primitives in both entries', () => {
    for (const html of [index, play]) {
      expect(html).toContain('<div id="chatlog-tabs" class="ui-tabs" role="tablist"></div>');
      expect(html).toContain('<div id="chatlog-frame" class="panel ui-panel-soft">');
      expect(html).toContain('<textarea id="chat-input" class="ui-input"');
    }
  });

  it('keeps the chat tabs at the board height without overriding the primitive look', () => {
    const tab = block(hud, '.chat-tab');
    expect(tab).toMatch(/height:\s*22px/);
    expect(tab).not.toMatch(/(?:background|border|box-shadow|color|font-family|text-shadow)\s*:/);
  });

  it('leaves the composer look to the shared input primitive', () => {
    const input = block(hud, '#chat-input');
    expect(input).not.toMatch(
      /(?:background|border|box-shadow|color|border-radius|font|font-family)\s*:/,
    );
  });

  it('keeps the themed two-pixel focus ring outside every tab', () => {
    const focus = block(hud, '.chat-tab:focus-visible');
    expect(focus).toMatch(/outline:\s*2px solid var\(--color-border-focus\)/);
    expect(focus).toMatch(/outline-offset:\s*2px/);
  });

  it('multiplies the default chat opacity by the soft factor and restores it on interaction', () => {
    expect(hud).toContain('var(--chat-opacity, 1) * var(--chat-soft, 0.74)');
    expect(hud).toMatch(/#chatlog-wrap:hover #chatlog-frame,/);
    expect(hud).toMatch(/#chatlog-wrap:focus-within #chatlog-frame,/);
    expect(hud).toMatch(/body:has\(#chat-input:hover\) #chatlog-frame,/);
    expect(hud).toMatch(/body:has\(#chat-input:focus\) #chatlog-frame\s*{[^}]*--chat-soft:\s*1/s);
  });

  it('keeps chat numerals tabular and gives the focused composer a strong fill', () => {
    expect(block(hud, '.chat-pane div')).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(hudSource).toContain("ts.className = 'chat-ts ui-faint ui-num';");
    expect(block(hud, '#chat-input:focus-visible')).toMatch(
      /background:\s*var\(--panel-bg-strong\)/,
    );
  });

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

  it('mobile drops the desktop down-scale so the tabs are not shrunk below the floor', () => {
    // The desktop scale(0.92) put the 22px tabs at ~20px, far under the 40px floor.
    expect(block(mobile, 'body.mobile-touch #chatlog-tabs')).toMatch(/transform:\s*none/);
  });

  it('mobile chat tabs meet the 40px touch floor with larger text', () => {
    const tab = block(mobile, 'body.mobile-touch .chat-tab');
    expect(tab).toMatch(/min-height:\s*40px/);
    expect(tab).toMatch(/font-size:\s*16px/);
  });

  it('the mobile add-channel button meets the 40x40 touch floor', () => {
    // width from the .chat-tab-add rule, height inherited from the .chat-tab rule above.
    expect(block(mobile, 'body.mobile-touch .chat-tab-add')).toMatch(/min-width:\s*40px/);
    expect(block(mobile, 'body.mobile-touch .chat-tab')).toMatch(/min-height:\s*40px/);
  });
});
