import { describe, expect, it } from 'vitest';
import { buildAbilityOutputScaling } from '../src/sim/ability_output_scaling';
import {
  captureDirgeReapplication,
  DIRGE_ABILITY_ID,
  DIRGE_BASE_DURATION,
  DIRGE_MAX_DURATION,
  refreshDirgeFieldAfterReapplication,
} from '../src/sim/combat/priest/dirge_refresh';
import {
  EFFIGY_AURA_ID,
  LIVING_COVENANT_MAX_EXTENSION,
  VESPERS_DOT_DAMAGE_MULT,
  vespersDirgeSpMultiplier,
} from '../src/sim/combat/priest/vespers';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

function vespersPriest(seed: number): { sim: Sim; priest: Entity; ctx: SimContext } {
  const sim = new Sim({ seed, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('shadow')).toBe(true);
  sim.tick();
  sim.player.resource = sim.player.maxResource;
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  return { sim, priest: sim.player, ctx };
}

let nextDummyId = 40000;

function addDummy(sim: Sim, priest: Entity, dx: number, dz: number): Entity {
  const mob = createMob(nextDummyId++, MOBS.training_dummy, 20, {
    x: priest.pos.x + dx,
    y: priest.pos.y,
    z: priest.pos.z + dz,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 100000;
  mob.aiState = 'idle';
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function ownDirgeOf(entity: Entity, priestId: number): Aura | undefined {
  return entity.auras.find(
    (aura) => aura.id === DIRGE_ABILITY_ID && aura.kind === 'dot' && aura.sourceId === priestId,
  );
}

function pushOwnDirge(target: Entity, priestId: number, overrides: Partial<Aura> = {}): Aura {
  const aura: Aura = {
    id: DIRGE_ABILITY_ID,
    name: 'Dirge of Decay',
    kind: 'dot',
    remaining: 18,
    duration: 18,
    value: 10,
    tickInterval: 3,
    tickTimer: 3,
    sourceId: priestId,
    school: 'shadow',
    ...overrides,
  };
  target.auras.push(aura);
  return aura;
}

/** Simulates exactly what effect_dispatch.ts's 'dot' case does on a successful
 * Dirge (re)cast: replace `target`'s own Dirge (if any) with a fresh aura
 * carrying `freshValue`, via the before/after capture pair my helpers expect. */
function recastDirge(
  ctx: SimContext,
  priest: Entity,
  meta: ReturnType<SimContext['players']['get']>,
  target: Entity,
  freshValue: number,
  range?: number,
): void {
  if (!meta) throw new Error('priest meta missing');
  const prior = captureDirgeReapplication(target, priest.id);
  const index = target.auras.findIndex(
    (aura) => aura.id === DIRGE_ABILITY_ID && aura.sourceId === priest.id,
  );
  if (index >= 0) target.auras.splice(index, 1);
  target.auras.push({
    id: DIRGE_ABILITY_ID,
    name: 'Dirge of Decay',
    kind: 'dot',
    remaining: DIRGE_BASE_DURATION,
    duration: DIRGE_BASE_DURATION,
    value: freshValue,
    tickInterval: 3,
    tickTimer: 3,
    sourceId: priest.id,
    school: 'shadow',
  });
  refreshDirgeFieldAfterReapplication(ctx, priest, meta, target, prior, range);
}

describe('v0.42.0 Vespers: Dirge range-wide refresh', () => {
  it('does nothing on a first application (no prior own Dirge on the primary target)', () => {
    const { sim, priest, ctx } = vespersPriest(50401);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    const secondary = addDummy(sim, priest, 4, 6);
    pushOwnDirge(secondary, priest.id, { remaining: 4, duration: 4, value: 3 });

    const prior = captureDirgeReapplication(primary, priest.id);
    expect(prior.priorAura).toBeNull();
    primary.auras.push({
      id: DIRGE_ABILITY_ID,
      name: 'Dirge of Decay',
      kind: 'dot',
      remaining: DIRGE_BASE_DURATION,
      duration: DIRGE_BASE_DURATION,
      value: 30,
      tickInterval: 3,
      tickTimer: 3,
      sourceId: priest.id,
      school: 'shadow',
    });
    refreshDirgeFieldAfterReapplication(ctx, priest, meta, primary, prior);

    const secondaryDirge = ownDirgeOf(secondary, priest.id);
    expect(secondaryDirge?.value).toBe(3);
    expect(secondaryDirge?.remaining).toBe(4);
  });

  it('refreshes every other living own-Dirge hostile within range on a genuine reapplication, with no cap', () => {
    const { sim, priest, ctx } = vespersPriest(50402);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const secondaries = Array.from({ length: 5 }, (_, i) => {
      const mob = addDummy(sim, priest, (i + 1) * 4, 6);
      pushOwnDirge(mob, priest.id, { remaining: 4, duration: 4 });
      return mob;
    });

    recastDirge(ctx, priest, meta, primary, 77);

    for (const secondary of secondaries) {
      const dirge = ownDirgeOf(secondary, priest.id);
      expect(dirge?.value).toBe(77);
      expect(dirge?.remaining).toBe(DIRGE_BASE_DURATION);
      expect(dirge?.duration).toBe(DIRGE_BASE_DURATION);
    }
  });

  it('never spreads to or recreates a Dirge on a clean (never-dotted) hostile', () => {
    const { sim, priest, ctx } = vespersPriest(50403);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const clean = addDummy(sim, priest, 4, 6);

    recastDirge(ctx, priest, meta, primary, 55);

    expect(ownDirgeOf(clean, priest.id)).toBeUndefined();
  });

  it('never refreshes a Dirge owned by a different priest', () => {
    const { sim, priest, ctx } = vespersPriest(50404);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const otherPriestId = priest.id + 5000;
    const otherOwned = addDummy(sim, priest, 4, 6);
    const stranger = pushOwnDirge(otherOwned, otherPriestId, { remaining: 5, duration: 5 });

    recastDirge(ctx, priest, meta, primary, 55);

    const after = otherOwned.auras.find((a) => a.id === DIRGE_ABILITY_ID);
    expect(after).toBe(stranger);
    expect(after?.value).toBe(10);
    expect(after?.remaining).toBe(5);
  });

  it('includes a hostile exactly at the 30-yard boundary and excludes one just outside it', () => {
    const { sim, priest, ctx } = vespersPriest(50405);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const atBoundary = addDummy(sim, priest, 0, 30);
    pushOwnDirge(atBoundary, priest.id, { remaining: 4, duration: 4 });
    const justOutside = addDummy(sim, priest, 0, 30.5);
    pushOwnDirge(justOutside, priest.id, { remaining: 4, duration: 4 });

    recastDirge(ctx, priest, meta, primary, 42);

    expect(ownDirgeOf(atBoundary, priest.id)?.value).toBe(42);
    expect(ownDirgeOf(justOutside, priest.id)?.value).toBe(10);
  });

  it('excludes a hostile with no line of sight to the priest', () => {
    const { sim, priest, ctx } = vespersPriest(50406);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const blocked = addDummy(sim, priest, 6, 6);
    pushOwnDirge(blocked, priest.id, { remaining: 4, duration: 4 });
    const visible = addDummy(sim, priest, -6, 6);
    pushOwnDirge(visible, priest.id, { remaining: 4, duration: 4 });
    const realLos = ctx.hasLineOfSight;
    ctx.hasLineOfSight = (source, target) =>
      target.id === blocked.id ? false : realLos(source, target);

    recastDirge(ctx, priest, meta, primary, 33);

    expect(ownDirgeOf(blocked, priest.id)?.value).toBe(10);
    expect(ownDirgeOf(visible, priest.id)?.value).toBe(33);
  });

  it('preserves each recipient own next-tick timing and same-tick Gloomtithe guard (never grants an instant tick)', () => {
    const { sim, priest, ctx } = vespersPriest(50407);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id, { tickTimer: 0.4, gloomtitheTick: 7 });
    const secondary = addDummy(sim, priest, 4, 6);
    pushOwnDirge(secondary, priest.id, {
      remaining: 4,
      duration: 4,
      tickTimer: 1.2,
      gloomtitheTick: 9,
    });

    recastDirge(ctx, priest, meta, primary, 20);

    // Both the primary (the actual cast target) and the secondary (spread
    // via range) keep their OWN prior next-tick timing and same-tick guard:
    // the refresh never grants an instant tick or a same-tick double
    // Gloomtithe grant on either.
    expect(ownDirgeOf(primary, priest.id)?.tickTimer).toBe(0.4);
    expect(ownDirgeOf(primary, priest.id)?.gloomtitheTick).toBe(7);
    expect(ownDirgeOf(secondary, priest.id)?.tickTimer).toBe(1.2);
    expect(ownDirgeOf(secondary, priest.id)?.gloomtitheTick).toBe(9);
  });

  it('carries a currently-live extension (remaining > 18) forward within the 24-second cap without resetting it', () => {
    const { sim, priest, ctx } = vespersPriest(50408);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const extended = addDummy(sim, priest, 4, 6);
    pushOwnDirge(extended, priest.id, { remaining: 22, duration: 22, extendedBy: 4 });
    const maxedOut = addDummy(sim, priest, -4, 6);
    pushOwnDirge(maxedOut, priest.id, {
      remaining: DIRGE_MAX_DURATION,
      duration: DIRGE_MAX_DURATION,
      extendedBy: LIVING_COVENANT_MAX_EXTENSION,
    });
    const neverExtended = addDummy(sim, priest, 0, -6);
    pushOwnDirge(neverExtended, priest.id, { remaining: 2, duration: 18 });
    // A remaining above the 24s cap (should never occur in real play) still clamps.
    const overCapStale = addDummy(sim, priest, 8, -8);
    pushOwnDirge(overCapStale, priest.id, { remaining: 30, duration: 30 });

    recastDirge(ctx, priest, meta, primary, 11);

    const extendedAfter = ownDirgeOf(extended, priest.id);
    expect(extendedAfter?.extendedBy).toBe(4);
    expect(extendedAfter?.duration).toBe(22);
    expect(extendedAfter?.remaining).toBe(22);

    const maxedAfter = ownDirgeOf(maxedOut, priest.id);
    expect(maxedAfter?.extendedBy).toBe(LIVING_COVENANT_MAX_EXTENSION);
    expect(maxedAfter?.duration).toBe(DIRGE_MAX_DURATION);
    expect(maxedAfter?.remaining).toBe(DIRGE_MAX_DURATION);

    const neverAfter = ownDirgeOf(neverExtended, priest.id);
    expect(neverAfter?.extendedBy).toBeUndefined();
    expect(neverAfter?.duration).toBe(DIRGE_BASE_DURATION);
    expect(neverAfter?.remaining).toBe(DIRGE_BASE_DURATION);

    const overCapAfter = ownDirgeOf(overCapStale, priest.id);
    expect(overCapAfter?.extendedBy).toBe(LIVING_COVENANT_MAX_EXTENSION);
    expect(overCapAfter?.duration).toBe(DIRGE_MAX_DURATION);
    expect(overCapAfter?.remaining).toBe(DIRGE_MAX_DURATION);
  });

  it('does NOT restore a stored extendedBy allowance once its live time already elapsed', () => {
    const { sim, priest, ctx } = vespersPriest(50414);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    // Historically extended to 22s (extendedBy: 4), but has since ticked down
    // to 10s remaining: the extension time has already been spent/elapsed, so
    // a refresh must reset to the plain 18s base, NOT restore 22.
    const spent = addDummy(sim, priest, 4, 6);
    pushOwnDirge(spent, priest.id, { remaining: 10, duration: 22, extendedBy: 4 });

    recastDirge(ctx, priest, meta, primary, 5);

    const after = ownDirgeOf(spent, priest.id);
    expect(after?.extendedBy).toBeUndefined();
    expect(after?.duration).toBe(DIRGE_BASE_DURATION);
    expect(after?.remaining).toBe(DIRGE_BASE_DURATION);
  });

  it('carries currently-live time above 18s even with no extendedBy field recorded', () => {
    const { sim, priest, ctx } = vespersPriest(50415);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const stillExtended = addDummy(sim, priest, 4, 6);
    pushOwnDirge(stillExtended, priest.id, { remaining: 20, duration: 20 });

    recastDirge(ctx, priest, meta, primary, 5);

    const after = ownDirgeOf(stillExtended, priest.id);
    expect(after?.extendedBy).toBe(2);
    expect(after?.duration).toBe(20);
    expect(after?.remaining).toBe(20);
  });

  it('keeps an already-bound own Effigy in step with its Dirge without rebinding or granting Gloomtithe', () => {
    const { sim, priest, ctx } = vespersPriest(50409);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const primaryEffigy: Aura = {
      id: EFFIGY_AURA_ID,
      name: 'Effigy',
      kind: 'hex',
      remaining: 5,
      duration: 5,
      value: 0.3,
      sourceId: priest.id,
      school: 'shadow',
    };
    primary.auras.push(primaryEffigy);
    const secondary = addDummy(sim, priest, 4, 6);
    pushOwnDirge(secondary, priest.id, { remaining: 6, duration: 6 });
    const secondaryEffigy: Aura = { ...primaryEffigy };
    secondary.auras.push(secondaryEffigy);
    const gloomBefore = priest.auras.find((a) => a.kind === 'gloomtithe');

    recastDirge(ctx, priest, meta, primary, 9);

    const primaryEffigyAfter = primary.auras.filter((a) => a.id === EFFIGY_AURA_ID);
    expect(primaryEffigyAfter).toHaveLength(1);
    expect(primaryEffigyAfter[0]).toBe(primaryEffigy); // never rebound: same object
    expect(primaryEffigyAfter[0].remaining).toBe(DIRGE_BASE_DURATION);
    expect(primaryEffigyAfter[0].duration).toBe(DIRGE_BASE_DURATION);

    const secondaryEffigyAfter = secondary.auras.filter((a) => a.id === EFFIGY_AURA_ID);
    expect(secondaryEffigyAfter).toHaveLength(1);
    expect(secondaryEffigyAfter[0]).toBe(secondaryEffigy);
    expect(secondaryEffigyAfter[0].remaining).toBe(DIRGE_BASE_DURATION);
    expect(secondaryEffigyAfter[0].duration).toBe(DIRGE_BASE_DURATION);

    expect(priest.auras.find((a) => a.kind === 'gloomtithe')).toBe(gloomBefore);
  });

  it('is inert for a non-Vespers-spec priest even with a prior own Dirge captured', () => {
    const { sim, priest, ctx } = vespersPriest(50410);
    expect(sim.setSpec('holy')).toBe(true);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    // Own Dirge is a Shadow-only spell in real play; the guard is what matters
    // here, not whether a Holy priest could realistically hold one.
    pushOwnDirge(primary, priest.id);
    const secondary = addDummy(sim, priest, 4, 6);
    pushOwnDirge(secondary, priest.id, { remaining: 4, duration: 4 });

    const prior = captureDirgeReapplication(primary, priest.id);
    refreshDirgeFieldAfterReapplication(ctx, priest, meta, primary, prior);

    expect(ownDirgeOf(secondary, priest.id)?.value).toBe(10);
    expect(ownDirgeOf(secondary, priest.id)?.remaining).toBe(4);
  });

  it('is inert when the primary target is an enemy player rather than a mob', () => {
    const { sim, priest, ctx } = vespersPriest(50416);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const enemyPlayerId = sim.addPlayer('warrior', 'Enemy Player');
    const enemyPlayer = sim.entities.get(enemyPlayerId);
    if (!enemyPlayer) throw new Error('enemy player missing');
    enemyPlayer.pos.x = priest.pos.x;
    enemyPlayer.pos.z = priest.pos.z + 8;
    pushOwnDirge(enemyPlayer, priest.id);
    const mob = addDummy(sim, priest, 4, 6);
    pushOwnDirge(mob, priest.id, { remaining: 4, duration: 4 });

    recastDirge(ctx, priest, meta, enemyPlayer, 88);

    expect(ownDirgeOf(mob, priest.id)?.value).toBe(10);
    expect(ownDirgeOf(mob, priest.id)?.remaining).toBe(4);
  });

  it('never spreads to an enemy player carrying the own Dirge, even if it is otherwise in range', () => {
    const { sim, priest, ctx } = vespersPriest(50417);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const enemyPlayerId = sim.addPlayer('warrior', 'Bystander');
    const enemyPlayer = sim.entities.get(enemyPlayerId);
    if (!enemyPlayer) throw new Error('enemy player missing');
    enemyPlayer.pos.x = priest.pos.x + 4;
    enemyPlayer.pos.z = priest.pos.z + 6;
    pushOwnDirge(enemyPlayer, priest.id, { remaining: 4, duration: 4 });
    // Force the candidate scan to surface the player entity, proving the
    // kind==='mob' filter (not the normal hostility scan) is what excludes
    // it: real PvP hostility is a separate, unrelated system.
    const realHostilesInRadius = ctx.hostilesInRadius;
    ctx.hostilesInRadius = (source, pos, radius) => [
      ...realHostilesInRadius(source, pos, radius),
      enemyPlayer,
    ];

    recastDirge(ctx, priest, meta, primary, 66);

    expect(ownDirgeOf(enemyPlayer, priest.id)?.value).toBe(10);
    expect(ownDirgeOf(enemyPlayer, priest.id)?.remaining).toBe(4);
  });

  it('does not fan out when the seam apply was rejected (the old aura object is retained)', () => {
    const { sim, priest, ctx } = vespersPriest(50418);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    const priorAuraObj = pushOwnDirge(primary, priest.id);
    const secondary = addDummy(sim, priest, 4, 6);
    pushOwnDirge(secondary, priest.id, { remaining: 4, duration: 4 });

    const prior = captureDirgeReapplication(primary, priest.id);
    // Simulate a REJECTED seam apply: nothing actually changed on primary.auras.
    refreshDirgeFieldAfterReapplication(ctx, priest, meta, primary, prior);

    expect(ownDirgeOf(primary, priest.id)).toBe(priorAuraObj);
    expect(ownDirgeOf(secondary, priest.id)?.value).toBe(10);
    expect(ownDirgeOf(secondary, priest.id)?.remaining).toBe(4);
  });

  it('may have its own recipient apply rejected; only syncs that recipient Effigy on proven success', () => {
    const { sim, priest, ctx } = vespersPriest(50419);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const rejected = addDummy(sim, priest, 4, 6);
    pushOwnDirge(rejected, priest.id, { remaining: 4, duration: 4 });
    const rejectedEffigy: Aura = {
      id: EFFIGY_AURA_ID,
      name: 'Effigy',
      kind: 'hex',
      remaining: 4,
      duration: 4,
      value: 0.3,
      sourceId: priest.id,
      school: 'shadow',
    };
    rejected.auras.push(rejectedEffigy);
    const realApplyAura = ctx.applyAura;
    ctx.applyAura = (target, aura) => {
      if (target.id === rejected.id) return; // simulate a rejected recipient apply
      realApplyAura(target, aura);
    };

    recastDirge(ctx, priest, meta, primary, 99);

    expect(ownDirgeOf(rejected, priest.id)?.value).toBe(10);
    expect(rejectedEffigy.remaining).toBe(4);
    expect(rejectedEffigy.duration).toBe(4);
  });

  it('accepts a caller-resolved range beyond the authored default', () => {
    const { sim, priest, ctx } = vespersPriest(50420);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const beyondDefaultRange = addDummy(sim, priest, 0, 40);
    pushOwnDirge(beyondDefaultRange, priest.id, { remaining: 4, duration: 4 });

    recastDirge(ctx, priest, meta, primary, 44, 50);

    expect(ownDirgeOf(beyondDefaultRange, priest.id)?.value).toBe(44);
    expect(ownDirgeOf(beyondDefaultRange, priest.id)?.remaining).toBe(DIRGE_BASE_DURATION);
  });

  it('excludes with the authored default range when no custom range is supplied', () => {
    const { sim, priest, ctx } = vespersPriest(50421);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    const beyondDefaultRange = addDummy(sim, priest, 0, 40);
    pushOwnDirge(beyondDefaultRange, priest.id, { remaining: 4, duration: 4 });

    recastDirge(ctx, priest, meta, primary, 44);

    expect(ownDirgeOf(beyondDefaultRange, priest.id)?.value).toBe(10);
  });
});

describe('v0.42.0 Vespers: Dirge runtime Spell Power correction', () => {
  it('exposes a 1.10 runtime SP multiplier for a Shadow priest, matching the authored VESPERS_DOT_DAMAGE_MULT', () => {
    const { priest, ctx } = vespersPriest(50411);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    expect(vespersDirgeSpMultiplier(meta)).toBe(VESPERS_DOT_DAMAGE_MULT);
  });

  it('is a no-op factor of 1 for a non-Vespers priest spec', () => {
    const { sim, priest, ctx } = vespersPriest(50412);
    expect(sim.setSpec('holy')).toBe(true);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    expect(vespersDirgeSpMultiplier(meta)).toBe(1);
  });
});

describe('v0.42.0 Vespers: Dirge refresh, effect_dispatch.ts integration', () => {
  it('a real shadow_word_pain recast through castAbility refreshes a second hostile own Dirge about to expire', () => {
    const { sim, priest } = vespersPriest(50413);
    const primary = addDummy(sim, priest, 0, 8);
    const secondary = addDummy(sim, priest, 4, 6);
    priest.gcdRemaining = 0;
    priest.resource = priest.maxResource;
    priest.cooldowns.delete(DIRGE_ABILITY_ID);
    priest.hitBonus = 1;
    sim.targetEntity(primary.id, priest.id);
    sim.castAbility(DIRGE_ABILITY_ID, priest.id);
    for (let tick = 0; tick < 100; tick++) sim.tick();
    sim.targetEntity(secondary.id, priest.id);
    sim.castAbility(DIRGE_ABILITY_ID, priest.id);
    for (let tick = 0; tick < 100; tick++) sim.tick();
    const secondaryDirge = ownDirgeOf(secondary, priest.id);
    if (!secondaryDirge) throw new Error('expected a Dirge on secondary');
    secondaryDirge.remaining = 0.5;

    priest.gcdRemaining = 0;
    priest.resource = priest.maxResource;
    priest.cooldowns.delete(DIRGE_ABILITY_ID);
    sim.targetEntity(primary.id, priest.id);
    sim.castAbility(DIRGE_ABILITY_ID, priest.id);
    // shadow_word_pain fires as a traveling projectile spellfx; give it time
    // to land before reading the result (a single tick is not enough).
    for (let tick = 0; tick < 20; tick++) sim.tick();

    expect(ownDirgeOf(secondary, priest.id)?.remaining).toBeGreaterThan(15);
  });

  it('a real recast also carries the runtime Spell Power correction into the refreshed field', () => {
    const { sim, priest } = vespersPriest(50422);
    const primary = addDummy(sim, priest, 0, 8);
    const secondary = addDummy(sim, priest, 4, 6);
    priest.gcdRemaining = 0;
    priest.resource = priest.maxResource;
    priest.cooldowns.delete(DIRGE_ABILITY_ID);
    priest.hitBonus = 1;
    priest.spellPower = 100;
    sim.targetEntity(primary.id, priest.id);
    sim.castAbility(DIRGE_ABILITY_ID, priest.id);
    for (let tick = 0; tick < 100; tick++) sim.tick();
    sim.targetEntity(secondary.id, priest.id);
    sim.castAbility(DIRGE_ABILITY_ID, priest.id);
    for (let tick = 0; tick < 100; tick++) sim.tick();

    priest.gcdRemaining = 0;
    priest.resource = priest.maxResource;
    priest.cooldowns.delete(DIRGE_ABILITY_ID);
    sim.targetEntity(primary.id, priest.id);
    sim.castAbility(DIRGE_ABILITY_ID, priest.id);
    // Give the projectile time to land (see the previous test's note).
    for (let tick = 0; tick < 20; tick++) sim.tick();

    const primaryValue = ownDirgeOf(primary, priest.id)?.value;
    const secondaryValue = ownDirgeOf(secondary, priest.id)?.value;
    expect(primaryValue).toBeGreaterThan(0);
    expect(secondaryValue).toBe(primaryValue);
  });

  it('a real cast delta pins the Vespers SP correction, not just the exposed constant', () => {
    const { sim, priest } = vespersPriest(50423);
    const primary = addDummy(sim, priest, 0, 8);
    priest.gcdRemaining = 0;
    priest.resource = priest.maxResource;
    priest.cooldowns.delete(DIRGE_ABILITY_ID);
    priest.hitBonus = 1;
    priest.spellPower = 0;
    sim.targetEntity(primary.id, priest.id);
    sim.castAbility(DIRGE_ABILITY_ID, priest.id);
    // Traveling projectile spellfx; give it time to land (see the recast test above).
    for (let tick = 0; tick < 20; tick++) sim.tick();
    const baseValue = ownDirgeOf(primary, priest.id)?.value;
    if (baseValue === undefined) throw new Error('expected a Dirge on primary');

    priest.gcdRemaining = 0;
    priest.resource = priest.maxResource;
    priest.cooldowns.delete(DIRGE_ABILITY_ID);
    priest.spellPower = 100;
    sim.targetEntity(primary.id, priest.id);
    sim.castAbility(DIRGE_ABILITY_ID, priest.id);
    for (let tick = 0; tick < 20; tick++) sim.tick();
    const spValue = ownDirgeOf(primary, priest.id)?.value;
    if (spValue === undefined) throw new Error('expected a refreshed Dirge on primary');

    // dotTickBonus is round(power * coeff * mult); at spellPower 0 that term is
    // 0 for any mult, so baseValue is the SP-free base and cancels out of the
    // delta. shadow_word_pain: 18s/3s dot, coeff (18/15)/6 = 0.2. mult stacks
    // THREE authored sources, all additive into talentDmgMult before the
    // Vespers rider: Vespers mastery spellDmgPct 0.10 (talents_classic.ts) +
    // spec_baselines.ts shadow spellDmgPct 0.15 + its shadow_word_pain-only
    // dmgPct 0.20 => talentDmgMult = 1 + 0.25 + 0.20 = 1.45. Times
    // (1 + dotDmgPct 0.15) times VESPERS_DOT_DAMAGE_MULT 1.10:
    // 1.45 * 1.15 * 1.10 = 1.83425. round(100 * 0.2 * 1.83425) = 37. Drop the
    // 1.10 rider and it falls to 33 (1.45 * 1.15 = 1.6675): a 4-point delta a
    // removed rider cannot fake.
    expect(spValue - baseValue).toBe(37);
  });
});

describe('v0.42.0 Vespers: Dirge fan-out event order', () => {
  it('fans out in ascending hostile-id order, not spatial-grid bucket order', () => {
    const { sim, priest, ctx } = vespersPriest(50440);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const primary = addDummy(sim, priest, 0, 8);
    pushOwnDirge(primary, priest.id);
    // Lower id, placed EAST (larger x -> larger spatial-grid cx bucket).
    const lowerIdEast = addDummy(sim, priest, 20, 6);
    pushOwnDirge(lowerIdEast, priest.id, { remaining: 4, duration: 4 });
    // Higher id, placed WEST (smaller cx bucket, visited FIRST by
    // hostilesInRadius's cx-ascending walk): grid order would visit this
    // HIGHER id before the lower one above, the opposite of ascending-id order.
    const higherIdWest = addDummy(sim, priest, -20, 6);
    pushOwnDirge(higherIdWest, priest.id, { remaining: 4, duration: 4 });
    expect(higherIdWest.id).toBeGreaterThan(lowerIdEast.id);

    sim.drainEvents();
    recastDirge(ctx, priest, meta, primary, 90);

    const fanoutTargetOrder = sim
      .drainEvents()
      .filter(
        (ev): ev is Extract<SimEvent, { type: 'aura' }> =>
          ev.type === 'aura' &&
          ev.gained === true &&
          ev.abilityId === DIRGE_ABILITY_ID &&
          ev.targetId !== primary.id,
      )
      .map((ev) => ev.targetId);

    // Match doctrine_rescue.ts's id-sorted candidate order (roster-independent
    // event order) instead of leaking the spatial grid's bucket order.
    expect(fanoutTargetOrder).toEqual([lowerIdEast.id, higherIdWest.id]);
  });
});

describe('v0.42.0 Vespers: Dirge base duration stays in step with the carry constant', () => {
  it("pins shadow_word_pain's authored dot duration (every rank) against DIRGE_BASE_DURATION", () => {
    const ability = ABILITIES[DIRGE_ABILITY_ID];
    if (!ability) throw new Error('shadow_word_pain ability missing from ABILITIES');
    const dotDuration = (effect: { type: string; duration?: number } | undefined): number => {
      if (effect?.type !== 'dot' || effect.duration === undefined) {
        throw new Error('expected shadow_word_pain rank effect to be a dot with a duration');
      }
      return effect.duration;
    };
    const durations = [
      dotDuration(ability.effects[0]),
      ...(ability.ranks ?? []).map((rank) => dotDuration(rank.effects[0])),
    ];
    for (const duration of durations) {
      expect(duration).toBe(DIRGE_BASE_DURATION);
    }
  });
});

describe('v0.42.0 Vespers: DIRGE_ABILITY_ID stays canonical', () => {
  it('ability_output_scaling.ts matches the imported dirge_refresh.ts id', () => {
    const { priest, ctx } = vespersPriest(50441);
    const meta = ctx.players.get(priest.id);
    if (!meta) throw new Error('priest meta missing');
    const ability = ABILITIES[DIRGE_ABILITY_ID];
    if (!ability) throw new Error('shadow_word_pain ability missing from ABILITIES');

    // Swapping ONLY `spec` isolates the ability-id match: if ability_output_scaling.ts's
    // own DIRGE_ABILITY_ID ever drifts from the one imported here, shadow_word_pain stops
    // matching it and this ratio collapses from 1.1 to 1.
    const shadowScaling = buildAbilityOutputScaling(ability, 'priest', meta.talentMods);
    const nonShadowScaling = buildAbilityOutputScaling(ability, 'priest', {
      ...meta.talentMods,
      spec: 'holy',
    });

    expect(nonShadowScaling.dot).toBeGreaterThan(0);
    expect(shadowScaling.dot / nonShadowScaling.dot).toBeCloseTo(1.1, 6);
  });
});
