// The Paladin kit's point cues keep the draped area ring (painter.ts
// paladinAreaTelegraph): a radius-carrying cue is the area a player steps out
// of, so it draws on every tier, with the kit cold or the cast gate closed,
// exactly as the Warrior kit's do (src/render/ability_vfx/CLAUDE.md).

import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';

function painterFixture(options: { kitReady: boolean; gateOpen: boolean; quality?: number }) {
  const spawnAoeRing = vi.fn();
  const fx = {
    setDelegates: vi.fn(),
    setLocalPlayer: vi.fn(),
    setQuality: vi.fn(),
    groundYAt: () => 0,
    valkyrsCallingLaunch: vi.fn(),
    // A cold kit refuses the landing and falls back to its own sparks.
    valkyrsCallingLand: vi.fn(() => options.kitReady),
    paladinKit: { veilboundMarch: { burst: vi.fn(() => options.kitReady) } },
  };
  const painter = new AbilityVfx(
    {
      vfx: {},
      fx: fx as unknown as AbilityVfxFx,
      anchor: () => null,
      spawnAoeRing,
      triggerAttack: vi.fn(),
      castVfxAdmit: () => options.gateOpen,
      castVfxReady: () => options.gateOpen,
    } as unknown as AbilityVfxDeps,
    () => 0,
  );
  if (options.quality !== undefined) painter.setQuality(options.quality);
  return { painter, spawnAoeRing };
}

const CUES = [
  { ability: 'sun_gods_verdict', fx: 'nova', radius: 8 },
  { ability: 'valkyrs_calling_mark', fx: 'nova', radius: 8 },
  { ability: 'valkyrs_calling_impact', fx: 'nova', radius: 8 },
  { ability: 'veilbound_march', fx: 'nova', radius: 10 },
] as const;

describe('Paladin point cues keep the area ring', () => {
  for (const arm of [
    { name: 'kit ready, gate open', kitReady: true, gateOpen: true },
    { name: 'kit cold, gate closed', kitReady: false, gateOpen: false },
    { name: 'lowest quality, kit cold', kitReady: false, gateOpen: true, quality: 0 },
  ]) {
    it.each(CUES)(`$ability draws its ring at the cue's radius (${arm.name})`, (cue) => {
      const f = painterFixture(arm);
      const claimed = f.painter.handleSpellfxAt({
        ...cue,
        x: 12,
        z: -4,
        school: 'holy',
        sourceId: 1,
      });
      expect(claimed).toBe(true);
      expect(f.spawnAoeRing).toHaveBeenCalledOnce();
      const [x, z, radius] = f.spawnAoeRing.mock.calls[0];
      expect([x, z, radius]).toEqual([12, -4, cue.radius]);
    });
  }

  it('draws no ring for a cue that carries no radius, nor for a recalled body', () => {
    const f = painterFixture({ kitReady: true, gateOpen: true });
    f.painter.handleSpellfxAt({
      ability: 'veilbound_march',
      fx: 'nova',
      x: 0,
      z: 0,
      school: 'holy',
      sourceId: 1,
    });
    f.painter.handleSpellfxAt({
      ability: 'recall_the_fallen',
      fx: 'nova',
      radius: 2,
      x: 0,
      z: 0,
      school: 'holy',
    });
    expect(f.spawnAoeRing).not.toHaveBeenCalled();
  });
});
