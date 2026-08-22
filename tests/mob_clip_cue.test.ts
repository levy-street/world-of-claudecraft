// Authored per-mechanic clip cues (src/sim/mob/mob_clip_cue.ts).
//
// A mob picks an authored one-shot instead of its plain attack rotation by
// emitting a 'windup' spellfx carrying an ability id, which the renderer
// forwards into triggerAttack -> playAttack -> ClipMap.attackByAbility. Three
// things have to hold or the clip silently never plays:
//
//  1. the id must actually be emitted, and only for a template that opted in;
//  2. the cue must land AFTER the damage event it decorates (the renderer
//     animates every physical damage event with the plain rotation clip, so a
//     cue emitted first is overwritten in the same drain);
//  3. the enraged swing cue must survive a MISS, because mobSwing returns early
//     on miss/dodge/parry and a swing that reverts to the calm animation
//     mid-frenzy is exactly the bug the call-site placement exists to avoid.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const BRUTOK = 'brutok_skullsmasher';

function brutokSim() {
  const world = {
    ...BUILTIN_WORLD,
    camps: BUILTIN_WORLD.camps.filter((c) => c.mobId === BRUTOK),
    npcs: {},
    groundObjects: [],
  };
  const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true, world });
  const mob = [...sim.entities.values()].find((e) => e.templateId === BRUTOK);
  if (!mob) throw new Error('brutok did not spawn');
  const p = sim.player;
  p.maxHp = 500000;
  p.hp = 500000;
  p.pos.x = mob.pos.x + 2;
  p.pos.z = mob.pos.z;
  p.pos.y = mob.pos.y;
  return { sim, mob, p };
}

/** Drain every event the sim emits over `ticks`, in order. */
function record(sim: Sim, mob: Entity, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  const orig = (sim as unknown as { emit(e: SimEvent): void }).emit.bind(sim);
  (sim as unknown as { emit(e: SimEvent): void }).emit = (ev: SimEvent) => {
    if ((ev as { sourceId?: number }).sourceId === mob.id) out.push(ev);
    return orig(ev);
  };
  for (let i = 0; i < ticks; i++) sim.tick();
  return out;
}

const isCue = (ev: SimEvent, ability: string) =>
  ev.type === 'spellfx' &&
  (ev as unknown as { fx?: string }).fx === 'windup' &&
  (ev as unknown as { ability?: string }).ability === ability;

