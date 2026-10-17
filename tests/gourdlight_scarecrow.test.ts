// Old Thatchgrin, Gourdlight Eve's field boss (src/sim/seasonal/scarecrow*.ts): he stands
// in his field only while the event runs (host-fed or /dev), his field resolves against
// the live world, his kit telegraphs and lands deterministically, every contributor gets
// personal spoils once per daily reset, and what he pays is cosmetic or currency.
import { describe, expect, it } from 'vitest';
import {
  CARVED_PUMPKIN_HEAD_ID,
  GOURDLIGHT_BROOM_ID,
  GOURDLIGHT_BROOM_MOUNT,
  GOURDLIGHT_EVE_ID,
  GOURDLIGHT_SWEET_ID,
} from '../src/sim/content/gourdlight_eve';
import {
  GOURDLIGHT_CROW_ID,
  STRAWLING_CHARM_ID,
  STRAWLING_GUISE_AURA_ID,
  STRAWLING_ID,
  SWELLING_GOURD_ID,
  THATCHGRIN_CHAFF_ABILITY,
  THATCHGRIN_DAMAGE_MULT,
  THATCHGRIN_GOURD_ABILITY,
  THATCHGRIN_HP_MULT,
  THATCHGRIN_HP_STEP_RATIO,
  THATCHGRIN_ID,
  THATCHGRIN_KIT,
  THATCHGRIN_LEVEL,
  THATCHGRIN_SACK_ID,
  THATCHGRIN_SACK_SWEETS,
  THATCHGRIN_SWELL_ABILITY,
} from '../src/sim/content/gourdlight_eve_scarecrow';
import { MOUNTS } from '../src/sim/content/mounts';
import { ITEMS, MOBS } from '../src/sim/data';
import { openWorldMobScale } from '../src/sim/mob/open_world_tuning';
import { updateSeasonal } from '../src/sim/seasonal';
import {
  measureScarecrowField,
  resolveScarecrowField,
  SCARECROW_FIELD_CAMP_CLEARANCE,
  SCARECROW_FIELD_RADIUS,
  SCARECROW_FIELD_ROAD_CLEARANCE,
  scarecrowFieldPasses,
} from '../src/sim/seasonal/scarecrow_field';
import { rainLandingAt, rainScatterCount } from '../src/sim/seasonal/scarecrow_kit';
import {
  HARVEST_WARD_AURA_ID,
  SPLIT_RIND_AURA_ID,
  swellingBurstDamage,
  UPROOTED_AURA_ID,
} from '../src/sim/seasonal/scarecrow_swell';
import {
  BOUND_RECHECK_TICKS,
  sweepEventBoundItems,
} from '../src/sim/seasonal/seasonal_bound_items';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { worldBossLockoutId } from '../src/sim/world_boss';
import { WORLD_SEED } from '../src/sim/world_seed';

function world(): Sim {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-10-20';
  return sim;
}

function boss(sim: Sim): Entity | undefined {
  return [...sim.entities.values()].find((e) => e.templateId === THATCHGRIN_ID);
}

function standUp(sim: Sim): Entity {
  sim.chat('/dev season on');
  sim.tick();
  const b = boss(sim);
  if (!b) throw new Error('no Thatchgrin');
  return b;
}

/** A tanky level-20 stand-in parked in his face, already on his hate table. */
function engage(sim: Sim, pid: number, b: Entity, dx = 2): Entity {
  const p = sim.entities.get(pid) as Entity;
  p.pos = { ...b.pos, x: b.pos.x + dx };
  p.prevPos = { ...p.pos };
  p.level = 20;
  p.maxHp = 1_000_000;
  p.hp = 1_000_000;
  (sim as any).dealDamage(p, b, 10, false, 'physical', 'Chip', 'hit', true);
  return p;
}

function spellfxAt(events: SimEvent[], ability: string) {
  return events.filter(
    (e): e is Extract<SimEvent, { type: 'spellfxAt' }> =>
      e.type === 'spellfxAt' && e.ability === ability,
  );
}

