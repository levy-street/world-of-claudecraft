// The Wildfang Cat Form bleed rework (combat/druid_bleeds.ts): builders and
// the opener plant their own bleeds, Old Blood comes from bleed ticks,
// Redharvest speeds and lengthens bleeds instead of cashing them out, Gorebite
// scales with the bleed count and keeps Bloodrift rolling, three bleeds cut
// healing taken, bleeds crit for energy, and Lynxblood snapshots a bonus.
import { describe, expect, it, vi } from 'vitest';
import {
  BLOODRIFT_DURATION,
  BLOODSCENT_ENERGY,
  feralBleedApplyMult,
  feralBleedOnLandedStrike,
  feralBleedPeriodicHit,
  feralBleedTickRate,
  GOREBITE_PER_BLEED_PCT,
  gorebiteBleedMult,
  LYNXBLOOD_BLEED_MULT,
  OPEN_VEINS_BLEED_VULN,
  OPEN_VEINS_ID,
  OPEN_VEINS_TALENT_ID,
  onFeralBleedApplied,
  openRedTorrent,
  RED_TORRENT_TICK_RATE,
  REDHARVEST_EXTEND_CAP,
  REDHARVEST_EXTEND_SECONDS,
  SCRATCH_WOUND_ID,
  TATTER_ID,
  TATTER_MAX_STACKS,
  WEEPING_WOUNDS_HEAL_CUT,
  WEEPING_WOUNDS_ID,
} from '../src/sim/combat/druid_bleeds';
import { druidEngineOnBleedTick, OLD_BLOOD_ID } from '../src/sim/combat/druid_engines';
import type { onCastCompleted } from '../src/sim/combat/talent_procs';
import { DRUID_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

type Ctx = Parameters<typeof onCastCompleted>[0];

function rig(spec: 'balance' | 'feral' | 'restoration', rows: Record<number, string> = {}) {
  const sim = new Sim({ seed: 41, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  const ctx = (sim as unknown as { ctx: Ctx }).ctx;
  return { sim, player: sim.player, ctx };
}

function formAura(player: Entity, kind: Aura['kind']): Aura {
  return {
    id: kind,
    name: kind,
    kind,
    remaining: 3600,
    duration: 3600,
    value: 0,
    sourceId: player.id,
    school: 'nature',
  };
}

function hostile(sim: Sim, id = 9840): Entity {
  const player = sim.player;
  const mob = createMob(id, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 2,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function bleed(player: Entity, id: string, remaining = 10): Aura {
  return {
    id,
    name: id,
    kind: 'dot',
    remaining,
    duration: remaining,
    value: 10,
    tickInterval: 2,
    tickTimer: 2,
    sourceId: player.id,
    school: 'physical',
  };
}

function own(target: Entity, sourceId: number, id: string): Aura | undefined {
  return target.auras.find((aura) => aura.id === id && aura.sourceId === sourceId);
}

describe('builder and opener bleeds', () => {
  it('Rendclaw stacks Tatter up to five, the value growing per stack', () => {
    const { sim, player, ctx } = rig('feral');
    const mob = hostile(sim);
    feralBleedOnLandedStrike(ctx, player, 'claw', mob);
    const perStack = own(mob, player.id, TATTER_ID)?.value ?? 0;
    expect(perStack).toBeGreaterThan(0);
    for (let press = 0; press < TATTER_MAX_STACKS + 2; press++) {
      feralBleedOnLandedStrike(ctx, player, 'claw', mob);
    }
    const tatter = own(mob, player.id, TATTER_ID);
    expect(tatter?.stacks).toBe(TATTER_MAX_STACKS);
    expect(tatter?.value).toBe(perStack * TATTER_MAX_STACKS);
    expect(tatter?.kind).toBe('dot');
    expect(tatter?.school).toBe('physical');
    // A refresh keeps the running tick clock, so spamming Rendclaw faster
    // than the 2 sec interval never starves the bleed of ticks.
    if (tatter) tatter.tickTimer = 0.5;
    feralBleedOnLandedStrike(ctx, player, 'claw', mob);
    expect(own(mob, player.id, TATTER_ID)?.tickTimer).toBe(0.5);
  });

  it('Scratch bleeds each enemy it struck', () => {
    const { sim, player, ctx } = rig('feral');
    const a = hostile(sim, 9841);
    const b = hostile(sim, 9842);
    feralBleedOnLandedStrike(ctx, player, 'scratch', a);
    feralBleedOnLandedStrike(ctx, player, 'scratch', b);
    expect(own(a, player.id, SCRATCH_WOUND_ID)).toBeDefined();
    expect(own(b, player.id, SCRATCH_WOUND_ID)).toBeDefined();
  });

  it('stays Wildfang-only', () => {
    for (const spec of ['balance', 'restoration'] as const) {
      const { sim, player, ctx } = rig(spec);
      const mob = hostile(sim);
      feralBleedOnLandedStrike(ctx, player, 'claw', mob);
      feralBleedOnLandedStrike(ctx, player, 'scratch', mob);
      expect(mob.auras.some((aura) => aura.kind === 'dot')).toBe(false);
    }
  });
});

describe('Gorebite', () => {
  it('gains 15% per distinct bleed (Tatter counts once) and refreshes Bloodrift', () => {
    const { sim, player, ctx } = rig('feral');
    const mob = hostile(sim);
    expect(gorebiteBleedMult(ctx, player, mob, 'ferocious_bite')).toBe(1);
    mob.auras.push(bleed(player, 'rake'), bleed(player, 'rip', 5));
    feralBleedOnLandedStrike(ctx, player, 'claw', mob);
    feralBleedOnLandedStrike(ctx, player, 'claw', mob);
    expect(gorebiteBleedMult(ctx, player, mob, 'ferocious_bite')).toBeCloseTo(
      1 + 3 * GOREBITE_PER_BLEED_PCT,
      10,
    );
    // Other finishers never read the bleed count.
    expect(gorebiteBleedMult(ctx, player, mob, 'rip')).toBe(1);

    feralBleedOnLandedStrike(ctx, player, 'ferocious_bite', mob);
    expect(own(mob, player.id, 'rip')?.remaining).toBe(BLOODRIFT_DURATION);
  });
});

describe('Weeping Wounds and Open Veins', () => {
  it('three bleeds cut healing taken; two do not', () => {
    const { sim, player, ctx } = rig('feral');
    const mob = hostile(sim);
    mob.auras.push(bleed(player, 'rake'), bleed(player, 'rip'));
    onFeralBleedApplied(ctx, player, mob, 'rip');
    expect(own(mob, player.id, WEEPING_WOUNDS_ID)).toBeUndefined();
    feralBleedOnLandedStrike(ctx, player, 'claw', mob);
    const wound = own(mob, player.id, WEEPING_WOUNDS_ID);
    expect(wound?.kind).toBe('mortal_wound');
    expect(wound?.value).toBe(WEEPING_WOUNDS_HEAL_CUT);
  });

  it('Open Veins rides Bloodrift for its duration only with the row picked', () => {
    const plain = rig('feral');
    const plainMob = hostile(plain.sim);
    plainMob.auras.push(bleed(plain.player, 'rip', 24));
    onFeralBleedApplied(plain.ctx, plain.player, plainMob, 'rip');
    expect(own(plainMob, plain.player.id, OPEN_VEINS_ID)).toBeUndefined();

    const picked = rig('feral', { 14: OPEN_VEINS_TALENT_ID });
    const mob = hostile(picked.sim);
    mob.auras.push(bleed(picked.player, 'rip', 24));
    onFeralBleedApplied(picked.ctx, picked.player, mob, 'rip');
    const veins = own(mob, picked.player.id, OPEN_VEINS_ID);
    expect(veins?.kind).toBe('bleed_vuln');
    expect(veins?.value).toBe(OPEN_VEINS_BLEED_VULN);
    expect(veins?.remaining).toBe(24);
  });

  it('the row option carries the same 15% the sim applies', () => {
    const option = DRUID_CHOICE_ROWS.rows
      .flatMap((row) => row.options)
      .find((entry) => entry.id === OPEN_VEINS_TALENT_ID);
    expect(option?.name).toBe('Open Veins');
    expect(option?.effect.intrinsic?.metrics.pct).toBe(OPEN_VEINS_BLEED_VULN);
  });
});

describe('Redharvest and Red Torrent', () => {
  it('extends Flense and Bloodrift by 8 sec (cap 16) instead of consuming them', () => {
    for (const effects of [
      ABILITIES.redharvest.effects,
      ...(ABILITIES.redharvest.ranks ?? []).map((rank) => rank.effects),
    ]) {
      expect(effects.some((effect) => effect.type === 'consumeDot')).toBe(false);
      const extended = effects
        .filter((effect) => effect.type === 'extendDot')
        .map((effect) => (effect.type === 'extendDot' ? effect.dot : ''));
      expect(extended.sort()).toEqual(['rake', 'rip']);
      for (const effect of effects) {
        if (effect.type !== 'extendDot') continue;
        expect(effect.seconds).toBe(REDHARVEST_EXTEND_SECONDS);
        expect(effect.maxBonus).toBe(REDHARVEST_EXTEND_CAP);
      }
    }
  });

  it('speeds only your own bleeds on the Redharvest target', () => {
    const { sim, player, ctx } = rig('feral');
    const mob = hostile(sim, 9843);
    const other = hostile(sim, 9844);
    const onTarget = bleed(player, 'rake');
    const onOther = bleed(player, 'rake');
    mob.auras.push(onTarget);
    other.auras.push(onOther);
    expect(feralBleedTickRate(ctx, mob, onTarget)).toBe(1);
    openRedTorrent(ctx, player, mob);
    expect(feralBleedTickRate(ctx, mob, onTarget)).toBe(RED_TORRENT_TICK_RATE);
    expect(feralBleedTickRate(ctx, other, onOther)).toBe(1);
    // A non-bleed aura on the same target is untouched.
    expect(feralBleedTickRate(ctx, mob, { ...onTarget, id: 'moonfire', school: 'arcane' })).toBe(1);
  });
});

describe('Old Blood from bleed ticks', () => {
  it('banks in Cat Form at most once per two seconds, never outside it', () => {
    const { sim, player, ctx } = rig('feral');
    const mob = hostile(sim);
    const rake = bleed(player, 'rake');
    mob.auras.push(rake);

    druidEngineOnBleedTick(ctx, player, rake, mob);
    expect(player.auras.some((aura) => aura.id === OLD_BLOOD_ID)).toBe(false);

    player.auras.push(formAura(player, 'form_cat'));
    druidEngineOnBleedTick(ctx, player, rake, mob);
    druidEngineOnBleedTick(ctx, player, rake, mob);
    expect(player.auras.find((aura) => aura.id === OLD_BLOOD_ID)?.stacks).toBe(1);
  });
});

describe('Bloodscent and Lynxblood', () => {
  it('a bleed crit doubles the tick and restores energy in Cat Form', () => {
    const { player, ctx } = rig('feral');
    player.auras.push(formAura(player, 'form_cat'));
    player.resourceType = 'energy';
    player.maxResource = 100;
    player.resource = 50;
    const rake = bleed(player, 'rake');
    const spy = vi.spyOn(ctx.rng, 'chance').mockReturnValue(true);
    const hit = feralBleedPeriodicHit(ctx, player, rake, 20);
    spy.mockRestore();
    expect(hit.crit).toBe(true);
    expect(hit.amount).toBe(Math.round(20 * (2 + player.critDmgPhysBonus)));
    expect(player.resource).toBe(50 + BLOODSCENT_ENERGY);
  });

  it('draws no rng for a tick that is not a feral bleed', () => {
    const { player, ctx } = rig('balance');
    const spy = vi.spyOn(ctx.rng, 'chance');
    const hit = feralBleedPeriodicHit(ctx, player, bleed(player, 'rake'), 20);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(hit).toEqual({ amount: 20, crit: false });
  });

  it('Lynxblood lasts 10 sec and snapshots +20% into bleeds applied under it', () => {
    const fury = ABILITIES.tigers_fury.effects.find((effect) => effect.type === 'selfBuff');
    expect(fury?.type === 'selfBuff' ? fury.duration : 0).toBe(10);
    const { player, ctx } = rig('feral');
    expect(feralBleedApplyMult(ctx, player, 'rake')).toBe(1);
    player.auras.push({ ...formAura(player, 'buff_ap'), id: 'tigers_fury', value: 40 });
    expect(feralBleedApplyMult(ctx, player, 'rake')).toBe(LYNXBLOOD_BLEED_MULT);
    expect(feralBleedApplyMult(ctx, player, 'moonfire')).toBe(1);
  });
});
