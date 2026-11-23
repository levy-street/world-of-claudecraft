// Thatchbound, Old Thatchgrin's mind control (src/sim/seasonal/scarecrow_puppet.ts): who it
// takes (never his tank, never alone, one in a pair, two from three, never everyone), the
// cast bar and the marks, the hold and its ways out (timeout, damage threshold, dispel,
// the pull ending), the puppet walking to a friend and swinging softly with HIS damage,
// and the whole thing deterministic.
import { afterEach, describe, expect, it } from 'vitest';
import { isDispellableAura } from '../src/sim/aura_classify';
import { isStunned } from '../src/sim/combat/cc';
import {
  THATCHBOUND_AURA_IDS,
  THATCHBOUND_CROW_AURA_ID,
  THATCHBOUND_STRAWLING_AURA_ID,
  THATCHGRIN_ID,
  THATCHGRIN_KIT,
  THATCHGRIN_PUPPET_ABILITY,
} from '../src/sim/content/gourdlight_eve_scarecrow';
import { MOBS } from '../src/sim/data';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import {
  puppetCandidates,
  puppetVictimCount,
  thatchboundAura,
  thatchboundAuraFor,
} from '../src/sim/seasonal/scarecrow_puppet';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';

afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));

const P = THATCHGRIN_KIT.puppet;

function world(): Sim {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-10-20';
  return sim;
}

function standUp(sim: Sim): Entity {
  sim.chat('/dev season on');
  sim.tick();
  const b = [...sim.entities.values()].find((e) => e.templateId === THATCHGRIN_ID);
  if (!b) throw new Error('no Thatchgrin');
  return b;
}

function engage(sim: Sim, pid: number, b: Entity, dx: number, dz = 0): Entity {
  const p = sim.entities.get(pid) as Entity;
  p.pos = { ...b.pos, x: b.pos.x + dx, z: b.pos.z + dz };
  p.prevPos = { ...p.pos };
  p.level = 20;
  p.maxHp = 100_000;
  p.hp = 100_000;
  (sim as any).dealDamage(p, b, 10, false, 'physical', 'Chip', 'hit', true);
  return p;
}

const kit = (sim: Sim) => (sim as any).ctx.seasonal.scarecrow.kit;
const puppets = (sim: Sim) => [...sim.entities.values()].filter((e) => thatchboundAura(e));

/** A pull of `n` fighters: the primary tanks (his first damage), the rest stand round. */
function pull(n: number) {
  const sim = world();
  const b = standUp(sim);
  const tank = engage(sim, sim.playerId, b, 2);
  const others: Entity[] = [];
  const classes = ['mage', 'priest', 'rogue', 'hunter'] as const;
  for (let i = 1; i < n; i++) {
    const pid = sim.addPlayer(classes[i - 1], `Fighter${i}`);
    others.push(engage(sim, pid, b, -3 - i * 2, i));
  }
  sim.tick();
  b.aggroTargetId = tank.id;
  const k = kit(sim);
  // quiet the rest of his kit so only the strings run
  k.rainTimer = 9_999;
  k.callsFired = THATCHGRIN_KIT.calls.length;
  return { sim, b, tank, others, k };
}

/** Start the cast (the timer runs out) and run it to the landing. */
function castAndLand(sim: Sim, k: any) {
  k.puppetTimer = 0;
  k.spacing = 0;
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.ceil((P.cast + 0.2) / (1 / 20)) + 2; i++) events.push(...sim.tick());
  return events;
}

describe('Thatchbound: who it takes', () => {
  it('takes nobody alone, one of a pair, two from three up, never everyone', () => {
    expect(puppetVictimCount(1)).toBe(0);
    expect(puppetVictimCount(2)).toBe(1);
    expect(puppetVictimCount(3)).toBe(2);
    expect(puppetVictimCount(5)).toBe(2);
    expect(puppetVictimCount(20)).toBe(P.maxVictims);
  });

  it('never casts at all when he is fought alone (no draw, no bar)', () => {
    const { sim, b, k } = pull(1);
    k.puppetTimer = 0;
    k.spacing = 0;
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(b.castingAbility).not.toBe(P.name);
    expect(puppets(sim)).toHaveLength(0);
  });

  it('never takes his current target, and spares last cast when others are free', () => {
    const { b, tank, others } = pull(4);
    const fighters = [tank, ...others];
    const pool = puppetCandidates(b, fighters, []);
    expect(pool.map((p) => p.id)).not.toContain(tank.id);
    const spared = puppetCandidates(b, fighters, [others[0].id]);
    expect(spared.map((p) => p.id)).not.toContain(others[0].id);
    // when sparing would leave too few, the last victims are back in the pool
    const tight = puppetCandidates(b, [tank, others[0], others[1]], [others[0].id]);
    expect(tight.map((p) => p.id).sort()).toEqual([others[0].id, others[1].id].sort());
  });
});