describe('his field', () => {
  it('resolves against the shipped world, clear, dry, flat and away from roads and camps', () => {
    world();
    const field = resolveScarecrowField(WORLD_SEED);
    expect(field).not.toBeNull();
    if (!field) return;
    const check = measureScarecrowField(WORLD_SEED, field.x, field.z);
    expect(scarecrowFieldPasses(check)).toBe(true);
    expect(check.road).toBeGreaterThanOrEqual(SCARECROW_FIELD_ROAD_CLEARANCE);
    expect(check.camp).toBeGreaterThanOrEqual(SCARECROW_FIELD_CAMP_CLEARANCE);
    expect(SCARECROW_FIELD_RADIUS).toBeGreaterThan(THATCHGRIN_KIT.rain.radius);
  });

  it('is the same spot every time (pure, memoized)', () => {
    world();
    expect(resolveScarecrowField(WORLD_SEED)).toEqual(resolveScarecrowField(WORLD_SEED));
  });
});

describe('the season gate', () => {
  it('stands only while Gourdlight Eve runs: none offline, up on /dev, gone on close', () => {
    const sim = world();
    for (let i = 0; i < 5; i++) sim.tick();
    expect(boss(sim)).toBeUndefined();
    const b = standUp(sim);
    const field = resolveScarecrowField(WORLD_SEED);
    expect(b.pos.x).toBeCloseTo(field?.x ?? 0, 5);
    expect(b.pos.z).toBeCloseTo(field?.z ?? 0, 5);
    sim.chat('/dev season off');
    sim.tick();
    expect(boss(sim)).toBeUndefined();
  });

  it('rises on the host calendar too (the server path), with no dev override', () => {
    const sim = world();
    (sim as any).ctx.seasonal.hostEventId = GOURDLIGHT_EVE_ID;
    sim.tick();
    expect(boss(sim)?.templateId).toBe(THATCHGRIN_ID);
    (sim as any).ctx.seasonal.hostEventId = null;
    sim.tick();
    expect(boss(sim)).toBeUndefined();
  });

  it('takes his adds with him when the event closes mid-fight', () => {
    const sim = world();
    const b = standUp(sim);
    engage(sim, sim.playerId, b);
    sim.tick();
    b.hp = Math.floor(b.maxHp * 0.79);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(b.summonedIds.length).toBeGreaterThan(0);
    const adds = [...b.summonedIds];
    sim.chat('/dev season off');
    sim.tick();
    for (const id of adds) expect(sim.entities.has(id)).toBe(false);
  });
});

describe('his tuning', () => {
  it('is the Waking Warden ladder at his level on the open-world curve, times the design health, scaled per contributor by the world-boss step', () => {
    const sim = world();
    const b = standUp(sim);
    const t = MOBS[THATCHGRIN_ID];
    expect(b.level).toBe(THATCHGRIN_LEVEL);
    const raw = (t.hpBase + t.hpPerLevel * (THATCHGRIN_LEVEL - 1)) * 2.3;
    expect(b.maxHp / raw).toBeCloseTo(
      openWorldMobScale(THATCHGRIN_LEVEL).health * THATCHGRIN_HP_MULT,
      1,
    );
    const base = b.maxHp;
    const a = sim.addPlayer('mage', 'Ada');
    engage(sim, sim.playerId, b);
    engage(sim, a, b, -2);
    sim.tick();
    expect(b.maxHp).toBe(base + Math.round(base * THATCHGRIN_HP_STEP_RATIO));
  });

  it('swings softly: his melee is the curved Warden swing times the design damage cut', () => {
    const sim = world();
    const b = standUp(sim);
    const t = MOBS[THATCHGRIN_ID];
    const curved =
      (t.dmgBase + t.dmgPerLevel * (THATCHGRIN_LEVEL - 1)) *
      1.5 *
      openWorldMobScale(THATCHGRIN_LEVEL).damage;
    expect(THATCHGRIN_DAMAGE_MULT).toBeLessThan(1);
    expect(b.weapon?.min).toBe(Math.round(curved * THATCHGRIN_DAMAGE_MULT * 0.8));
    expect(b.weapon?.max).toBe(Math.round(curved * THATCHGRIN_DAMAGE_MULT * 1.25));
  });

  it('meets a level-10 group inside the classic hit table, adds included', () => {
    expect(THATCHGRIN_LEVEL - 10).toBeLessThanOrEqual(2);
    expect(MOBS[GOURDLIGHT_CROW_ID].maxLevel).toBeLessThanOrEqual(THATCHGRIN_LEVEL);
    expect(MOBS[STRAWLING_ID].maxLevel).toBeLessThanOrEqual(THATCHGRIN_LEVEL);
    expect(MOBS[SWELLING_GOURD_ID].maxLevel).toBe(THATCHGRIN_LEVEL);
  });

  it('is a world boss in every rule, flagged seasonal, and pays nothing that is power', () => {
    const t = MOBS[THATCHGRIN_ID];
    expect(t.worldBoss).toBe(true);
    expect(t.seasonalEvent).toBe(GOURDLIGHT_EVE_ID);
    for (const entry of t.loot) {
      const item = ITEMS[entry.itemId ?? ''];
      expect(item).toBeDefined();
      // the sack, the charm and the head are toys; the broom is a mount at the base speed
      expect(['tool', 'mount']).toContain(item.kind);
      expect((item as { stats?: unknown }).stats).toBeUndefined();
    }
    expect(MOBS[GOURDLIGHT_CROW_ID].loot).toEqual([]);
    expect(MOBS[STRAWLING_ID].loot).toEqual([]);
  });
});

