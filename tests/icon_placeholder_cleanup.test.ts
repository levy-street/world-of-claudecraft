import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { svgIcon } from '../src/ui/ui_icons';

describe('placeholder glyph cleanup', () => {
  const source = (relativePath: string): string =>
    readFileSync(path.join(process.cwd(), relativePath), 'utf8');

  it('ships bold currentColor vector identities for the replaced OS glyphs', () => {
    for (const id of ['promote', 'demote', 'out-of-range', 'next', 'close', 'check'] as const) {
      const svg = svgIcon(id);
      expect(svg, id).toContain('viewBox="0 0 512 512"');
      expect(svg, id).toContain('fill="currentColor"');
      expect(svg, id).toContain('<path');
    }
  });

  it('keeps the exact UI callsites on authored SVGs instead of font glyphs', () => {
    expect(source('src/ui/party_frame_row.ts')).toContain(
      "buildBadge(doc, 'oor', svgIcon('out-of-range'))",
    );
    expect(source('src/ui/party_frame_row.ts')).toContain("leadStar.innerHTML = svgIcon('crown')");
    const social = source('src/ui/social_window.ts');
    expect(social).toContain("svgIcon('promote')");
    expect(social).toContain("svgIcon('demote')");
    expect(social).not.toMatch(/[\u25b2\u25bc]/u);
    expect(source('src/ui/tutorial.ts')).toContain("arrow.innerHTML = svgIcon('next')");
    expect(source('src/ui/char_window.ts')).toContain("unequip.innerHTML = svgIcon('close')");
    expect(source('src/main.ts')).toContain("closeBtn.innerHTML = svgIcon('close')");
    expect(source('src/ui/mobile_wallet_launcher.ts')).toContain(
      "closeBtn.innerHTML = svgIcon('close')",
    );
    expect(source('src/ui/store_promo_card.ts')).toContain("close.innerHTML = svgIcon('close')");
    expect(source('src/ui/hud.ts')).toContain(
      'current === i ? `<span class="ctx-selected">$' + "{svgIcon('check')}</span>` : ''",
    );
  });
});
