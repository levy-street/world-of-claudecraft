import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/sim/types';
import {
  type IdleBarkCandidate,
  idleDensityFactor,
  isIdleBarkCandidate,
  MOB_IDLE_BASE_CHANCE,
  MOB_IDLE_PER_ENTITY_COOLDOWN_MS,
  MOB_IDLE_SCAN_RADIUS,
  pickIdleBarkCandidates,
} from '../src/ui/mob_idle_sfx';

const alwaysRolls = () => 0; // rng() < chance is always true
const neverRolls = () => 1; // rng() < chance is always false

function candidate(id: number, templateId: string): IdleBarkCandidate {
  return { id, templateId, x: 0, y: 0, z: 0 };
}

function mob(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 1,
    kind: 'mob',
    templateId: 'forest_wolf',
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    ...overrides,
  } as unknown as Entity;
}

describe('idleDensityFactor', () => {
  it('is 1 for a lone mob and shrinks as the same-family cluster grows', () => {
    expect(idleDensityFactor(0)).toBe(1);
    expect(idleDensityFactor(1)).toBe(1);
    expect(idleDensityFactor(4)).toBe(0.5);
    expect(idleDensityFactor(9)).toBeCloseTo(1 / 3);
  });
});

describe('isIdleBarkCandidate', () => {
  const playerPos = { x: 0, y: 0, z: 0 };

  it('accepts a living, non-aggroed, unmuted, in-range mob', () => {
    expect(isIdleBarkCandidate(mob(), playerPos, new Set())).toBe(true);
  });

  it('rejects a non-mob entity (player, npc)', () => {
    expect(isIdleBarkCandidate(mob({ kind: 'player' }), playerPos, new Set())).toBe(false);
    expect(isIdleBarkCandidate(mob({ kind: 'npc' }), playerPos, new Set())).toBe(false);
  });

  it('rejects a dead mob', () => {
    expect(isIdleBarkCandidate(mob({ dead: true }), playerPos, new Set())).toBe(false);
  });

  it('rejects a mob already tracked as aggroed (mid-combat)', () => {
    expect(isIdleBarkCandidate(mob({ id: 5 }), playerPos, new Set([5]))).toBe(false);
    // A DIFFERENT mob's id in the aggroed set does not exclude this one.
    expect(isIdleBarkCandidate(mob({ id: 5 }), playerPos, new Set([6]))).toBe(true);
  });

  it('rejects a muted mob (the Nythraxis mute list)', () => {
    expect(
      isIdleBarkCandidate(
        mob({ templateId: 'nythraxis_scourge_of_thornpeak' }),
        playerPos,
        new Set(),
      ),
    ).toBe(false);
    expect(
      isIdleBarkCandidate(mob({ templateId: 'nythraxis_skeleton_warrior' }), playerPos, new Set()),
    ).toBe(false);
  });

  it('rejects a mob outside the scan radius, accepts one just inside it', () => {
    const justOutside = mob({ pos: { x: MOB_IDLE_SCAN_RADIUS + 0.1, y: 0, z: 0 } });
    const justInside = mob({ pos: { x: MOB_IDLE_SCAN_RADIUS - 0.1, y: 0, z: 0 } });
    expect(isIdleBarkCandidate(justOutside, playerPos, new Set())).toBe(false);
    expect(isIdleBarkCandidate(justInside, playerPos, new Set())).toBe(true);
  });
});

describe('pickIdleBarkCandidates', () => {
  it('rolls every eligible mob independently when the rng always succeeds', () => {
    const candidates = [candidate(1, 'forest_wolf'), candidate(2, 'wild_boar')];
    const picked = pickIdleBarkCandidates(candidates, 1000, new Map(), alwaysRolls);
    expect(picked.map((c) => c.id).sort()).toEqual([1, 2]);
  });

  it('picks nobody when the rng always fails', () => {
    const candidates = [candidate(1, 'forest_wolf')];
    const picked = pickIdleBarkCandidates(candidates, 1000, new Map(), neverRolls);
    expect(picked).toEqual([]);
  });

  it('skips a template id with no recognized mob family', () => {
    const candidates = [candidate(1, 'not_a_real_mob_template')];
    const picked = pickIdleBarkCandidates(candidates, 1000, new Map(), alwaysRolls);
    expect(picked).toEqual([]);
  });

  it('respects the per-entity cooldown, not just the base chance', () => {
    const candidates = [candidate(1, 'forest_wolf')];
    const lastBarkAt = new Map([[1, 1000]]);
    const stillOnCooldown = pickIdleBarkCandidates(
      candidates,
      1000 + MOB_IDLE_PER_ENTITY_COOLDOWN_MS - 1,
      lastBarkAt,
      alwaysRolls,
    );
    expect(stillOnCooldown).toEqual([]);

    const cooldownElapsed = pickIdleBarkCandidates(
      candidates,
      1000 + MOB_IDLE_PER_ENTITY_COOLDOWN_MS,
      lastBarkAt,
      alwaysRolls,
    );
    expect(cooldownElapsed.map((c) => c.id)).toEqual([1]);
  });

  it('damps the per-mob chance by same-family cluster size, not global count', () => {
    // Three wolves and one boar clustered together: each wolf's chance is
    // damped by the wolf count (3), the boar's chance is undamped (count 1),
    // since density is measured per family, not the whole candidate set.
    const candidates = [
      candidate(1, 'forest_wolf'),
      candidate(2, 'forest_wolf'),
      candidate(3, 'forest_wolf'),
      candidate(4, 'wild_boar'),
    ];
    const rolls: number[] = [];
    const recordingRng = () => {
      // Roll just under the boar's undamped chance but at/above the wolves'
      // damped chance, so only the boar (and no wolf) should be picked.
      const roll = MOB_IDLE_BASE_CHANCE * idleDensityFactor(3) + 0.001;
      rolls.push(roll);
      return roll;
    };
    const picked = pickIdleBarkCandidates(candidates, 1000, new Map(), recordingRng);
    expect(picked.map((c) => c.id)).toEqual([4]);
    expect(rolls.length).toBe(4);
  });
});
