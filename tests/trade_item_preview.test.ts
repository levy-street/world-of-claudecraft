import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-scan guard (the honor_ui.test.ts style): the trade window is inline DOM in
// hud.ts with no pure core to unit-test, so pin the item-preview wiring here so a
// future edit cannot silently drop the hover-to-inspect behavior on trade items.
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('trade item preview', () => {
  const start = hud.indexOf('private updateTradeWindow(');
  const body = hud.slice(
    start,
    hud.indexOf('private ', start + 'private updateTradeWindow('.length),
  );

  it('found the updateTradeWindow body to scan', () => {
    expect(start).toBeGreaterThan(0);
    expect(body.length).toBeGreaterThan(200);
  });

  it('carries a data-item on BOTH the mine and theirs rows so either can be inspected', () => {
    // "mine" stays a clickable button (remove-from-trade); "theirs" is a read-only div
    // made focusable (tabindex) so the inspect tooltip is keyboard- and long-press-reachable.
    expect(body).toContain('class="trade-item mine" data-item=');
    expect(body).toContain('class="trade-item" data-item=');
    expect(body).toContain('tabindex="0"');
  });

  it('attaches the shared item tooltip to every offered item, guarded on a real item', () => {
    expect(body).toMatch(/querySelectorAll\('\.trade-item'\)/);
    expect(body).toContain("ITEMS[(row as HTMLElement).dataset.item ?? '']");
    expect(body).toContain('this.attachTooltip(row as HTMLElement, () => this.itemTooltip(item))');
  });
});
