// Old Thatchgrin keeps NIGHT hours (round 10; src/sim/mob/slumber.ts awakeAt 'night', the
// Mirefen Foreman's slumber inverted). Pinned here: by day he hangs on his pole on his
// spawn point, facing his field, neutral (the one isHostileTo rule: no attack path lands),
// healed, his kit silent; at nightfall he wakes with his yell and the realm notice and the
// rise hold covers the Awaken clip; at dawn, once out of a fight, he climbs back onto the
// pole; a fight running at dawn is fought to its end; a clockless host (tests, the RL env)
// keeps him awake; /dev scarecrow wake and sleep drive him against the clock. Also his
// rare direct broom drop (3%), rolled through the world rng, never twice.
import { afterEach, describe, expect, it } from 'vitest';
import {
  GOURDLIGHT_BROOM_DROP_CHANCE,
  GOURDLIGHT_BROOM_ID,
} from '../src/sim/content/gourdlight_eve';
import {
  THATCHGRIN_GOURD_ABILITY,
  THATCHGRIN_ID,
} from '../src/sim/content/gourdlight_eve_scarecrow';
import { MOBS } from '../src/sim/data';
import { DAWN_PHASE, DUSK_PHASE, phaseToCycleMs } from '../src/sim/day_night';
import { SLUMBER_AURA_ID } from '../src/sim/mob/slumber';
import { resolveScarecrowField } from '../src/sim/seasonal/scarecrow_field';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import { localizeSimText } from '../src/ui/sim_i18n';

afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));

function clockAt(phase: number) {
  let ms = phaseToCycleMs(phase);
  return { now: () => ms, set: (p: number) => (ms = phaseToCycleMs(p)) };
}

function world(clock?: { now: () => number }): Sim {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    devCommands: true,
    dayNightNowMs: clock?.now,
  });
  sim.resetDay = '2026-10-20';
  sim.chat('/dev season on');
  sim.tick();
  return sim;
}

const boss = (sim: Sim) =>
  [...sim.entities.values()].find((e) => e.templateId === THATCHGRIN_ID) as Entity;

function ticks(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...sim.tick());
  return out;
}

/** Park the player in his face (a tank on his table when `hit`). */
function nearHim(sim: Sim, b: Entity, hit: boolean): Entity {
  const p = sim.player;
  p.pos = { ...b.pos, x: b.pos.x + 3 };
  p.prevPos = { ...p.pos };
  p.level = 20;
  p.maxHp = 1_000_000;
  p.hp = 1_000_000;
  // biome-ignore lint/suspicious/noExplicitAny: the sim's damage hub, as the sibling suites drive it
  if (hit) (sim as any).dealDamage(p, b, 10, false, 'physical', 'Chip', 'hit', true);
  return p;
}

const logs = (events: SimEvent[]) =>
  events.flatMap((e) => (e.type === 'log' ? [(e as { text: string }).text] : []));
const yells = (events: SimEvent[]) =>
  events.flatMap((e) =>
    e.type === 'chat' && (e as { channel?: string }).channel === 'yell'
      ? [(e as { text: string }).text]
      : [],
  );

describe('Old Thatchgrin by day', () => {
  it('is a night boss in his template: the Foreman slumber, inverted, on his pole', () => {
    const def = MOBS[THATCHGRIN_ID]?.slumber;
    expect(def?.awakeAt).toBe('night');
    expect(def?.snapToBed).toBe(true);
    expect(def?.riseSeconds).toBe(3);
  });

  it('stands up already hanging on his pole: neutral, healed, its facing his field', () => {
    const sim = world(clockAt(0.5));
    const b = boss(sim);
    const field = resolveScarecrowField(WORLD_SEED);
    expect(b.asleep).toBe(true);
    expect(b.hostile).toBe(false);
    expect(b.pos.x).toBeCloseTo(field?.x ?? 0, 5);
    expect(b.pos.z).toBeCloseTo(field?.z ?? 0, 5);
    expect(b.facing).toBeCloseTo(field?.facing ?? 0, 5);
    const aura = b.auras.find((a) => a.id === SLUMBER_AURA_ID);
    expect(aura?.value2).toBe(1);
    expect(sim.isHostileTo(sim.player, b)).toBe(false);
  });

  it('cannot be fought: no swing lands, no aggro, no rain, whoever stands in his field', () => {
    const sim = world(clockAt(0.5));
    const b = boss(sim);
    nearHim(sim, b, false);
    const hp = b.hp;
    sim.player.targetId = b.id;
    sim.startAutoAttack?.();
    const events = ticks(sim, 30);
    expect(b.hp).toBe(hp);
    expect(b.inCombat).toBe(false);
    expect(b.asleep).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === 'spellfxAt' &&
          (e as { ability?: string }).ability === THATCHGRIN_GOURD_ABILITY,
      ),
    ).toBe(false);
    expect(sim.player.inCombat).toBe(false);
  });
});

