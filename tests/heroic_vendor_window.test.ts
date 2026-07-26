import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/ui/hud/vendor/heroic_vendor_window.ts', import.meta.url),
  'utf8',
);

describe('heroic Quartermaster window contracts', () => {
  it('renders an associated roving tab pattern', () => {
    expect(source).toMatch(/role='tab' id='heroic-quartermaster-tab-\$\{tab\}'/);
    expect(source).toMatch(/aria-controls='heroic-quartermaster-panel-\$\{tab\}'/);
    expect(source).toMatch(/tabindex='\$\{selected \? '0' : '-1'\}'/);
    expect(source).toMatch(
      /role='tabpanel' aria-labelledby='heroic-quartermaster-tab-\$\{view\.tab\}'/,
    );
    expect(source).toContain(`aria-orientation='horizontal'`);
  });

  it('supports Arrow, Home, and End navigation and moves focus after activation', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      expect(source).toContain(`event.key === '${key}'`);
    }
    expect(source).toContain('event.preventDefault();');
    expect(source).toContain('deps.onTab(tab);');
    expect(source).toMatch(/querySelector<HTMLElement>\(`\[data-tab='\$\{tab\}'\]`\)\?\.focus\(\)/);
  });

  it('uses procedural preview payloads for Forge art/tooltips and blocks pending actions', () => {
    expect(source).toContain('deps.itemIcon(row.item, row.previewInstance)');
    expect(source).toContain('deps.itemTooltip(row.item, row.previewInstance)');
    expect(source).toContain('row.blockReason !== null || deps.pending');
    expect(source).toContain('!affordable || deps.pending');
  });
});
