// The instance-transition veil core: triggers only on a space-crossing
// TELEPORT (never on seamless overworld walking, not even across a zone
// band), classifies every space kind from the world layout constants, and
// runs the cover/hold/reveal phase machine on the caller's clock. The core
// takes raw (x, z, nowMs), so a Sim- and a ClientWorld-backed player are the
// same input shape by construction.

import { describe, expect, it } from 'vitest';
import { DELVE_LIST, DUNGEONS, instanceOrigin, ZONES } from '../src/sim/data';
import {
  VEIL_COVER_MS,
  VEIL_HOLD_MS,
  VEIL_REVEAL_MS,
  ZoneVeilCore,
} from '../src/ui/zone_veil_view';

const CRYPT = DUNGEONS.hollow_crypt;
const CRYPT_ORIGIN = instanceOrigin(CRYPT.index, 0);

describe('zone veil core', () => {
  it('never triggers on the first observed position (login baseline)', () => {
    const core = new ZoneVeilCore();
    // logging out inside a dungeon and back in lands the first frame there
    const s = core.update(CRYPT_ORIGIN.x, CRYPT_ORIGIN.z, 0);
    expect(s.phase).toBe('idle');
    expect(s.dest).toBeNull();
  });

  it('never triggers while walking, including across a zone band', () => {
    const core = new ZoneVeilCore();
    const bandZ = ZONES[0].zMax; // zone1 -> zone2 border
    let now = 0;
    // walk north across the band in per-frame steps
    for (let z = bandZ - 5; z < bandZ + 5; z += 0.4) {
      now += 16;
      const s = core.update(10, z, now);
      expect(s.phase).toBe('idle');
    }
  });

  it('a door teleport into a dungeon veils with the dungeon as destination', () => {
    const core = new ZoneVeilCore();
    core.update(CRYPT.doorPos.x, CRYPT.doorPos.z, 0);
    const s = core.update(CRYPT_ORIGIN.x + CRYPT.entry.x, CRYPT_ORIGIN.z + CRYPT.entry.z, 16);
    expect(s.phase).toBe('cover');
    expect(s.dest).toEqual({ kind: 'dungeon', id: 'hollow_crypt' });
  });

  it('leaving the dungeon veils with the overworld zone as destination', () => {
    const core = new ZoneVeilCore();
    core.update(CRYPT_ORIGIN.x, CRYPT_ORIGIN.z, 0);
    const s = core.update(CRYPT.doorPos.x, CRYPT.doorPos.z, 16);
    expect(s.phase).toBe('cover');
    expect(s.dest?.kind).toBe('zone');
    expect(s.dest?.id).toBe(ZONES.find((z) => CRYPT.doorPos.z < z.zMax)?.id);
  });

  it('classifies the arena and delve bands', () => {
    const core = new ZoneVeilCore();
    core.update(0, 0, 0);
    expect(core.update(4200, -1250, 16).dest).toEqual({ kind: 'arena', id: '' });
    const core2 = new ZoneVeilCore();
    core2.update(0, 0, 0);
    const delve = DELVE_LIST[0];
    expect(core2.update(4800 + delve.index * 600, -1250, 16).dest).toEqual({
      kind: 'delve',
      id: delve.id,
    });
  });

  it('runs cover -> hold -> reveal -> idle on the caller clock', () => {
    const core = new ZoneVeilCore();
    core.update(CRYPT.doorPos.x, CRYPT.doorPos.z, 1000);
    const t0 = 1016;
    const at = (dt: number) => core.update(CRYPT_ORIGIN.x, CRYPT_ORIGIN.z, t0 + dt).phase;
    expect(at(0)).toBe('cover');
    expect(at(VEIL_COVER_MS + 10)).toBe('hold');
    expect(at(VEIL_COVER_MS + VEIL_HOLD_MS + 10)).toBe('reveal');
    const done = core.update(
      CRYPT_ORIGIN.x,
      CRYPT_ORIGIN.z,
      t0 + VEIL_COVER_MS + VEIL_HOLD_MS + VEIL_REVEAL_MS + 10,
    );
    expect(done.phase).toBe('idle');
    expect(done.dest).toBeNull();
  });

  it('a re-trigger mid-reveal restarts the veil and bumps gen', () => {
    const core = new ZoneVeilCore();
    core.update(CRYPT.doorPos.x, CRYPT.doorPos.z, 0);
    const first = core.update(CRYPT_ORIGIN.x, CRYPT_ORIGIN.z, 16);
    const gen1 = first.gen;
    // exit teleport lands mid-reveal of the entry veil
    const revealAt = 16 + VEIL_COVER_MS + VEIL_HOLD_MS + 10;
    const s = core.update(CRYPT.doorPos.x, CRYPT.doorPos.z, revealAt);
    expect(s.phase).toBe('cover');
    expect(s.gen).toBe(gen1 + 1);
    expect(s.dest?.kind).toBe('zone');
  });

  it('is allocation-light: the returned state object is reused across frames', () => {
    const core = new ZoneVeilCore();
    const a = core.update(0, 0, 0);
    const b = core.update(0, 0.4, 16);
    expect(b).toBe(a);
  });
});
