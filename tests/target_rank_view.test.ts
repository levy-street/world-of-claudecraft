import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { targetRankView, targetUsesEliteFrame } from '../src/ui/target_rank_view';

describe('targetRankView', () => {
  it('keeps the numeric level for normal and elite targets', () => {
    const normal = targetRankView(MOBS.forest_wolf);
    const elite = targetRankView(MOBS.crypt_shambler);
    expect(normal).toBe('normal');
    expect(elite).toBe('elite');
    expect(targetUsesEliteFrame(normal)).toBe(false);
    expect(targetUsesEliteFrame(elite)).toBe(true);
  });

  it('gives boss rank precedence and keeps the Elite frame family', () => {
    const rank = targetRankView(MOBS.morthen);
    expect(rank).toBe('boss');
    expect(targetUsesEliteFrame(rank)).toBe(true);
  });

  it('keeps a boss visually elite when content omits the redundant elite flag', () => {
    const rank = targetRankView({ boss: true });
    expect(rank).toBe('boss');
    expect(targetUsesEliteFrame(rank)).toBe(true);
  });

  it('wires boss rank to a decodable dragon frame without a Unicode icon', async () => {
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const rankView = readFileSync(
      new URL('../src/ui/target_rank_view.ts', import.meta.url),
      'utf8',
    );
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const play = readFileSync(new URL('../play.html', import.meta.url), 'utf8');
    const emblemUrl = new URL('../public/ui/ranks/elite-dragon-frame.webp', import.meta.url);
    const emblem = readFileSync(emblemUrl);
    const metadata = await sharp(emblem).metadata();
    const center = await sharp(emblem)
      .ensureAlpha()
      .extract({ left: 83, top: 72, width: 91, height: 91 })
      .raw()
      .toBuffer();
    const ruleBody = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
    };
    expect(hud + rankView + css + index + play).not.toMatch(/[\u2620\u{1F480}]/u);
    expect(emblem.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(emblem.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(metadata).toMatchObject({ width: 256, height: 256, hasAlpha: true });
    let transparentPixels = 0;
    let sampledPixels = 0;
    for (let y = 0; y < 91; y++) {
      for (let x = 0; x < 91; x++) {
        if ((x - 45) ** 2 + (y - 45) ** 2 > 45 ** 2) continue;
        sampledPixels++;
        if (center[(y * 91 + x) * 4 + 3] === 0) transparentPixels++;
      }
    }
    expect(transparentPixels / sampledPixels).toBeGreaterThan(0.98);
    expect(css).toContain('url("/ui/ranks/elite-dragon-frame.webp")');
    expect(ruleBody('#target-frame.boss .portrait canvas')).not.toContain('display: none;');
    expect(hud).toContain('const faceUrl = targetPortraitUrl(');
    const levelChip = ruleBody('#target-frame.boss .level-chip');
    expect(levelChip).toContain('transform: translateX(-50%);');
    expect(levelChip).not.toContain('display: none;');
  });
});
