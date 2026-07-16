import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARTY_FRAME_DISPLAY,
  partyFrameAuraIsRelevant,
  partyFrameHealthText,
  partyFrameSignature,
  resolvePartyFrameStyle,
  selectPartyFrameMembers,
} from '../src/ui/party_frames';
import type { PartyInfo, PartyMemberInfo } from '../src/world_api';

const member = (pid: number, group: 1 | 2, x = 0, z = 0): PartyMemberInfo => ({
  pid,
  name: `Raid${pid}`,
  cls: 'priest',
  level: 20,
  hp: 100,
  mhp: 100,
  absorb: 0,
  res: 100,
  mres: 100,
  rtype: 'mana',
  x,
  z,
  dead: 0,
  inCombat: 0,
  group,
});

describe('party frame style resolution', () => {
  it('supports automatic, always classic, and always raid-frame presentation', () => {
    expect(resolvePartyFrameStyle(0, false)).toBe('classic');
    expect(resolvePartyFrameStyle(0, true)).toBe('raid');
    expect(resolvePartyFrameStyle(1, true)).toBe('classic');
    expect(resolvePartyFrameStyle(2, false)).toBe('raid');
  });
});

describe('party frame aura relevance', () => {
  it('hides passive maintenance buffs but keeps healer effects and harmful auras', () => {
    expect(partyFrameAuraIsRelevant({ id: 'imbue', kind: 'imbue' })).toBe(false);
    expect(partyFrameAuraIsRelevant({ id: 'arcane_intellect', kind: 'buff_int_pct' })).toBe(false);
    expect(partyFrameAuraIsRelevant({ id: 'sacred_shield', kind: 'cast_shield' })).toBe(true);
    expect(partyFrameAuraIsRelevant({ id: 'renew', kind: 'hot' })).toBe(true);
    expect(partyFrameAuraIsRelevant({ id: 'power_word_shield', kind: 'absorb' })).toBe(true);
    expect(partyFrameAuraIsRelevant({ id: 'blessing_of_might', kind: 'buff_ap' })).toBe(false);
    expect(partyFrameAuraIsRelevant({ id: 'evasion', kind: 'buff_dodge' })).toBe(true);
    expect(partyFrameAuraIsRelevant({ id: 'aspect_of_the_monkey', kind: 'buff_dodge' })).toBe(
      false,
    );
    expect(partyFrameAuraIsRelevant({ id: 'well_fed', kind: 'buff_sta' })).toBe(false);
    expect(partyFrameAuraIsRelevant({ id: 'rend', kind: 'dot' })).toBe(true);
    expect(partyFrameAuraIsRelevant({ id: 'wither', kind: 'buff_ap', neg: 1 })).toBe(true);
  });
});

