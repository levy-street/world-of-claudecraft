import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import {
  VAMPIRIC_TOUCH_VFX_FULL_SPEC,
  VAMPIRIC_TOUCH_VFX_SPEC,
} from '../src/render/priest_vfx_specs';
import { abilityImageUrl, auraImageUrl } from '../src/ui/icons';

describe('Vampiric Touch presentation', () => {
  it('draws the real sequencer target accent without rings or travelling geometry', () => {
    const ringAt = vi.fn();
    const boltBetween = vi.fn();
    const boltPoints = vi.fn();
    const burstAt = vi.fn();
    const host: SequencerHost = {
      anchorOf: (id) => ({ x: id * 10, y: 1, z: 0 }),
      groundYAt: () => 0,
      ringAt,
      boltBetween,
      boltPoints,
      burstAt,
      decalXZ: vi.fn(),
      flipbookAt: vi.fn(),
      pillarAt: vi.fn(),
      shellFlash: vi.fn(),
      pulseLight: vi.fn(),
      glowPulse: vi.fn(),
      slashStyled: vi.fn(),
      pathRibbon: vi.fn(),
      pushOverlay: vi.fn(),
      overlayCells: () => ({ glow: 0, star: 1, rune: 2, spark: 3 }),
      windupDraw: vi.fn(),
      quality: () => 1,
      timeNow: () => 0,
      countPrimitive: vi.fn(),
      shakeAt: vi.fn(),
      heldCcBand: () => false,
    };
    const sequence = new ArchetypeSequencer();
    expect(
      sequence.start(
        host,
        'vampiric_touch',
        VAMPIRIC_TOUCH_VFX_FULL_SPEC,
        1,
        2,
        0xa66cf1,
        0,
        false,
      ),
    ).not.toBeNull();
    for (let tick = 0; tick < 45; tick++) sequence.update(host, 0.05);
    expect(burstAt).toHaveBeenCalled();
    expect(ringAt).not.toHaveBeenCalled();
    expect(boltBetween).not.toHaveBeenCalled();
    expect(boltPoints).not.toHaveBeenCalled();
  });
  it('ships original opaque 128px painted art through the ability and aura icon resolver', async () => {
    expect(abilityImageUrl('vampiric_touch')).toBe('/ui/skills/priest/vampiric_touch.webp');
    expect(auraImageUrl('vampiric_touch')).toBe('/ui/skills/priest/vampiric_touch.webp');
    const bytes = readFileSync('public/ui/skills/priest/vampiric_touch.webp');
    expect(bytes.byteLength).toBeLessThanOrEqual(15 * 1024);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'c8e6d89e51703686dd36e30edf96351547a542c0e6940073591cda4e1adb5f77',
    );
    expect(await sharp(bytes).metadata()).toMatchObject({
      width: 128,
      height: 128,
      format: 'webp',
      space: 'srgb',
      hasAlpha: false,
    });
    const mapping = JSON.parse(readFileSync('public/ui/skills/priest/mapping.json', 'utf8'));
    expect(
      mapping.abilities.filter(
        (entry: { abilityId: string }) => entry.abilityId === 'vampiric_touch',
      ),
    ).toEqual([
      expect.objectContaining({
        output: 'vampiric_touch.webp',
        owner: 'World of ClaudeCraft',
        sourcePack: 'woc_openai_vampiric_touch_2026_10_07',
      }),
    ]);
  });

  it('claims the direct target cue without any projectile, beam or ground ring', () => {
    expect(abilityVfxSpec('vampiric_touch')).toBe(VAMPIRIC_TOUCH_VFX_SPEC);
    expect(abilityVfxFullSpec('vampiric_touch')).toBe(VAMPIRIC_TOUCH_VFX_FULL_SPEC);
    expect(VAMPIRIC_TOUCH_VFX_FULL_SPEC).toMatchObject({
      archetype: 'dot',
      windup: 1.5,
      debuff: { orbit: 'sparks' },
    });
    const sequenceInstant = vi.fn();
    const sequenceBolt = vi.fn();
    const projectile = vi.fn();
    const beam = vi.fn();
    const spawnAoeRing = vi.fn();
    const tick = vi.fn();
    const fx = {
      setDelegates: vi.fn(),
      sequenceInstant,
      sequenceBolt,
      warmSpiritsForClass: vi.fn(),
    } as unknown as AbilityVfxFx;
    const painter = new AbilityVfx(
      {
        fx,
        vfx: {
          projectile,
          beam,
          tick,
          lightningProjectile: vi.fn(),
          burst: vi.fn(),
          nova: vi.fn(),
          shoutwave: vi.fn(),
          buffSwirl: vi.fn(),
        },
        anchor: () => ({ x: 0, y: 1, z: 0 }),
        spawnAoeRing,
        triggerAttack: vi.fn(),
        localPlayerId: () => 1,
        isInstantAbility: () => false,
      },
      () => 0,
    );
    expect(
      painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'shadow',
        fx: 'tick',
        ability: 'vampiric_touch',
      }),
    ).toBe(true);
    expect(sequenceInstant).toHaveBeenCalledWith(
      'vampiric_touch',
      VAMPIRIC_TOUCH_VFX_FULL_SPEC,
      1,
      2,
      expect.any(Number),
      0,
      0,
    );
    expect(tick).toHaveBeenCalledTimes(1);
    expect(sequenceBolt).not.toHaveBeenCalled();
    expect(projectile).not.toHaveBeenCalled();
    expect(beam).not.toHaveBeenCalled();
    expect(spawnAoeRing).not.toHaveBeenCalled();
  });
});