describe('his kit', () => {
  it('rains Gourdfall: every ring first at its true radius, then the bursts in a cascade, then burning chaff', () => {
    const sim = world();
    const b = standUp(sim);
    const p = engage(sim, sim.playerId, b, 6);
    p.gm = false;
    let rings: ReturnType<typeof spellfxAt> = [];
    let ticks = 0;
    while (rings.length === 0 && ticks < 20 * 20) {
      rings = spellfxAt(sim.tick(), THATCHGRIN_GOURD_ABILITY).filter((e) => e.fx === 'runeCircle');
      ticks++;
    }
    // one on the lone fighter, plus the open-ground pumpkins for one fighter
    expect(rings).toHaveLength(1 + rainScatterCount(1));
    expect(ticks / 20).toBeGreaterThanOrEqual(THATCHGRIN_KIT.rain.first - 0.2);
    for (const r of rings) expect(r.radius).toBe(THATCHGRIN_KIT.rain.radius);
    // the targeted ring is on the fighter and lands first; the rest cascade after it
    expect(rings[0].targetId).toBe(p.id);
    rings.forEach((r, i) => {
      expect(r.duration).toBeCloseTo(rainLandingAt(i), 6);
    });
    for (const r of rings.slice(1)) {
      const d = Math.hypot(r.x - b.pos.x, r.z - b.pos.z);
      expect(d).toBeGreaterThanOrEqual(THATCHGRIN_KIT.rain.scatterMin - 1e-6);
      expect(d).toBeLessThanOrEqual(THATCHGRIN_KIT.rain.scatterReach + 1e-6);
    }
    const hpBefore = p.hp;
    const bursts: number[] = [];
    let chaff = 0;
    const last = rainLandingAt(rings.length - 1);
    for (let i = 0; i < Math.ceil(last * 20) + 2; i++) {
      p.pos.x = rings[0].x;
      p.pos.z = rings[0].z;
      const ev = sim.tick();
      for (const e of spellfxAt(ev, THATCHGRIN_GOURD_ABILITY)) if (e.fx === 'nova') bursts.push(i);
      chaff += spellfxAt(ev, THATCHGRIN_CHAFF_ABILITY).length;
    }
    expect(bursts).toHaveLength(rings.length);
    // a cascade, not one beat
    expect(bursts[bursts.length - 1]).toBeGreaterThan(bursts[0]);
    expect(chaff).toBe(rings.length);
    expect(p.hp).toBeLessThan(hpBefore);
  });

  it('scales the rain with the crowd, capped', () => {
    expect(rainScatterCount(1)).toBe(THATCHGRIN_KIT.rain.scatterBase);
    expect(rainScatterCount(4)).toBeGreaterThan(rainScatterCount(1));
    expect(rainScatterCount(40)).toBe(THATCHGRIN_KIT.rain.scatterMax);
  });

  it('burns whoever stands in the chaff once a second, and stops when it gutters out', () => {
    const sim = world();
    const b = standUp(sim);
    const p = engage(sim, sim.playerId, b, 6);
    const kit = () => (sim as any).ctx.seasonal.scarecrow.kit;
    while (!kit()) sim.tick();
    kit().chaff = [p.pos.x, p.pos.z, THATCHGRIN_KIT.chaff.seconds, THATCHGRIN_KIT.chaff.interval];
    kit().rainTimer = 999;
    let burns = 0;
    const hits = (ev: SimEvent[]) =>
      ev.filter(
        (e) =>
          e.type === 'damage' &&
          (e as any).targetId === p.id &&
          (e as any).ability === THATCHGRIN_KIT.chaff.name,
      ).length;
    for (let i = 0; i < THATCHGRIN_KIT.chaff.seconds * 20 + 40; i++) burns += hits(sim.tick());
    expect(burns).toBe(THATCHGRIN_KIT.chaff.seconds / THATCHGRIN_KIT.chaff.interval);
    expect(kit().chaff).toHaveLength(0);
  });

  it('calls crows, then strawlings, at falling health, once per pull each', () => {
    const sim = world();
    const b = standUp(sim);
    engage(sim, sim.playerId, b);
    sim.tick();
    const addsOf = (id: string) =>
      b.summonedIds.filter((a) => sim.entities.get(a)?.templateId === id).length;
    b.hp = Math.floor(b.maxHp * 0.79);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(addsOf(GOURDLIGHT_CROW_ID)).toBe(THATCHGRIN_KIT.calls[0].count);
    expect(addsOf(STRAWLING_ID)).toBe(0);
    b.hp = Math.floor(b.maxHp * 0.59);
    for (let i = 0; i < 100; i++) sim.tick();
    expect(addsOf(STRAWLING_ID)).toBe(THATCHGRIN_KIT.calls[1].count);
    // no second wave while he sits under the same threshold
    for (let i = 0; i < 100; i++) sim.tick();
    expect((sim as any).ctx.seasonal.scarecrow.kit.callsFired).toBe(2);
  });

  it('never aims at or burns a passer-by who is not in his fight', () => {
    const sim = world();
    const b = standUp(sim);
    const fighter = engage(sim, sim.playerId, b, 6);
    const bystanderId = sim.addPlayer('mage', 'Passerby');
    const bystander = sim.entities.get(bystanderId) as Entity;
    bystander.level = 20;
    const park = () => {
      // 30 yd out: inside his throwing range, outside any aggro radius
      bystander.pos = { ...b.pos, x: b.pos.x - 30 };
      bystander.prevPos = { ...bystander.pos };
    };
    park();
    const hp = bystander.hp;
    const kit = () => (sim as any).ctx.seasonal.scarecrow.kit;
    const aimed = new Set<number>();
    for (let i = 0; i < 20 * 30; i++) {
      for (const e of spellfxAt(sim.tick(), THATCHGRIN_GOURD_ABILITY)) {
        if (e.fx === 'runeCircle' && e.targetId !== undefined) aimed.add(e.targetId);
      }
      park();
      // a burning patch right under the passer-by
      if (i === 20 && kit()) kit().chaff.push(bystander.pos.x, bystander.pos.z, 8, 1);
    }
    expect(aimed.has(fighter.id)).toBe(true);
    expect(aimed.has(bystanderId)).toBe(false);
    expect(bystander.hp).toBe(hp);
  });

  it('is deterministic: the same seed and the same fight draw the same gourds', () => {
    const run = () => {
      const sim = world();
      const b = standUp(sim);
      engage(sim, sim.playerId, b, 6);
      const a = sim.addPlayer('mage', 'Ada');
      const c = sim.addPlayer('priest', 'Cy');
      engage(sim, a, b, -6);
      engage(sim, c, b, 9);
      const out: string[] = [];
      for (let i = 0; i < 20 * 40; i++) {
        for (const e of spellfxAt(sim.tick(), THATCHGRIN_GOURD_ABILITY)) {
          out.push(`${e.fx}:${e.x.toFixed(3)}:${e.z.toFixed(3)}`);
        }
      }
      return out;
    };
    const first = run();
    expect(first.length).toBeGreaterThan(0);
    expect(run()).toEqual(first);
  }, 120_000);

  it('drops the pull (kit and adds) when he evades home', () => {
    const sim = world();
    const b = standUp(sim);
    engage(sim, sim.playerId, b);
    sim.tick();
    b.hp = Math.floor(b.maxHp * 0.79);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(b.summonedIds.length).toBeGreaterThan(0);
    b.aiState = 'evade';
    sim.tick();
    expect((sim as any).ctx.seasonal.scarecrow.kit).toBeNull();
  });
});

