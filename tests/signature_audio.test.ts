import { describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import { signatureAccent, signatureAccentKeys } from '../src/game/signature_audio';

describe('signature material sound accents', () => {
  it('has eight distinct compiled recordings with bounded mix and cooldown', () => {
    const keys = signatureAccentKeys();
    expect(new Set(keys).size).toBe(8);
    for (const key of keys) expect(SFX_CLIPS[key as keyof typeof SFX_CLIPS].url).toContain('.mp3');
    const accent = signatureAccent('impact', 'pyroblast', false)!;
    expect(accent.gain).toBeLessThan(0.4);
    expect(accent.cooldown).toBeGreaterThan(0.5);
  });
  it('keeps routine casts, release recordings and reduced-tier moments clear', () => {
    expect(signatureAccent('release', 'pyroblast', false)).toBeNull();
    expect(signatureAccent('impact', 'fireball', false)?.gain).toBeLessThan(0.2);
    expect(signatureAccent('impact', 'unknown-ability', false)).toBeNull();
    expect(signatureAccent('impact', 'pyroblast', true)).toBeNull();
  });
});