describe('Old Thatchgrin at nightfall and dawn', () => {
  it('wakes at nightfall with his yell and the realm notice, the rise covering his clip', () => {
    const clock = clockAt(0.5);
    const sim = world(clock);
    const b = boss(sim);
    clock.set(DUSK_PHASE);
    const events = sim.tick();
    expect(b.asleep).toBe(false);
    expect(b.hostile).toBe(true);
    expect(b.slumberRise).toBeGreaterThan(2.9);
    expect(b.auras.some((a) => a.id === SLUMBER_AURA_ID)).toBe(false);
    expect(logs(events).some((t) => t.startsWith('Old Thatchgrin wakes over '))).toBe(true);
    expect(sim.isHostileTo(sim.player, b)).toBe(true);
    ticks(sim, 3.2);
    expect(b.slumberRise ?? 0).toBe(0);
  });

  it('climbs back onto his pole at dawn once out of a fight, never mid-fight', () => {
    const clock = clockAt(0.9);
    const sim = world(clock);
    const b = boss(sim);
    expect(b.asleep ?? false).toBe(false);
    nearHim(sim, b, true);
    ticks(sim, 1);
    expect(b.inCombat).toBe(true);
    clock.set(DAWN_PHASE + 0.01);
    ticks(sim, 2);
    // the pull decides when the night ends, not the clock
    expect(b.asleep ?? false).toBe(false);
    expect(b.hostile).toBe(true);
    // the fight ends (the player walks out of his reach and he evades home)
    b.threat.clear();
    b.inCombat = false;
    b.aiState = 'idle';
    b.aggroTargetId = null;
    sim.player.pos = { ...b.spawnPos, x: b.spawnPos.x + 60 };
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.inCombat = false;
    const events = ticks(sim, 20);
    expect(b.asleep).toBe(true);
    expect(b.hostile).toBe(false);
    expect(b.pos.x).toBeCloseTo(b.spawnPos.x, 5);
    expect(b.pos.z).toBeCloseTo(b.spawnPos.z, 5);
    expect(b.facing).toBeCloseTo(b.bedFacing ?? Number.NaN, 5);
    expect(b.hp).toBe(b.maxHp);
    expect(logs(events)).toContain('Old Thatchgrin sleeps until nightfall.');
    expect(yells(events).length).toBeGreaterThan(0);
  });

  it('keeps the pre-cycle world on a clockless host: always awake', () => {
    const sim = world();
    const b = boss(sim);
    ticks(sim, 2);
    expect(b.asleep ?? false).toBe(false);
    expect(b.hostile).toBe(true);
  });

  it('answers /dev scarecrow wake and sleep against the clock', () => {
    const sim = world(clockAt(0.5));
    const b = boss(sim);
    sim.chat('/dev scarecrow wake');
    sim.tick();
    expect(b.asleep).toBe(false);
    expect(b.hostile).toBe(true);
    // he stays up through the day once woken by hand
    ticks(sim, 5);
    expect(b.asleep).toBe(false);
    sim.chat('/dev scarecrow sleep');
    sim.tick();
    expect(b.asleep).toBe(true);
    expect(b.hostile).toBe(false);
  });

  it('online: /dev servertime night wakes him and /dev servertime day puts him back up', () => {
    // the server's clock: real time, running (here mid-morning, advanced each tick)
    let ms = phaseToCycleMs(0.35);
    const sim = world({ now: () => ms });
    const b = boss(sim);
    expect(b.asleep).toBe(true);
    const run = (s: number) => {
      for (let i = 0; i < Math.round(s / DT); i++) {
        ms += DT * 1000;
        sim.tick();
      }
    };
    sim.chat('/dev servertime night');
    run(1);
    expect(b.asleep).toBe(false);
    expect(b.hostile).toBe(true);
    run(4);
    sim.chat('/dev servertime day');
    run(2);
    expect(b.asleep).toBe(true);
    expect(b.hostile).toBe(false);
  });

  it('/dev scarecrow says how the hours really work, by day and by night', () => {
    const day = world(clockAt(0.5));
    day.chat('/dev scarecrow');
    const dayLogs = logs(day.tick());
    expect(dayLogs.some((t) => t.includes('/daynight night offline'))).toBe(true);
    const night = world(clockAt(0.9));
    night.chat('/dev scarecrow');
    const nightLogs = logs(night.tick());
    expect(nightLogs.some((t) => t.includes('/daynight day offline'))).toBe(true);
  });

  it('its notices re-localize through the client matcher', () => {
    expect(localizeSimText('Old Thatchgrin sleeps until nightfall.')).toBeTruthy();
    expect(localizeSimText('Old Thatchgrin sleeps until dawn.')).toBeTruthy();
  });
});

describe('the rare broom drop', () => {
  it('is on his table at 3%, never to a contributor who already keeps the broom', () => {
    const entry = MOBS[THATCHGRIN_ID]?.loot.find((l) => l.itemId === GOURDLIGHT_BROOM_ID);
    expect(GOURDLIGHT_BROOM_DROP_CHANCE).toBe(0.03);
    expect(entry).toMatchObject({ chance: 0.03, unlessOwned: true });
  });

  it('drops the reins on a winning roll, and only to someone without the broom', () => {
    const sim = world();
    const b = boss(sim);
    const ada = sim.addPlayer('mage', 'Ada');
    nearHim(sim, b, true);
    const adaE = sim.entities.get(ada) as Entity;
    adaE.pos = { ...b.pos, x: b.pos.x - 3 };
    // biome-ignore lint/suspicious/noExplicitAny: the damage hub, as above
    (sim as any).dealDamage(adaE, b, 10, false, 'physical', 'Chip', 'hit', true);
    sim.tick();
    // Ada already keeps the broom
    sim.addItem(GOURDLIGHT_BROOM_ID, 1, ada);
    // every chance roll wins: the table is what decides
    // biome-ignore lint/suspicious/noExplicitAny: the world rng, forced to win for this pin
    (sim as any).rng.chance = () => true;
    // biome-ignore lint/suspicious/noExplicitAny: the damage hub
    (sim as any).dealDamage(sim.player, b, b.hp + 10, false, 'physical', 'Chip', 'hit', true);
    sim.tick();
    expect(b.dead).toBe(true);
    const slots = b.loot?.items ?? [];
    const brooms = slots.filter((s) => s.itemId === GOURDLIGHT_BROOM_ID);
    expect(brooms).toHaveLength(1);
    expect(brooms[0].personalFor).toEqual([sim.playerId]);
  });
});