describe('his spoils', () => {
  function killWithTwo(sim: Sim) {
    const b = standUp(sim);
    const a = sim.addPlayer('mage', 'Ada');
    engage(sim, sim.playerId, b);
    engage(sim, a, b, -2);
    sim.tick();
    (sim as any).dealDamage(sim.player, b, b.hp + 10, false, 'physical', 'Chip', 'hit', true);
    sim.tick();
    expect(b.dead).toBe(true);
    return { b, a };
  }

  it('pays every contributor a personal sack, locks each out on loot until the daily reset', () => {
    const sim = world();
    const { b, a } = killWithTwo(sim);
    for (const pid of [sim.playerId, a]) {
      const e = sim.entities.get(pid) as Entity;
      e.pos = { ...b.pos };
      expect(sim.lootCorpse(b.id, pid)).toBe(true);
      expect(sim.countItem(THATCHGRIN_SACK_ID, pid)).toBe(1);
      const meta = (sim as any).players.get(pid);
      expect(meta.raidLockouts.get(worldBossLockoutId(THATCHGRIN_ID))).toBeGreaterThan(0);
    }
    // The next spawn pays nobody locked out.
    sim.chat('/dev scarecrow reset');
    sim.tick();
    const b2 = boss(sim) as Entity;
    engage(sim, sim.playerId, b2);
    sim.tick();
    (sim as any).dealDamage(sim.player, b2, b2.hp + 10, false, 'physical', 'Chip', 'hit', true);
    sim.tick();
    const mine = (b2.loot?.items ?? []).filter((s) => s.personalFor?.includes(sim.playerId));
    expect(mine).toHaveLength(0);
  });

  it('never credits the weekly world-boss quest, but counts his feat for every contributor', () => {
    const sim = world();
    const { a } = killWithTwo(sim);
    for (const pid of [sim.playerId, a]) {
      const meta = (sim as any).players.get(pid);
      expect(meta.deedStats.counters.thatchgrinKills).toBe(1);
    }
  });

  it('the sack opens to its sweets; the charm wears the strawling guise, never in combat', () => {
    const sim = world();
    sim.chat('/dev season on');
    sim.tick();
    sim.addItem(THATCHGRIN_SACK_ID, 1);
    sim.useItem(THATCHGRIN_SACK_ID);
    expect(sim.countItem(GOURDLIGHT_SWEET_ID)).toBe(THATCHGRIN_SACK_SWEETS);
    expect(sim.countItem(THATCHGRIN_SACK_ID)).toBe(0);
    sim.addItem(STRAWLING_CHARM_ID, 1);
    sim.useItem(STRAWLING_CHARM_ID);
    expect(sim.player.auras.some((x) => x.id === STRAWLING_GUISE_AURA_ID)).toBe(true);
    expect(sim.countItem(STRAWLING_CHARM_ID)).toBe(1);
    sim.player.inCombat = true;
    updateSeasonal((sim as any).ctx);
    expect(sim.player.auras.some((x) => x.id === STRAWLING_GUISE_AURA_ID)).toBe(false);
  });
});