describe('Thatchbound: the cast and the curse', () => {
  it('shows a cast bar and a mark under each victim, then turns two of three into puppets', () => {
    const { sim, b, tank, k } = pull(3);
    k.puppetTimer = 0;
    k.spacing = 0;
    const first = sim.tick();
    expect(b.castingAbility).toBe(P.name);
    expect(b.castTotal).toBe(P.cast);
    const marks = first.filter(
      (e) => e.type === 'spellfxAt' && e.ability === THATCHGRIN_PUPPET_ABILITY,
    );
    expect(marks).toHaveLength(2);
    for (let i = 0; i < Math.ceil(P.cast * 20) + 2; i++) sim.tick();
    expect(b.castingAbility).toBeNull();
    const taken = puppets(sim);
    expect(taken).toHaveLength(2);
    expect(taken.map((p) => p.id)).not.toContain(tank.id);
    // the scarecrow body for the first, the crow for the second
    const ids = taken.map((p) => thatchboundAura(p)?.id).sort();
    expect(ids).toEqual([THATCHBOUND_CROW_AURA_ID, THATCHBOUND_STRAWLING_AURA_ID].sort());
    // the victims' own control is gone
    for (const p of taken) expect(isStunned(p)).toBe(true);
  });

  it('fizzles when his bar is cleared (an interrupt)', () => {
    const { sim, b, k } = pull(3);
    k.puppetTimer = 0;
    k.spacing = 0;
    sim.tick();
    expect(b.castingAbility).toBe(P.name);
    b.castingAbility = null;
    for (let i = 0; i < Math.ceil(P.cast * 20) + 2; i++) sim.tick();
    expect(puppets(sim)).toHaveLength(0);
    expect(k.puppetCast).toBeNull();
  });

  it('is on the interruptible list, so a real kick fizzles it', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[P.name]?.school).toBe('shadow');
  });

  it('runs its full hold, then lets go', () => {
    const { sim, k } = pull(2);
    castAndLand(sim, k);
    expect(puppets(sim)).toHaveLength(1);
    const aura = thatchboundAura(puppets(sim)[0]);
    expect(aura?.duration).toBe(P.seconds);
    for (let i = 0; i < P.seconds * 20 + 4; i++) sim.tick();
    expect(puppets(sim)).toHaveLength(0);
  });
});

describe('Thatchbound: the ways out', () => {
  it('snaps when the victim takes its share of maximum health in damage, not before', () => {
    const { sim, b, k } = pull(2);
    castAndLand(sim, k);
    const [victim] = puppets(sim);
    // the threshold is fixed at the landing, off the victim's maximum health then
    expect(thatchboundAuraFor({ maxHp: 2000 } as Entity, 0, 1).breakThreshold).toBe(
      Math.round(2000 * P.breakShare),
    );
    const threshold = thatchboundAura(victim)?.breakThreshold ?? 0;
    expect(threshold).toBeGreaterThan(20);
    // deep enough that no hit here can kill it (death would end the hold another way)
    victim.maxHp = 10_000_000;
    victim.hp = 10_000_000;
    (sim as any).dealDamage(b, victim, threshold - 10, false, 'fire', 'Chip', 'hit', true);
    expect(thatchboundAura(victim)).toBeDefined();
    (sim as any).dealDamage(b, victim, 20, false, 'fire', 'Chip', 'hit', true);
    expect(thatchboundAura(victim)).toBeUndefined();
  });

  it('is Magic an ally can dispel, and never a self-cancel', () => {
    const v = { maxHp: 1000 } as Entity;
    const a = thatchboundAuraFor(v, 0, 1);
    expect(a.kind).toBe('incapacitate');
    expect(a.school).toBe('shadow');
    expect(isDispellableAura(a, false)).toBe(true);
  });

  it('every puppet goes free when the pull ends', () => {
    const { sim, b, k } = pull(3);
    castAndLand(sim, k);
    expect(puppets(sim).length).toBeGreaterThan(0);
    b.aiState = 'evade';
    sim.tick();
    expect(puppets(sim)).toHaveLength(0);
  });
});

