import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mobileCss = readFileSync(
  new URL('../src/styles/hud.mobile.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

function ruleBody(selector: RegExp): string {
  return mobileCss.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('mobile aura touch targets', () => {
  it('gives player and Target auras 40px live layout and tap boxes', () => {
    const box = ruleBody(
      /body\.mobile-touch\.game-active :is\(#buff-bar, #debuff-bar, #tf-debuffs\) > \.buff/,
    );

    expect(box).toMatch(/width:\s*40px/);
    expect(box).toMatch(/height:\s*40px/);
    expect(box).toMatch(/background-size:\s*0 0/);
  });

  it('centers the unchanged classic artwork inside the larger hitbox', () => {
    const face = ruleBody(
      /body\.mobile-touch\.game-active :is\(#buff-bar, #debuff-bar, #tf-debuffs\) > \.buff::before/,
    );
    const ownFace = ruleBody(
      /body\.mobile-touch\.game-active :is\(#buff-bar, #debuff-bar, #tf-debuffs\) > \.buff\.own::before/,
    );

    expect(face).toMatch(/width:\s*28px/);
    expect(face).toMatch(/height:\s*28px/);
    expect(face).toMatch(/background-image:\s*inherit/);
    expect(face).toMatch(/transform:\s*translate\(-50%, -50%\)/);
    expect(ownFace).toMatch(/width:\s*34px/);
    expect(ownFace).toMatch(/height:\s*34px/);
  });

  it('keeps aura labels click-through and inside the bounded mobile slot', () => {
    const labels = ruleBody(
      /body\.mobile-touch\.game-active\s+:is\(#buff-bar, #debuff-bar, #tf-debuffs\)\s+> \.buff\s+> :is\(\.dur, \.stacks\)/,
    );
    const duration = ruleBody(
      /body\.mobile-touch\.game-active :is\(#buff-bar, #debuff-bar, #tf-debuffs\) > \.buff > \.dur/,
    );

    expect(labels).toMatch(/pointer-events:\s*none/);
    expect(duration).toMatch(/bottom:\s*0/);
  });
});