describe('party frame member selection', () => {
  it('shows every other raid member across raid groups', () => {
    const info: PartyInfo = {
      leader: 1,
      raid: true,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: [
        member(1, 1),
        member(2, 1),
        member(3, 1),
        member(4, 1),
        member(5, 1),
        member(6, 2),
        member(7, 2),
        member(8, 2),
        member(9, 2),
        member(10, 2),
      ],
    };

    const frames = selectPartyFrameMembers(info, 1, { x: 0, z: 0 });

    expect(frames.map((m) => m.pid)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(frames.filter((m) => m.group === 2)).toHaveLength(5);
  });

  it('matches the raid social tab ordering when raid groups are interleaved', () => {
    const info: PartyInfo = {
      leader: 1,
      raid: true,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: [member(1, 1), member(6, 2), member(2, 1), member(7, 2), member(3, 1), member(4, 1)],
    };

    const frames = selectPartyFrameMembers(info, 1, { x: 0, z: 0 });

    expect(frames.map((m) => m.pid)).toEqual([2, 3, 4, 6, 7]);
  });

  it('marks live out-of-range members without hiding them', () => {
    const info: PartyInfo = {
      leader: 1,
      raid: true,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: [member(1, 1), member(2, 2, 150, 0)],
    };

    expect(selectPartyFrameMembers(info, 1, { x: 0, z: 0 })[0]).toMatchObject({
      pid: 2,
      oor: true,
    });
  });

  it('supports a full 20-player UI roster and configurable self visibility', () => {
    const info: PartyInfo = {
      leader: 1,
      raid: true,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: Array.from({ length: 20 }, (_, i) => member(i + 1, i < 10 ? 1 : 2)),
    };
    expect(selectPartyFrameMembers(info, 1, { x: 0, z: 0 })).toHaveLength(19);
    const shown = selectPartyFrameMembers(info, 1, { x: 0, z: 0 }, undefined, {
      showSelf: true,
      showResource: true,
      showAbsorbs: true,
      showAuras: true,
      healthText: 1,
      sort: 0,
      presentation: 0,
    });
    expect(shown).toHaveLength(20);
    expect(shown.find((m) => m.pid === 1)?.oor).toBe(false);
  });

  it('sorts deterministically by tank, healer, damage, then name', () => {
    const info: PartyInfo = {
      leader: 1,
      raid: true,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: [
        { ...member(1, 1), role: 'dps', name: 'Self' },
        { ...member(2, 2), role: 'dps', name: 'Zed' },
        { ...member(3, 1), role: 'healer', name: 'Mend' },
        { ...member(4, 2), role: 'tank', name: 'Guard' },
      ],
    };
    const frames = selectPartyFrameMembers(info, 1, { x: 0, z: 0 }, undefined, {
      showSelf: false,
      showResource: true,
      showAbsorbs: true,
      showAuras: true,
      healthText: 1,
      sort: 1,
      presentation: 0,
    });
    expect(frames.map((m) => m.pid)).toEqual([4, 3, 2]);
  });
});

describe('party frame health text and tactical information', () => {
  it('formats every supported health text mode', () => {
    const format = (value: number, percent?: boolean) =>
      percent ? `percent:${value}` : `number:${value}`;
    expect(partyFrameHealthText(75, 100, 0, format)).toBe('');
    expect(partyFrameHealthText(75, 100, 1, format)).toBe('percent:0.75');
    expect(partyFrameHealthText(75, 100, 2, format)).toBe('number:75');
    expect(partyFrameHealthText(75, 100, 3, format)).toBe('number:75 / number:100');
  });

  it('does not reveal Temporal Cascade target selection on party frames', () => {
    const info: PartyInfo = {
      leader: 1,
      raid: true,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: [
        member(1, 1, 0, 0),
        member(2, 1, 10, 0),
        member(3, 1, 11, 0),
        member(4, 2, 9, 0),
        member(5, 2, 10, 1),
        member(6, 2, 10, -1),
        member(7, 2, 30, 0),
      ],
    };
    const selected = selectPartyFrameMembers(info, 1, { x: 0, z: 0 });
    expect(selected.every((member) => !('cascade' in member))).toBe(true);
  });
});

describe('party frame signature (the per-frame short-circuit)', () => {
  const info = (over: Partial<PartyInfo> = {}): PartyInfo => ({
    leader: 1,
    raid: false,
    master: { enabled: false, looter: 0, threshold: 'uncommon' },
    members: [member(1, 1), member(2, 1, 10, 0), member(3, 1, 20, 0)],
    ...over,
  });

  it('is stable: the same party yields the same signature (so an unchanged party short-circuits)', () => {
    const pos = { x: 0, z: 0 };
    expect(partyFrameSignature(info(), 1, pos)).toBe(partyFrameSignature(info(), 1, pos));
  });

  it('skips the local player but encodes every other member + leader / raid / group', () => {
    const sig = partyFrameSignature(info(), 1, { x: 0, z: 0 });
    // pid 1 is the local player (skipped); 2 and 3 are encoded.
    expect(sig).not.toContain('1:Raid1:');
    expect(sig).toContain('2:Raid2:');
    expect(sig).toContain('3:Raid3:');
    expect(sig).toContain('L1:R0:G1');
  });

  it('changes when any rendered field changes (hp, shield, dead, level, leader, raid, out-of-range)', () => {
    const pos = { x: 0, z: 0 };
    const base = partyFrameSignature(info(), 1, pos);
    const members = info().members;
    expect(partyFrameSignature(info({ leader: 2 }), 1, pos)).not.toBe(base);
    expect(partyFrameSignature(info({ raid: true }), 1, pos)).not.toBe(base);
    expect(
      partyFrameSignature(
        info({ members: [members[0], { ...members[1], hp: 50 }, members[2]] }),
        1,
        pos,
      ),
    ).not.toBe(base);
    expect(
      partyFrameSignature(
        info({ members: [members[0], { ...members[1], absorb: 25 }, members[2]] }),
        1,
        pos,
      ),
    ).not.toBe(base);
    expect(
      partyFrameSignature(
        info({ members: [members[0], { ...members[1], dead: 1 }, members[2]] }),
        1,
        pos,
      ),
    ).not.toBe(base);
    expect(
      partyFrameSignature(
        info({ members: [members[0], { ...members[1], level: 21 }, members[2]] }),
        1,
        pos,
      ),
    ).not.toBe(base);
    // A member crossing the range threshold flips its oor digit -> the signature changes.
    expect(
      partyFrameSignature(
        info({ members: [members[0], { ...members[1], x: 500 }, members[2]] }),
        1,
        pos,
      ),
    ).not.toBe(base);
    // A member gaining an aura (a fresh shield) changes it too, so the mini aura
    // strip repaints; and losing it again changes it back to the base string.
    const shielded = partyFrameSignature(
      info({
        members: [
          members[0],
          { ...members[1], auras: [{ id: 'power_word_shield', kind: 'absorb' }] },
          members[2],
        ],
      }),
      1,
      pos,
    );
    expect(shielded).not.toBe(base);
    // A missing auras field (an older server snapshot) signs like an empty strip.
    expect(
      partyFrameSignature(
        info({ members: [members[0], { ...members[1], auras: [] }, members[2]] }),
        1,
        pos,
      ),
    ).toBe(base);
  });

  it('moving a member WITHIN range does not change the signature (the inline oor cadence held)', () => {
    const pos = { x: 0, z: 0 };
    const base = partyFrameSignature(info(), 1, pos);
    const members = info().members;
    // 10 -> 30 yards: both in range, so oor stays false and nothing else moved.
    expect(
      partyFrameSignature(
        info({ members: [members[0], { ...members[1], x: 30 }, members[2]] }),
        1,
        pos,
      ),
    ).toBe(base);
  });

  it('changes for every live display setting so the painter cannot stay stale', () => {
    const party = info();
    const pos = { x: 0, z: 0 };
    const base = partyFrameSignature(party, 1, pos);
    const variants = [
      { showSelf: true },
      { showResource: false },
      { showAbsorbs: false },
      { showAuras: false },
      { healthText: 2 as const },
      { sort: 1 as const },
      { presentation: 2 as const },
    ];
    for (const variant of variants) {
      expect(
        partyFrameSignature(party, 1, pos, undefined, {
          ...DEFAULT_PARTY_FRAME_DISPLAY,
          ...variant,
        }),
      ).not.toBe(base);
    }
  });
});

describe('ClientWorld-vs-Sim out-of-range parity', () => {
  // The offline Sim sends full-precision member positions; the server (the online
  // ClientWorld mirror) sends round2(x) / round2(z) (server/game.ts partyWire). The
  // oor flag is derived from those, so model the mirror's rounding and assert the
  // shape agrees away from the exact 100yd boundary (the only knife-edge where 2cm of
  // rounding could diverge, an accepted divergence like the absorb tolerance).
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const playerPos = { x: 0, z: 0 };

  it('the rounded mirror and the full-precision Sim agree on oor (selector + signature)', () => {
    for (const dist of [49.736512, 150.218734]) {
      const sim: PartyInfo = {
        leader: 1,
        raid: false,
        master: { enabled: false, looter: 0, threshold: 'uncommon' },
        members: [member(1, 1), member(2, 1, dist, 0)],
      };
      const mirror: PartyInfo = {
        leader: 1,
        raid: false,
        master: { enabled: false, looter: 0, threshold: 'uncommon' },
        members: [member(1, 1), member(2, 1, round2(dist), 0)],
      };
      expect(selectPartyFrameMembers(mirror, 1, playerPos)[0].oor).toBe(
        selectPartyFrameMembers(sim, 1, playerPos)[0].oor,
      );
      // If the oor shape matches, the whole signature matches (round2 touches only x/z,
      // which feed only the oor boolean).
      expect(partyFrameSignature(mirror, 1, playerPos)).toBe(
        partyFrameSignature(sim, 1, playerPos),
      );
    }
  });

  it('pins the accepted divergence at the exact 100yd boundary (sub-cm rounding flips oor)', () => {
    // dist 100.003: the full-precision Sim is out of range (100.003 > 100); the mirror
    // rounds the coordinate to 100.00, which is NOT > 100, so it reads in range. This
    // ~2cm knife-edge disagreement at the threshold is the accepted
    // tolerance (like the absorb case). Pinning it gives the parity block teeth: a change
    // to the comparison (> vs >=), the range constant, or the mirror's rounding model
    // would move this boundary and fail here, where the ~50yd cases cannot.
    const dist = 100.003;
    const sim: PartyInfo = {
      leader: 1,
      raid: false,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: [member(1, 1), member(2, 1, dist, 0)],
    };
    const mirror: PartyInfo = {
      leader: 1,
      raid: false,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: [member(1, 1), member(2, 1, round2(dist), 0)],
    };
    expect(selectPartyFrameMembers(sim, 1, playerPos)[0].oor).toBe(true);
    expect(selectPartyFrameMembers(mirror, 1, playerPos)[0].oor).toBe(false);
  });
});