describe('the Swelling Gourd', () => {
  function pullTo(sim: Sim, frac: number) {
    const b = standUp(sim);
    const p = engage(sim, sim.playerId, b, 3);
    sim.tick();
    b.hp = Math.floor(b.maxHp * frac);
    return { b, p };
  }
  const gourdOf = (sim: Sim) =>
    [...sim.entities.values()].find((e) => e.templateId === SWELLING_GOURD_ID);
  const kit = (sim: Sim) => (sim as any).ctx.seasonal.scarecrow.kit;

  it('heaves up behind him at its threshold, warding him, with its fuse on its cast bar', () => {
    const sim = world();
    const { b } = pullTo(sim, THATCHGRIN_KIT.swell.atHpPct[0] - 0.01);
    sim.tick();
    const g = gourdOf(sim);
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.maxHp).toBe(Math.round(b.maxHp * THATCHGRIN_KIT.swell.hpShare));
    const behind = Math.hypot(g.pos.x - b.pos.x, g.pos.z - b.pos.z);
    expect(behind).toBeCloseTo(THATCHGRIN_KIT.swell.distance, 0);
    expect(g.castingAbility).toBe(THATCHGRIN_KIT.swell.fuseName);
    expect(g.castTotal).toBe(THATCHGRIN_KIT.swell.fuse);
    expect(b.auras.some((a) => a.id === HARVEST_WARD_AURA_ID && a.kind === 'buff_dr')).toBe(true);
    // the bar counts down, and the gourd never walks or swings
    const at = { ...g.pos };
    for (let i = 0; i < 40; i++) sim.tick();
    expect(g.castRemaining).toBeLessThan(THATCHGRIN_KIT.swell.fuse - 1.5);
    expect(g.pos).toEqual(at);
  });

  it('wards him while it lives: a hit lands at a fifth', () => {
    const sim = world();
    const { b } = pullTo(sim, THATCHGRIN_KIT.swell.atHpPct[0] - 0.01);
    sim.tick();
    const before = b.hp;
    (sim as any).dealDamage(sim.player, b, 1000, false, 'physical', 'Chip', 'hit', true);
    expect(before - b.hp).toBe(Math.round(1000 * (1 - THATCHGRIN_KIT.swell.ward.reduction)));
  });

  it('broken, it takes the ward with it and he reels: stunned, then split open', () => {
    const sim = world();
    const { b } = pullTo(sim, THATCHGRIN_KIT.swell.atHpPct[0] - 0.01);
    sim.tick();
    const g = gourdOf(sim) as Entity;
    (sim as any).dealDamage(sim.player, g, g.hp + 5, false, 'physical', 'Chip', 'hit', true);
    sim.tick();
    expect(b.auras.some((a) => a.id === HARVEST_WARD_AURA_ID)).toBe(false);
    const stun = b.auras.find((a) => a.id === UPROOTED_AURA_ID);
    expect(stun?.kind).toBe('stun');
    expect(stun?.remaining).toBeGreaterThan(THATCHGRIN_KIT.swell.stagger.seconds - 0.2);
    const rind = b.auras.find((a) => a.id === SPLIT_RIND_AURA_ID);
    expect(rind?.kind).toBe('vulnerability');
    const before = b.hp;
    (sim as any).dealDamage(sim.player, b, 1000, false, 'physical', 'Chip', 'hit', true);
    expect(before - b.hp).toBe(Math.round(1000 * (1 + THATCHGRIN_KIT.swell.exposed.amp)));
    expect(kit(sim).swellId).toBeNull();
    // a stunned scarecrow starts no rain
    kit(sim).rainTimer = 0;
    kit(sim).spacing = 0;
    const cue = spellfxAt(sim.tick(), THATCHGRIN_GOURD_ABILITY);
    expect(cue.filter((e) => e.fx === 'runeCircle')).toHaveLength(0);
  });

  it('unbroken, it bursts over the fight, and never kills a fighter at full health', () => {
    const sim = world();
    const { b } = pullTo(sim, THATCHGRIN_KIT.swell.atHpPct[0] - 0.01);
    const a = sim.addPlayer('priest', 'Cy');
    const ally = engage(sim, a, b, -4);
    // a real health bar this time: the burst is measured against it
    const me = sim.player;
    for (const p of [me, ally]) {
      p.maxHp = 900;
      p.hp = 900;
    }
    // the second fighter grew his pool (and his fraction): bring him back under the line
    sim.tick();
    b.hp = Math.floor(b.maxHp * (THATCHGRIN_KIT.swell.atHpPct[0] - 0.01));
    sim.tick();
    const g = gourdOf(sim) as Entity;
    expect(g).toBeDefined();
    kit(sim).swellFuse = 0.05;
    let burst = false;
    for (let i = 0; i < 4 && !burst; i++) {
      for (const p of [me, ally]) {
        p.hp = p.maxHp;
        p.pos = { ...b.pos, x: b.pos.x + 2 };
      }
      burst = spellfxAt(sim.tick(), THATCHGRIN_SWELL_ABILITY).some((e) => e.fx === 'nova');
    }
    expect(burst).toBe(true);
    expect(sim.entities.has(g.id)).toBe(false);
    for (const p of [me, ally]) {
      expect(p.dead).toBe(false);
      expect(p.hp).toBeGreaterThanOrEqual(1);
      expect(p.hp).toBeLessThan(p.maxHp * 0.5);
    }
    expect(b.auras.some((x) => x.id === HARVEST_WARD_AURA_ID)).toBe(false);
  });

  it('clamps the burst one point short of any health bar', () => {
    for (const maxHp of [1, 2, 50, 120, 900, 25_000]) {
      const dmg = swellingBurstDamage(maxHp);
      expect(dmg).toBeLessThanOrEqual(maxHp - 1);
      expect(dmg).toBeGreaterThanOrEqual(0);
    }
    expect(swellingBurstDamage(1000)).toBe(
      Math.round(1000 * THATCHGRIN_KIT.swell.burst.maxHpShare),
    );
  });

  it('rises once per threshold, and goes with the pull', () => {
    const sim = world();
    const { b } = pullTo(sim, THATCHGRIN_KIT.swell.atHpPct[0] - 0.01);
    sim.tick();
    const first = gourdOf(sim) as Entity;
    (sim as any).dealDamage(
      sim.player,
      first,
      first.hp + 5,
      false,
      'physical',
      'Chip',
      'hit',
      true,
    );
    for (let i = 0; i < 20; i++) sim.tick();
    const live = () =>
      [...sim.entities.values()].filter((e) => e.templateId === SWELLING_GOURD_ID && !e.dead);
    expect(live()).toHaveLength(0);
    b.hp = Math.floor(b.maxHp * (THATCHGRIN_KIT.swell.atHpPct[1] - 0.01));
    sim.tick();
    // under the next threshold already, but the break bought its window: no ward back
    // while he is Uprooted or split open
    expect(live()).toHaveLength(0);
    expect(b.auras.some((x) => x.id === SPLIT_RIND_AURA_ID)).toBe(true);
    for (let i = 0; i < 400 && live().length === 0; i++) {
      b.hp = Math.floor(b.maxHp * (THATCHGRIN_KIT.swell.atHpPct[1] - 0.01));
      sim.tick();
    }
    expect(b.auras.some((x) => x.id === SPLIT_RIND_AURA_ID || x.id === UPROOTED_AURA_ID)).toBe(
      false,
    );
    const second = live()[0];
    expect(second).toBeDefined();
    expect(kit(sim).swellsRisen).toBe(2);
    b.aiState = 'evade';
    sim.tick();
    expect(kit(sim)).toBeNull();
    expect(second ? sim.entities.has(second.id) : true).toBe(false);
    expect(b.auras.some((x) => x.id === HARVEST_WARD_AURA_ID)).toBe(false);
  });

  it('pays nothing and is worth no experience', () => {
    const t = MOBS[SWELLING_GOURD_ID];
    expect(t.loot).toEqual([]);
    expect(t.xpMult).toBe(0);
    expect(t.moveSpeed).toBe(0);
    expect(t.dmgBase).toBe(0);
  });
});

