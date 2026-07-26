import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/ui/hud/vendor/heroic_vendor_window.ts', import.meta.url),
  'utf8',
);

describe('heroic Quartermaster window contracts', () => {
  it('renders only the existing Heroic Marks gear shop', () => {
    expect(source).toContain(`goodsGrid.className = 'vendor-goods-grid'`);
    expect(source).toContain(`row.className = 'vendor-item'`);
    expect(source).toContain('row.disabled = !affordable');
    expect(source).toContain('deps.onBuy(itemId)');
  });

  it('does not render raid Forge or Legendary tuning controls', () => {
    expect(source).not.toContain('onForge');
    expect(source).not.toContain('onTune');
    expect(source).not.toContain('data-tab');
    expect(source).not.toContain('hq-forge');
  });
});