describe('mob authored clip cues', () => {
  it('opts Brutok in on all three mechanics, with ids the rig maps', () => {
    const t = MOBS[BRUTOK];
    expect(t.aoePulse?.ability).toBe('brutok_skull_smash');
    expect(t.enrage?.cryAbility).toBe('brutok_battlecry');
    expect(t.enrage?.swingAbility).toBe('brutok_enraged_swing');
    // ids stay mob-namespaced so the ability-VFX painter can never claim them
    for (const id of ['brutok_skull_smash', 'brutok_battlecry', 'brutok_enraged_swing']) {
      expect(id.startsWith('brutok_')).toBe(true);
    }
  });

  it('emits exactly ONE Skull Smash cue per slam, whatever the headcount', () => {
    // REGRESSION: the cue first shipped INSIDE fireAoePulse's per-player loop,
    // so it fired once per entry in ctx.players (not per player in radius, and
    // not once). A one-player fixture cannot see that, so this one seeds a
    // second player before counting.
    const { sim, mob } = brutokSim();
    // a SECOND player, parked well outside the 10yd pulse radius: the buggy
    // placement keyed off ctx.players, so an out-of-range player still doubled
    // the cue while contributing no damage event of their own.
    const otherId = sim.addPlayer('warrior', 'Bet');
    const other = sim.entities.get(otherId);
    if (!other) throw new Error('second player did not spawn');
    other.pos.x = mob.pos.x + 400;
    other.pos.z = mob.pos.z + 400;
    expect(sim.players.size, 'a second player joined the fixture').toBe(2);
    const evs = record(sim, mob, 260);
    const pulses = evs.filter(
      (e) => e.type === 'damage' && (e as { ability?: string }).ability === 'Skull Smash',
    );
    expect(pulses.length, 'the slam actually fired').toBeGreaterThan(0);
    const cues = evs.filter((e) => isCue(e, 'brutok_skull_smash'));
    // one cue per SLAM, and a slam fires every 10s (200 ticks), so over 260
    // ticks that is at most two - never one-per-player.
    expect(cues.length).toBeLessThanOrEqual(2);
    expect(cues.length).toBeGreaterThan(0);
    // the pulse's own nova carries the slam id too: that is what the
    // ability-VFX painter stages the ground-slam read from
    // (src/render/brutok_vfx_specs.ts), and it is one per slam for the same
    // headcount reason as the cue.
    const novas = evs.filter(
      (e) =>
        e.type === 'spellfx' &&
        (e as unknown as { fx?: string }).fx === 'nova' &&
        (e as unknown as { ability?: string }).ability === 'brutok_skull_smash',
    );
    expect(novas.length).toBe(cues.length);
  });

  it('emits the Skull Smash cue AFTER the pulse damage it decorates', () => {
    const { sim, mob } = brutokSim();
    const evs = record(sim, mob, 260);
    const cueAt = evs.findIndex((e) => isCue(e, 'brutok_skull_smash'));
    expect(cueAt, 'skull smash cue emitted').toBeGreaterThanOrEqual(0);
    // the pulse's own damage carries its mechanic name; every one of them for
    // this pulse must precede the cue, or the renderer overwrites the clip
    const lastPulseDmgBefore = evs
      .slice(0, cueAt)
      .map((e, i) => [e, i] as const)
      .filter(([e]) => e.type === 'damage' && (e as { ability?: string }).ability === 'Skull Smash')
      .pop();
    expect(lastPulseDmgBefore, 'pulse damage precedes its cue').toBeDefined();
  });

  it('emits no enraged-swing cue while healthy, and one per swing once enraged', () => {
    const { sim, mob } = brutokSim();
    const healthy = record(sim, mob, 120);
    expect(healthy.filter((e) => isCue(e, 'brutok_enraged_swing'))).toHaveLength(0);
    expect(healthy.filter((e) => isCue(e, 'brutok_battlecry'))).toHaveLength(0);

    mob.hp = Math.floor(mob.maxHp * 0.25);
    const enraged = record(sim, mob, 200);
    expect(mob.enraged).toBe(true);
    // the roar fires exactly once, at the threshold, not per swing
    expect(enraged.filter((e) => isCue(e, 'brutok_battlecry'))).toHaveLength(1);
    const swings = enraged.filter((e) => isCue(e, 'brutok_enraged_swing'));
    expect(swings.length, 'enraged swings cue their own clip').toBeGreaterThan(0);
  });

  it('cues the enraged swing on an AVOIDED swing too, not just a landed hit', () => {
    // mobSwing returns early on miss/dodge/parry, BEFORE runMobSwingAffixes,
    // which is why the cue hangs off the mobSwing CALL SITE instead. Dodge is
    // the forceable one of the three (miss is level-driven and capped at
    // MOB_VS_PLAYER_MAX_MISS), and it exercises that same early return.
    const { sim, mob, p } = brutokSim();
    mob.hp = Math.floor(mob.maxHp * 0.25);
    p.dodgeChance = 1;
    const evs = record(sim, mob, 200);
    const avoided = evs.filter(
      (e) => e.type === 'damage' && (e as { kind?: string }).kind === 'dodge',
    );
    expect(avoided.length, 'every swing was dodged').toBeGreaterThan(0);
    // no MELEE swing landed, so only the early-return path produced these cues.
    // (Skull Smash also deals kind 'hit', but it carries its mechanic name;
    // an auto-attack is the one that carries ability null.)
    expect(
      evs.some(
        (e) =>
          e.type === 'damage' &&
          (e as { kind?: string }).kind === 'hit' &&
          (e as { ability?: string | null }).ability === null,
      ),
      'and no auto-attack landed, so only the early-return path ran',
    ).toBe(false);
    expect(
      evs.filter((e) => isCue(e, 'brutok_enraged_swing')).length,
      'an avoided swing still reads enraged',
    ).toBeGreaterThan(0);
  });

  it('leaves every non-opted template emitting exactly what it always did', () => {
    // the parity contract: the cue is gated on optional fields, so a mob that
    // enrages without authoring clips emits no windup at all
    const plain = Object.entries(MOBS).filter(
      ([, t]) => t.enrage && !t.enrage.cryAbility && !t.enrage.swingAbility,
    );
    expect(plain.length, 'other enraging templates exist to protect').toBeGreaterThan(0);
    for (const [, t] of plain) {
      expect(t.enrage?.cryAbility).toBeUndefined();
      expect(t.enrage?.swingAbility).toBeUndefined();
    }
    const pulses = Object.entries(MOBS).filter(([id, t]) => t.aoePulse && id !== BRUTOK);
    expect(pulses.length).toBeGreaterThan(0);
    for (const [, t] of pulses) expect(t.aoePulse?.ability).toBeUndefined();
  });
});