describe('his keepsakes', () => {
  function kill(sim: Sim) {
    const b = standUp(sim);
    engage(sim, sim.playerId, b);
    sim.tick();
    (sim as any).dealDamage(sim.player, b, b.hp + 10, false, 'physical', 'Chip', 'hit', true);
    sim.tick();
    return b;
  }
  const mine = (sim: Sim, b: Entity) =>
    (b.loot?.items ?? []).filter((s) => s.personalFor?.includes(sim.playerId)).map((s) => s.itemId);

  it('pays the pumpkin head and the broom on a first kill', () => {
    const sim = world();
    const b = kill(sim);
    expect(mine(sim, b)).toContain(CARVED_PUMPKIN_HEAD_ID);
    expect(mine(sim, b)).toContain(GOURDLIGHT_BROOM_ID);
  });

  it('never a second copy: owned in the bags or the bank, it is not paid again', () => {
    const sim = world();
    sim.chat('/dev season on');
    sim.tick();
    sim.addItem(CARVED_PUMPKIN_HEAD_ID, 1);
    const meta = (sim as any).players.get(sim.playerId);
    meta.bank.inventory.push({ itemId: GOURDLIGHT_BROOM_ID, count: 1 });
    const b = kill(sim);
    const items = mine(sim, b);
    expect(items).not.toContain(CARVED_PUMPKIN_HEAD_ID);
    expect(items).not.toContain(GOURDLIGHT_BROOM_ID);
    expect(items).toContain(THATCHGRIN_SACK_ID);
  });

  it('keeps the draw order a function of the roster alone (owning a keepsake moves no roll)', () => {
    const run = (owned: boolean) => {
      const sim = world();
      sim.chat('/dev season on');
      sim.tick();
      if (owned) sim.addItem(CARVED_PUMPKIN_HEAD_ID, 1);
      kill(sim);
      return (sim as any).ctx.rng.next();
    };
    expect(run(true)).toBe(run(false));
  });
});

