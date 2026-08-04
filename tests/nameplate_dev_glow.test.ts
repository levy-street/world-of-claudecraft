import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const painter = readFileSync(
  new URL('../src/render/nameplate_painter.ts', import.meta.url),
  'utf8',
);
const canvas = readFileSync(new URL('../src/render/nameplate_canvas.ts', import.meta.url), 'utf8');

describe('dev-tier canvas nameplate glow stays crisp (#1639)', () => {
  it('resolves the significant-contributor outline independently from the name color', () => {
    expect(painter).toContain(
      'state.devOutline = showDevBadges ? devTierNameOutlineColor(entity.devTier ?? 0) : null;',
    );
    expect(canvas).toContain('devOutline: string | null');
  });

  it('draws one bounded colored outline pass, then the normal legibility sprite', () => {
    expect(canvas).toContain(
      "devStyle.stroke = this.forcedColorsActive() ? 'Highlight' : state.devOutline;",
    );
    expect(canvas).toContain('devStyle.lineWidth = 4;');
    expect(canvas).toContain('this.text.draw(this.ctx, state.name, nameX, bottomY - 3, devStyle);');
    expect(canvas).toContain(
      'this.text.draw(this.ctx, state.name, nameX, bottomY - 3, nameStyle);',
    );
    expect(canvas).not.toContain('shadowBlur = 4');
  });
});
