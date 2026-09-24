import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { shamanContactTail } from '../src/render/ability_vfx/shaman_contact_tail';
import { drawShamanEmpowerment } from '../src/render/ability_vfx/shaman_empowerment';
import { shamanImpactVariant } from '../src/render/ability_vfx/shaman_impact_flash';
import { drawThunderWard } from '../src/render/ability_vfx/shaman_thunder_ward';
import { SHAMAN_VFX_FULL_SPECS } from '../src/render/shaman_vfx_specs';

function tail(abilityId: string) {
  const paths: Vector3[][] = [];
  const groundYAt = (x: number, z: number) => x * 0.45 - z * 0.3;
  const host = {
    groundYAt,
    flipbookAt: vi.fn(),
    burstAt: vi.fn(),
    pulseLight: vi.fn(),
    pathRibbon: vi.fn<SequencerHost['pathRibbon']>((_color, _width, _life, fill) => {
      const points = Array.from({ length: 12 }, () => new Vector3());
      paths.push(points.slice(0, fill(points)));
      return true;
    }),
  };
  const at = { x: 7, y: 4, z: 11 };
  shamanContactTail(
    host as unknown as SequencerHost,
    {
      abilityId,
      spec: SHAMAN_VFX_FULL_SPECS[abilityId],
      tier: 0,
      sourceX: -2,
      sourceZ: 1,
      targetId: 4,
    } as SeqSlot,
    at,
  );
  return { host, paths, at };
}

describe('Shaman purposeful follow-through', () => {
  it('lands Skybranch on the recipient and grounds every return vertex on its actual sloped position', () => {
    const { host, paths, at } = tail('chain_lightning');
    expect(paths).toHaveLength(2);
    expect(paths[0][11].toArray()).toEqual([at.x, at.y, at.z]);
    expect(paths[0][0].y).toBeGreaterThan(at.y + 5);
    paths[1].forEach((p, j) => {
      expect(p.y - host.groundYAt(p.x, p.z)).toBeCloseTo(
        0.08 + Math.sin((j / 11) * Math.PI) * 0.17,
        10,
      );
    });
    expect(host.flipbookAt).not.toHaveBeenCalled();
  });
  it('keeps melee aftermath in its blade plane and Arc Bolt in a distinct second discharge', () => {
    const melee = tail('stormstrike').host.flipbookAt.mock.calls[0];
    const bolt = tail('lightning_bolt').host.flipbookAt.mock.calls[0];
    expect(melee[5]).toBe('shaman_storm_cleave');
    expect(melee[8]).toBe(-0.65);
    expect(melee[9]).toBeGreaterThan(1.4);
    expect(melee[7]).toBeLessThanOrEqual(0.3);
    expect(bolt[5]).toBe('shaman_storm_echo');
    expect(
      new Set(
        [
          'shaman_storm',
          'shaman_skybranch',
          'shaman_storm_echo',
          'shaman_storm_cleave',
          'shaman_ward_charge',
          'shaman_chorus_crest',
        ].map(shamanImpactVariant),
      ).size,
    ).toBe(6);
  });
  it('retains full ward charges while their short bright shoulders travel independently', () => {
    const points = Array.from({ length: 12 }, () => new Vector3());
    const paths: { points: Vector3[]; width: number }[] = [];
    const ribbons = {
      appendHeld: (p: Vector3[], n: number, width: number) => {
        paths.push({ points: p.slice(0, n).map((v) => v.clone()), width });
      },
    };
    drawThunderWard(points, new Vector3(), 0, 0.35, 3, 0x428bcf, 1, false, ribbons);
    expect(paths.map((p) => p.points.length)).toEqual([12, 5, 12, 5, 12, 5]);
    for (let i = 0; i < 6; i += 2) {
      expect(paths[i].points[0].distanceTo(paths[i].points[11])).toBeGreaterThan(2);
      expect(paths[i + 1].width).toBeLessThan(paths[i].width);
      expect(paths[i + 1].width).toBeGreaterThan(0.075);
    }
  });
  it('gives Chorus short unequal return strokes while preserving the compact party budget', () => {
    for (const compact of [false, true]) {
      const points = Array.from({ length: 12 }, () => new Vector3());
      const paths: Vector3[][] = [];
      const ribbons = {
        appendHeld: (p: Vector3[], n: number) => {
          paths.push(p.slice(0, n).map((v) => v.clone()));
        },
      };
      drawShamanEmpowerment(points, new Vector3(), 0, 0.4, 'chorus', 14, true, ribbons, compact);
      expect(paths.map((p) => p.length)).toEqual(compact ? [8, 8] : [12, 12, 5, 5]);
      expect(paths.flat().every((p) => p.toArray().every(Number.isFinite))).toBe(true);
      if (!compact) expect(paths[2][0].y).not.toBe(paths[3][0].y);
    }
  });
});
