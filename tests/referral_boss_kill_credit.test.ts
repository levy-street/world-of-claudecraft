import { describe, expect, it } from 'vitest';
import { enterDungeon } from '../src/sim/instances/dungeons';
import {
  createReferralCard,
  creditReferralCard,
  REFERRAL_MILESTONES,
  type ReferralCardContext,
  type ReferralCardEvent,
  type ReferralCardState,
  transitionReferralCard,
} from '../src/sim/referral_cards';
import type { ReferralEvidence } from '../src/sim/referral_evidence';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// Stamp cards are earned on the boss kill itself: a real claim-spawned final
// boss (or raid boss) dying with both bound characters eligible credits both,
// even when neither has the milestone quest. Spawned bosses carry no portal
// dungeonId, so this drives the real death path, never a hand-built Entity.

type AnySim = Sim & {
  ctx: Sim['ctx'];
  instances: { dungeonId: string; partyKey: string | null; mobIds: number[] }[];
  dealDamage(...args: unknown[]): void;
  rebucket(e: Entity): void;
};

function pair() {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true, devCommands: true });
  const s = sim as unknown as AnySim;
  const a = sim.addPlayer('warrior', 'One', { characterId: 101 });
  const b = sim.addPlayer('priest', 'Two', { characterId: 202 });
  sim.meta(a)!.accountId = 10;
  sim.meta(b)!.accountId = 20;
  sim.partyInvite(b, a);
  sim.partyAccept(b);
  for (const pid of [a, b]) sim.entities.get(pid)!.level = 20;
  return { sim, s, a, b };
}

function enter(s: AnySim, dungeonIds: readonly string[], pids: readonly number[]): void {
  for (const pid of pids)
    for (const id of dungeonIds) expect(enterDungeon(s.ctx, id, pid, true)).toBe(true);
}

function killBoss(s: AnySim, templateId: string, pids: readonly number[]): ReferralEvidence[] {
  let boss: Entity | undefined;
  for (const inst of s.instances) {
    if (inst.partyKey === null) continue;
    for (const id of inst.mobIds) {
      const e = s.entities.get(id);
      if (e?.templateId === templateId) boss ??= e;
    }
  }
  expect(boss, `${templateId} spawned in a claimed instance`).toBeDefined();
  // The regression premise: a spawned boss has no portal destination.
  expect(boss!.dungeonId).toBeNull();
  for (const pid of pids) {
    const p = s.entities.get(pid)!;
    p.pos = { x: boss!.pos.x + 1, y: boss!.pos.y, z: boss!.pos.z };
    p.prevPos = { ...p.pos };
    s.rebucket(p);
  }
  s.events.length = 0;
  s.dealDamage(s.entities.get(pids[0]), boss, boss!.hp + 100, false, 'physical', null, 'hit');
  return s.events.filter((e) => e.type === 'referralEvidence') as unknown as ReferralEvidence[];
}

function activeCard(ctx: ReferralCardContext): ReferralCardState {
  let state = createReferralCard(1, 10, 20);
  const levelOne: ReferralCardContext = {
    characters: [
      { ...ctx.characters[0], level: 1 },
      { ...ctx.characters[1], level: 1 },
    ],
  };
  for (const [accountId, type] of [
    [10, 'start'],
    [10, 'respond'],
    [20, 'respond'],
  ] as const) {
    state = transitionReferralCard(
      state,
      type === 'start'
        ? { type, accountId, expectedRevision: state.revision }
        : { type, accountId, accept: true, expectedRevision: state.revision },
      levelOne,
    ).state;
  }
  expect(state.status).toBe('active');
  return state;
}

/** Mirrors the server's evidence-to-event fan-out (server/referral_game_services.ts). */
function credit(evidence: ReferralEvidence): ReferralCardState {
  const ctx: ReferralCardContext = {
    characters: [
      evidence.participants.find((p) => p.accountId === 10)!,
      evidence.participants.find((p) => p.accountId === 20)!,
    ],
  };
  let state = activeCard(ctx);
  const eligibleCharacterIds = evidence.participants.map((p) => p.characterId);
  const events: ReferralCardEvent[] = [];
  if (evidence.activityId)
    events.push({
      type: 'raidBossKill',
      activityId: evidence.activityId,
      mobId: evidence.mobId!,
      eligibleCharacterIds,
    });
  if (evidence.dungeonId)
    events.push({ type: 'dungeonClear', dungeonId: evidence.dungeonId, eligibleCharacterIds });
  for (const event of events) state = creditReferralCard(state, event, ctx).state;
  return state;
}

const bit = (id: string) => 1 << REFERRAL_MILESTONES.findIndex((m) => m.id === id);

describe('referral stamps are earned on the real boss kill', () => {
  it.each([
    ['hollow_crypt', 'morthen', 'q_hollow', 2],
    ['sunken_bastion', 'vael_the_mistcaller', 'q_mistcaller', 4],
    ['gravewyrm_sanctum', 'korzul_the_gravewyrm', 'q_gravewyrm', 8],
  ])(
    'the %s final boss %s credits its stamp to both, no quest held',
    (dungeonId, mobId, questId, stamp) => {
      const { s, a, b } = pair();
      for (const pid of [a, b]) expect(s.meta(pid)!.questsDone.has(questId)).toBe(false);
      enter(s, [dungeonId], [a, b]);
      const evidence = killBoss(s, mobId, [a, b]);
      expect(evidence).toHaveLength(1);
      expect(evidence[0]).toMatchObject({ kind: 'boss', dungeonId });
      expect(credit(evidence[0]).participants.map((p) => p.credited)).toEqual([stamp, stamp]);
    },
  );

  it('a bound friend who never entered the instance is not in the kill evidence', () => {
    const { s, a } = pair();
    enter(s, ['gravewyrm_sanctum'], [a]);
    const evidence = killBoss(s, 'korzul_the_gravewyrm', [a]);
    // The server drops evidence with fewer than two participants, so no card credits.
    expect(evidence.flatMap((e) => e.participants.map((p) => p.characterId))).toEqual([101]);
  });

  it.each([
    [['ignivar_forge_lift', 'ignivar_raid_arena'], 'ignivar_herald_of_the_last_flame'],
    [['nythraxis_boss_arena'], 'nythraxis_scourge_of_thornpeak'],
  ])('a raid boss kill in %j (%s) credits the raid stamp to both', (dungeonIds, mobId) => {
    const { s, a, b } = pair();
    enter(s, dungeonIds, [a, b]);
    const evidence = killBoss(s, mobId, [a, b]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].activityId).toBeTruthy();
    expect(credit(evidence[0]).participants.map((p) => p.credited)).toEqual([
      bit('raid'),
      bit('raid'),
    ]);
  });

  it('a level-20 carry of a below-level bound pair through the Sanctum credits nothing', () => {
    const { sim, s, a, b } = pair();
    const carrier = sim.addPlayer('warrior', 'Carry', { characterId: 303 });
    sim.meta(carrier)!.accountId = 30;
    sim.partyInvite(carrier, a);
    sim.partyAccept(carrier);
    sim.entities.get(carrier)!.level = 20;
    for (const pid of [a, b]) sim.entities.get(pid)!.level = 1;
    enter(s, ['gravewyrm_sanctum'], [a, b, carrier]);
    // Only the carrier stands at the boss; the pair is merely inside the claim.
    const evidence = killBoss(s, 'korzul_the_gravewyrm', [carrier]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].participants.map((p) => p.characterId).sort()).toEqual([101, 202, 303]);
    expect(credit(evidence[0]).participants.map((p) => p.credited)).toEqual([0, 0]);
  });
});