describe('the event-bound broom', () => {
  it('leaves the bags, the bank and the saddle the tick the event closes', () => {
    const sim = world();
    sim.chat('/dev season on');
    sim.tick();
    sim.addItem(GOURDLIGHT_BROOM_ID, 1);
    const meta = (sim as any).players.get(sim.playerId);
    meta.bank.inventory.push({ itemId: GOURDLIGHT_BROOM_ID, count: 1 });
    sim.player.mountKey = GOURDLIGHT_BROOM_MOUNT;
    sim.tick();
    expect(sim.countItem(GOURDLIGHT_BROOM_ID)).toBe(1);
    sim.chat('/dev season off');
    const ev = sim.tick();
    expect(sim.countItem(GOURDLIGHT_BROOM_ID)).toBe(0);
    const inBank = meta.bank.inventory.some(
      (s: { itemId: string }) => s.itemId === GOURDLIGHT_BROOM_ID,
    );
    expect(inBank).toBe(false);
    expect(sim.player.mountKey).toBe('');
    expect(ev.some((e) => e.type === 'seasonal' && e.what === 'boundItemGone')).toBe(true);
  });

  it('bumps every revision the wire and the courier projection key on', () => {
    const sim = world();
    sim.chat('/dev season on');
    sim.tick();
    const meta = (sim as any).players.get(sim.playerId);
    // a bank-only broom still counts toward owned mounts (mntOwn rides wireRev)
    meta.bank.inventory.push({ itemId: GOURDLIGHT_BROOM_ID, count: 1 });
    meta.courier = {
      phase: 'outbound',
      x: 0,
      z: 0,
      bankerId: null,
      travelDistance: 0,
      cargo: [{ itemId: GOURDLIGHT_BROOM_ID, count: 1 }],
      withdrawals: [],
      revision: 7,
      retryRemaining: 0,
    };
    const wire = meta.wireRev;
    const bankRev = meta.bankWireRev;
    // the sweep itself, so no courier tick moves the revision under it
    const gone = sweepEventBoundItems((sim as any).ctx, meta, null);
    expect(gone).toEqual([GOURDLIGHT_BROOM_ID]);
    expect(meta.courier.cargo).toEqual([]);
    expect(meta.courier.revision).toBe(8);
    expect(meta.wireRev).toBeGreaterThan(wire);
    expect(meta.bankWireRev).toBeGreaterThan(bankRev);
  });

  it('is swept on the first tick of a character who logs in after the event ended', () => {
    const sim = world();
    for (let i = 0; i < 3; i++) sim.tick();
    const pid = sim.addPlayer('rogue', 'Late');
    const meta = (sim as any).players.get(pid);
    meta.inventory.push({ itemId: GOURDLIGHT_BROOM_ID, count: 1 });
    sim.tick();
    expect(sim.countItem(GOURDLIGHT_BROOM_ID, pid)).toBe(0);
  });

  it('leaves within seconds when it arrives after its character was checked', () => {
    const sim = world();
    sim.chat('/dev season on');
    sim.tick();
    sim.chat('/dev season off');
    sim.tick();
    // a broom that lands after the close sweep (loot taken off his corpse late, a grant)
    sim.addItem(GOURDLIGHT_BROOM_ID, 1);
    expect(sim.countItem(GOURDLIGHT_BROOM_ID)).toBe(1);
    for (let i = 0; i < BOUND_RECHECK_TICKS + 1; i++) sim.tick();
    expect(sim.countItem(GOURDLIGHT_BROOM_ID)).toBe(0);
  });

  it('stays while the event runs, and leaves ordinary items alone', () => {
    const sim = world();
    sim.chat('/dev season on');
    sim.tick();
    sim.addItem(GOURDLIGHT_BROOM_ID, 1);
    sim.addItem(CARVED_PUMPKIN_HEAD_ID, 1);
    for (let i = 0; i < 5; i++) sim.tick();
    expect(sim.countItem(GOURDLIGHT_BROOM_ID)).toBe(1);
    sim.chat('/dev season off');
    sim.tick();
    expect(sim.countItem(CARVED_PUMPKIN_HEAD_ID)).toBe(1);
  });

  it('is the event-bound, soulbound reins of a base-speed ground mount', () => {
    const def = ITEMS[GOURDLIGHT_BROOM_ID];
    expect(def.kind).toBe('mount');
    expect(def.seasonalEvent).toBe(GOURDLIGHT_EVE_ID);
    expect(def.soulbound).toBe(true);
    expect(MOUNTS[GOURDLIGHT_BROOM_MOUNT as keyof typeof MOUNTS].moveSpeedPct).toBe(
      MOUNTS.valorsteed.moveSpeedPct,
    );
  });
});

describe('/dev scarecrow', () => {
  it('drives every new beat on demand: rain, swell and break', () => {
    const sim = world();
    const b = standUp(sim);
    engage(sim, sim.playerId, b, 3);
    sim.tick();
    sim.chat('/dev scarecrow rain');
    expect((sim as any).ctx.seasonal.scarecrow.kit.rain.length).toBeGreaterThan(0);
    sim.chat('/dev scarecrow swell');
    const g = [...sim.entities.values()].find((e) => e.templateId === SWELLING_GOURD_ID);
    expect(g).toBeDefined();
    sim.chat('/dev scarecrow break');
    sim.tick();
    expect(b.auras.some((a) => a.id === UPROOTED_AURA_ID)).toBe(true);
  });
});