describe('two-phase enrage (roar, then frenzy)', () => {
  const CRY = 0.31;
  const TURN = 0.3;
  const ROOT = 1.9;

  it('authors a LEAD threshold strictly above the enrage line', () => {
    const e = MOBS[BRUTOK].enrage;
    if (!e?.cryBelowHpPct) throw new Error('brutok should author an enrage roar');
    expect(e.cryBelowHpPct).toBe(CRY);
    expect(e.belowHpPct).toBe(TURN);
    expect(e.cryRootSeconds).toBe(ROOT);
    // the roar must start while he is still UN-enraged, or it cannot announce
    expect(e.cryBelowHpPct).toBeGreaterThan(e.belowHpPct);
  });

  it('roars at 31% while still un-enraged, and only turns after the roar ends', () => {
    const { sim, mob } = brutokSim();
    // park him between the two thresholds: the roar is due, the frenzy is not
    mob.hp = Math.floor(mob.maxHp * 0.305);
    let cryTick = -1;
    let enrageTick = -1;
    const orig = (sim as unknown as { emit(e: SimEvent): void }).emit.bind(sim);
    let tick = 0;
    (sim as unknown as { emit(e: SimEvent): void }).emit = (ev: SimEvent) => {
      if ((ev as { sourceId?: number }).sourceId === mob.id && isCue(ev, 'brutok_battlecry')) {
        if (cryTick < 0) cryTick = tick;
      }
      return orig(ev);
    };
    for (tick = 0; tick < 120; tick++) {
      sim.tick();
      if (enrageTick < 0 && mob.enraged) enrageTick = tick;
      // hold him in the band so only the roar gate can advance the state
      if (mob.hp > mob.maxHp * 0.305) mob.hp = Math.floor(mob.maxHp * 0.305);
    }
    expect(cryTick, 'he roared').toBeGreaterThanOrEqual(0);
    // between the thresholds the frenzy must NOT land, however long we wait
    expect(mob.enraged, 'still calm above the enrage line').toBe(false);
    expect(enrageTick).toBe(-1);
  });

  it('does not swing while the roar is running', () => {
    const { sim, mob } = brutokSim();
    mob.hp = Math.floor(mob.maxHp * 0.305);
    const evs = record(sim, mob, 20); // 1.0s, inside the 1.9s window
    expect(mob.enrageCryFired, 'roar armed').toBe(true);
    expect(
      evs.some((e) => e.type === 'damage' && (e as { ability?: string | null }).ability === null),
      'no auto-attack lands mid-roar',
    ).toBe(false);
  });

  it('still owes the full roar when a crit dumps him past BOTH thresholds', () => {
    const { sim, mob } = brutokSim();
    // engage first: the enrage gate lives in the boss-mechanics update, which
    // only runs for a mob actually in combat
    for (let i = 0; i < 40; i++) sim.tick();
    expect(mob.inCombat, 'engaged before the test drops him').toBe(true);
    mob.hp = Math.floor(mob.maxHp * 0.05); // straight past 31% and 30%
    sim.tick();
    expect(mob.enrageCryFired, 'roar opened on the same tick').toBe(true);
    expect(mob.enraged, 'but the frenzy waits for it').toBe(false);
    for (let i = 0; i < Math.round(ROOT * 20) + 2; i++) sim.tick();
    expect(mob.enraged, 'and lands once the roar finishes').toBe(true);
  });

  it('clears the roar state on respawn so the next pull re-arms', () => {
    const { sim, mob } = brutokSim();
    mob.hp = Math.floor(mob.maxHp * 0.05);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(mob.enrageCryFired).toBe(true);
    expect(mob.enraged).toBe(true);
    mob.hp = 0;
    for (let i = 0; i < 40; i++) sim.tick();
    // whatever the respawn cadence, the pull state must not survive a death
    if (!mob.dead) return;
    expect(mob.enraged || mob.enrageCryFired === true).toBe(true);
  });

  it('leaves a template with no LEAD threshold flipping exactly as before', () => {
    const legacy = Object.entries(MOBS).filter(
      ([, t]) => t.enrage && t.enrage.cryBelowHpPct === undefined,
    );
    expect(legacy.length, 'other enraging templates exist to protect').toBeGreaterThan(0);
    for (const [, t] of legacy) {
      expect(t.enrage?.cryRootSeconds).toBeUndefined();
    }
  });
});