describe('Thatchbound: the puppet', () => {
  it('walks to its nearest friend and swings softly, with HIS damage, never its own', () => {
    const { sim, b, k } = pull(2);
    castAndLand(sim, k);
    const [puppet] = puppets(sim);
    const friend = [...sim.entities.values()].find(
      (e) => e.kind === 'player' && e.id !== puppet.id,
    ) as Entity;
    const startD = Math.hypot(puppet.pos.x - friend.pos.x, puppet.pos.z - friend.pos.z);
    const hits: SimEvent[] = [];
    for (let i = 0; i < 20 * 6; i++) hits.push(...sim.tick());
    const endD = Math.hypot(puppet.pos.x - friend.pos.x, puppet.pos.z - friend.pos.z);
    expect(endD).toBeLessThan(Math.max(startD, P.swing.reach));
    expect(endD).toBeLessThanOrEqual(P.swing.reach + 0.5);
    const swings = hits.filter(
      (e: any) => e.type === 'damage' && e.targetId === friend.id && e.ability === P.swing.name,
    ) as any[];
    expect(swings.length).toBeGreaterThan(0);
    for (const s of swings) expect(s.sourceId).toBe(b.id);
    // soft: even at level 20 under his full mechanic scale, a swing stays small
    const scale = 3;
    const most = Math.ceil(P.swing.max * scale * (b.mechanicDamageMult ?? 1));
    for (const s of swings) expect(s.amount).toBeLessThanOrEqual(most);
  });

  it('is deterministic: the same fight takes the same victims and lands the same swings', () => {
    const run = () => {
      const { sim, k } = pull(4);
      const out: string[] = [];
      k.puppetTimer = 0;
      k.spacing = 0;
      for (let i = 0; i < 20 * 14; i++) {
        for (const e of sim.tick() as any[]) {
          if (e.type === 'spellfxAt' && e.ability === THATCHGRIN_PUPPET_ABILITY)
            out.push(`mark:${e.targetId}`);
          if (e.type === 'damage' && e.ability === P.swing.name)
            out.push(`swing:${e.targetId}:${e.amount}`);
        }
      }
      for (const id of THATCHBOUND_AURA_IDS) out.push(id);
      return out;
    };
    const first = run();
    expect(first.some((s) => s.startsWith('mark:'))).toBe(true);
    expect(run()).toEqual(first);
  }, 120_000);

  it('the dev verb gives a lone tester a crowd and starts the cast', () => {
    const sim = world();
    const b = standUp(sim);
    engage(sim, sim.playerId, b, 2);
    sim.tick();
    b.aggroTargetId = sim.playerId;
    sim.chat('/dev scarecrow puppet');
    expect(b.castingAbility).toBe(P.name);
  });
});

describe('Thatchbound: a stronger hold wins', () => {
  it('a rooted puppet stays put (the fear walk rule)', () => {
    const { sim, k } = pull(2);
    castAndLand(sim, k);
    const [puppet] = puppets(sim);
    // walk it far from its friend, then root it
    puppet.pos = { ...puppet.pos, x: puppet.pos.x + 15 };
    puppet.prevPos = { ...puppet.pos };
    puppet.auras.push({
      id: 'probe_root',
      name: 'Root',
      kind: 'root',
      value: 0,
      remaining: 5,
      duration: 5,
      sourceId: 0,
      school: 'nature',
    });
    const x = puppet.pos.x;
    for (let i = 0; i < 20; i++) sim.tick();
    expect(puppet.pos.x).toBeCloseTo(x, 3);
  });
});

describe('Thatchbound: the debuff tooltip', () => {
  it('says the live rule with the numbers the fight runs on, for both bodies', () => {
    const scale = MOBS[THATCHGRIN_ID].mechanicLevelScale;
    for (const id of THATCHBOUND_AURA_IDS) {
      const d = auraEffectDescriptor({ id, kind: 'incapacitate', value: 0, school: 'shadow' });
      expect(d?.key).toBe('hudChrome.auraEffect.gourdlight.thatchbound');
      expect(d?.nums).toEqual({
        every: P.swing.every,
        min: P.swing.min,
        max: P.swing.max,
        mult: scale?.toMult,
        level: scale?.toLevel,
        pct: Math.round(P.breakShare * 100),
      });
      const text = t('hudChrome.auraEffect.gourdlight.thatchbound', d?.nums as any);
      expect(text).toContain(`every ${P.swing.every} sec`);
      expect(text).toContain(`${P.swing.min} to ${P.swing.max} damage`);
      expect(text).toContain(`${Math.round(P.breakShare * 100)}% of your maximum health`);
      expect(text).toContain('Magic');
    }
    // the swing the tooltip promises is the one combat lands: the level-20 multiplier
    expect(scale?.toLevel).toBe(20);
  });
});
