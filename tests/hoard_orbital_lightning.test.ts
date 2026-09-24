import { describe, expect, it, vi } from 'vitest';
import { HoardBossCueMirror } from '../src/net/hoard_boss_cue_mirror';
import { updateMobCombatProfile } from '../src/sim/mob/combat_profile';
import { hoardBossCueViews, tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import { holdHoardOrbitalLightning } from '../src/sim/rift/hoard_orbital_lightning';
import {
  ORBITAL_LIGHTNING,
  orbitalAngle,
  orbitalShotTime,
  orbitalTarget,
} from '../src/sim/rift/hoard_orbital_lightning_core';
import { HOARD_RARITY_PRESSURE } from '../src/sim/rift/hoard_scaling';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { setLanguage } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

function encounter(startOrbital = true) {
  const sim = new Sim({ seed: 9321, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.enterRift(makeVaultSeed(3, 183), 23, sim.player.id, undefined, {
    ...sim.player,
    id: -1,
    vaultOwnerPid: sim.player.id,
    vaultRarity: 'legendary',
  });
  const inst = sim.riftInstances.find((entry) => entry.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing Hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  boss.templateId = 'rift_boss_storm';
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  sim.player.pos = { ...boss.pos, z: boss.pos.z + 5 };
  tickHoardBossMechanics(sim.ctx);
  const state = inst.hoardBoss;
  if (!state) throw new Error('missing boss state');
  sim.drainEvents();
  if (startOrbital) {
    state.markTimer = 0;
    state.sequenceStep = 2;
    tickHoardBossMechanics(sim.ctx);
  }
  return { sim, inst, boss, state };
}

describe('Hoard Orbital Lightning authoritative choreography', () => {
  it('replays every cue and event identically across same-seed encounters with equal RNG tails', () => {
    const first = encounter();
    const second = encounter();
    const firstDraws: number[] = [];
    const secondDraws: number[] = [];
    first.sim.rng.setObserver((draw) => firstDraws.push(draw));
    second.sim.rng.setObserver((draw) => secondDraws.push(draw));
    expect(first.sim.drainEvents()).toEqual(second.sim.drainEvents());
    let residualEvents = 0;
    for (let tick = 0; tick < 330; tick++) {
      tickHoardBossMechanics(first.sim.ctx);
      tickHoardBossMechanics(second.sim.ctx);
      expect(hoardBossCueViews(first.inst)).toEqual(hoardBossCueViews(second.inst));
      const events = first.sim.drainEvents();
      expect(events).toEqual(second.sim.drainEvents());
      residualEvents += events.filter(
        (event) => event.type === 'hoardBossCue' && event.phase === 'hazard',
      ).length;
    }
    expect(residualEvents).toBe(18);
    expect(hoardBossCueViews(first.inst)).toEqual([]);
    // An unoccupied barrage draws no randomness, including its expiry and residuals.
    expect(firstDraws).toEqual([]);
    expect(secondDraws).toEqual([]);
    const firstTail = Array.from({ length: 16 }, () => first.sim.rng.next());
    const secondTail = Array.from({ length: 16 }, () => second.sim.rng.next());
    expect(firstTail).toEqual(secondTail);
  });

  it('keeps real melee swings deterministic while the orbs are active', () => {
    const first = encounter();
    const second = encounter();
    for (const entry of [first, second]) {
      entry.boss.inCombat = true;
      entry.boss.threat.set(entry.sim.player.id, 1000);
      entry.sim.player.maxHp = 1_000_000;
      entry.sim.player.hp = entry.sim.player.maxHp;
      entry.sim.player.pos = { ...entry.boss.pos, z: entry.boss.pos.z + 1 };
      entry.sim.player.prevPos = { ...entry.sim.player.pos };
      for (const entity of entry.sim.entities.values()) {
        if (entity.kind === 'mob' && entity.id !== entry.boss.id) entity.dead = true;
      }
    }
    const firstDraws: number[] = [];
    const secondDraws: number[] = [];
    first.sim.rng.setObserver((draw) => firstDraws.push(draw));
    second.sim.rng.setObserver((draw) => secondDraws.push(draw));
    const firstSwing = vi.spyOn(first.sim.ctx, 'mobSwing');
    const secondSwing = vi.spyOn(second.sim.ctx, 'mobSwing');
    for (let tick = 0; tick < 100; tick++) {
      expect(first.sim.tick()).toEqual(second.sim.tick());
    }
    expect(firstSwing.mock.calls.length).toBeGreaterThan(1);
    expect(firstSwing.mock.calls.length).toBe(secondSwing.mock.calls.length);
    expect(firstDraws.length).toBeGreaterThan(0);
    expect(firstDraws).toEqual(secondDraws);
    expect(Array.from({ length: 16 }, () => first.sim.rng.next())).toEqual(
      Array.from({ length: 16 }, () => second.sim.rng.next()),
    );
  });

  it('opens with orbital promptly, then rotates charge and static while retaining charged ground', () => {
    const { sim, boss, state } = encounter(false);
    expect(state.sequenceStep).toBe(2);
    // Remain inside the encounter but outside Judgment and the orbital impacts.
    sim.player.pos = { ...boss.pos, z: boss.pos.z + 20 };
    const casts: string[] = [];
    let chargedGroundCount = 0;
    let firstCastTick = -1;
    for (let tick = 0; tick < 1400 && casts.length < 4; tick++) {
      tickHoardBossMechanics(sim.ctx);
      for (const event of sim.drainEvents()) {
        if (event.type !== 'hoardBossCue') continue;
        if (event.variant === 'storm-field') {
          chargedGroundCount++;
          expect(event.phase).toBe('hazard');
          expect(event.durationSecs).toBe(9);
          expect(event.radius).toBe(12);
        }
        if (
          event.variant === 'storm-charge' ||
          event.variant === 'storm-static' ||
          event.variant === 'storm-orbital'
        ) {
          if (firstCastTick < 0) firstCastTick = tick + 1;
          casts.push(event.variant);
        }
      }
    }
    // 39 ticks on the baseline clock; this is a LEGENDARY hoard, whose rarity
    // runs every kit's clocks faster (hoard_scaling.ts cadence).
    expect(firstCastTick).toBe(Math.ceil(39 * HOARD_RARITY_PRESSURE.legendary.cadence));
    expect(casts).toEqual(['storm-orbital', 'storm-charge', 'storm-static', 'storm-orbital']);
    expect(chargedGroundCount).toBe(1);
    expect(state.sequenceStep).toBe(0);
  });

  it('shares three waves of six fixed radial targets with the firing orb positions', () => {
    expect(orbitalShotTime(0)).toBeCloseTo(2.45);
    expect(orbitalShotTime(5)).toBeCloseTo(3.7);
    expect(orbitalShotTime(0, 1)).toBeCloseTo(6.95);
    expect(orbitalShotTime(5, 2)).toBeCloseTo(12.7);
    expect(ORBITAL_LIGHTNING.totalDuration).toBe(15.15);
    for (let wave = 0; wave < 3; wave++) {
      for (let index = 0; index < 6; index++) {
        const target = orbitalTarget(index, 0.7, wave);
        expect(Math.hypot(target.x, target.z)).toBeCloseTo(11);
        const angle = orbitalAngle(orbitalShotTime(index, wave), index, 0.7);
        expect(target.x).toBeCloseTo(Math.sin(angle) * 11);
        expect(target.z).toBeCloseTo(Math.cos(angle) * 11);
      }
    }
  });

  it('fires all eighteen impacts on exact ticks and leaves harmless residuals', () => {
    const { sim, inst, state, boss } = encounter();
    expect(state.cues.filter((cue) => cue.kind === 'mark')).toHaveLength(6);
    const targets = Array.from({ length: 18 }, (_, shot) => {
      const wave = Math.floor(shot / 6);
      const index = shot % 6;
      const offset = orbitalTarget(index, boss.facing, wave);
      return { x: boss.pos.x + offset.x, z: boss.pos.z + offset.z };
    });
    expect(inst.memberIds.has(sim.player.id)).toBe(true);
    const damage = vi.spyOn(sim.ctx, 'dealDamage').mockReturnValue(0);
    const timings: number[] = [];
    const impactTicks = [
      49, 54, 59, 64, 69, 74, 139, 144, 149, 154, 159, 164, 229, 234, 239, 244, 249, 254,
    ];
    let maxWarnings = 0;
    const warningSamples = new Map<number, number>();
    for (let tick = 1; tick <= 330; tick++) {
      const shot = impactTicks.indexOf(tick);
      sim.player.pos = shot >= 0 ? { ...sim.player.pos, ...targets[shot] } : { ...boss.pos };
      const before = damage.mock.calls.length;
      tickHoardBossMechanics(sim.ctx);
      if (damage.mock.calls.length > before) timings.push(tick);
      const warnings = state.cues.filter(
        (cue) => cue.kind === 'mark' && cue.phase === 'warning',
      ).length;
      maxWarnings = Math.max(maxWarnings, warnings);
      // Just after each later wave's warning goes up (its first impact less the lead),
      // and just after each wave's last impact.
      const lead = Math.round(ORBITAL_LIGHTNING.waveWarningLead / DT);
      if ([1, 75, 139 - lead, 165, 229 - lead, 255].includes(tick))
        warningSamples.set(tick, warnings);
    }
    expect(timings).toEqual(impactTicks);
    expect(damage).toHaveBeenCalledTimes(18);
    expect(maxWarnings).toBe(6);
    expect([...warningSamples].map(([, warnings]) => warnings)).toEqual([6, 0, 6, 0, 6, 0]);
    expect(damage.mock.calls.every((call) => call[1].id === sim.player.id)).toBe(true);
    expect(
      damage.mock.calls.every((call) => call[4] === 'nature' && call[5] === 'Orbital Lightning'),
    ).toBe(true);
    expect(state.cues).toHaveLength(0);
  });

  it('allows dodging fixed warnings and never damages the carrier circle', () => {
    const { sim, state, boss } = encounter();
    const target = state.cues.find((cue) => cue.kind === 'mark');
    if (!target) throw new Error('missing mark');
    sim.player.pos.x = target.x;
    sim.player.pos.z = target.z;
    for (let tick = 0; tick < 48; tick++) tickHoardBossMechanics(sim.ctx);
    sim.player.pos = { ...boss.pos };
    const damage = vi.spyOn(sim.ctx, 'dealDamage').mockReturnValue(0);
    for (let tick = 0; tick < 280; tick++) tickHoardBossMechanics(sim.ctx);
    expect(damage).not.toHaveBeenCalled();
  });

  it.each(['death', 'reset'] as const)('cancels all shots and clears mirrors on %s', (reason) => {
    const { sim, inst, boss } = encounter();
    if (reason === 'death') boss.dead = true;
    else boss.aiState = 'evade';
    sim.drainEvents();
    const damage = vi.spyOn(sim.ctx, 'dealDamage').mockReturnValue(0);
    for (let tick = 0; tick < 330; tick++) tickHoardBossMechanics(sim.ctx);
    expect(inst.hoardBoss).toBeUndefined();
    expect(damage).not.toHaveBeenCalled();
    expect(sim.drainEvents().some((event) => event.type === 'hoardBossCueClear')).toBe(true);
    expect(holdHoardOrbitalLightning(sim.ctx, boss)).toBe(false);
  });

  it('holds the actual boss in place while preserving normal melee attacks', () => {
    const { sim, state, boss } = encounter();
    const position = { ...boss.pos };
    sim.player.pos = { ...boss.pos, z: boss.pos.z + 1 };
    boss.swingTimer = 0;
    vi.spyOn(sim.ctx, 'maybeFlee').mockReturnValue(false);
    const move = vi.spyOn(sim.ctx, 'moveToward');
    const swing = vi.spyOn(sim.ctx, 'mobSwing');
    expect(holdHoardOrbitalLightning(sim.ctx, boss)).toBe(true);
    boss.pos.x += 10;
    expect(updateMobCombatProfile(sim.ctx, boss)).toBe('done');
    expect(move).not.toHaveBeenCalled();
    expect(swing).toHaveBeenCalledOnce();
    expect(boss.pos).toEqual(position);
    expect(boss.autoAttack).toBe(true);
    expect(holdHoardOrbitalLightning(sim.ctx, { ...boss, id: -999 })).toBe(false);
    state.cues = [];
    expect(holdHoardOrbitalLightning(sim.ctx, boss)).toBe(false);
  });

  it('finishes an already telegraphed boss mechanic during the stationary barrage', () => {
    const { sim, boss } = encounter();
    const origin = { ...boss.pos };
    boss.inCombat = true;
    boss.threat.set(sim.player.id, 1000);
    boss.stompWindupRemaining = 0.05;
    boss.stompWindupX = origin.x;
    boss.stompWindupZ = origin.z;
    sim.player.pos = { ...origin, z: origin.z + 1 };
    sim.player.prevPos = { ...sim.player.pos };
    vi.spyOn(sim.ctx, 'mobSwing').mockImplementation(() => {});
    sim.drainEvents();
    const events = sim.tick();
    expect(boss.stompWindupRemaining).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'log', text: expect.stringContaining('Galecrash') }),
    );
    expect(boss.pos.x).toBe(origin.x);
    expect(boss.pos.z).toBe(origin.z);
  });

  it('keeps Vharok attacking but stationary through the complete Sim.tick path, then releases him', () => {
    const { sim, boss } = encounter();
    const origin = { ...boss.pos };
    boss.inCombat = true;
    boss.threat.set(sim.player.id, 1000);
    sim.player.pos = { ...origin, z: origin.z + 1 };
    sim.player.prevPos = { ...sim.player.pos };
    const swing = vi.spyOn(sim.ctx, 'mobSwing').mockImplementation(() => {});
    // Isolate this pull from nearby packs without replacing any simulation phases.
    for (const entity of sim.entities.values()) {
      if (entity.kind === 'mob' && entity.id !== boss.id) entity.dead = true;
    }
    for (let tick = 0; tick < 303; tick++) {
      sim.tick();
      expect(boss.pos.x).toBe(origin.x);
      expect(boss.pos.z).toBe(origin.z);
      expect(boss.autoAttack).toBe(true);
    }
    expect(swing.mock.calls.length).toBeGreaterThan(5);
    expect(holdHoardOrbitalLightning(sim.ctx, boss)).toBe(false);
    sim.player.pos = { ...origin, z: origin.z + 15 };
    sim.player.prevPos = { ...sim.player.pos };
    const move = vi.spyOn(sim.ctx, 'moveToward');
    sim.tick();
    expect(move.mock.calls.some((call) => call[0].id === boss.id)).toBe(true);
  });

  it('mirrors all warning timers, residual replacements, late joins and cancellation', () => {
    const { sim, inst } = encounter();
    let now = 0;
    const mirror = new HoardBossCueMirror(() => now);
    for (const event of sim.drainEvents()) mirror.apply(event);
    expect(mirror.views().map((cue) => cue.variant)).toEqual(
      hoardBossCueViews(inst).map((cue) => cue.variant),
    );
    for (let tick = 0; tick < 49; tick++) tickHoardBossMechanics(sim.ctx);
    now = 2450;
    for (const event of sim.drainEvents()) mirror.apply(event);
    expect(mirror.views().filter((cue) => cue.phase === 'hazard')).toHaveLength(1);
    const snapshot = hoardBossCueViews(inst);
    mirror.apply({ type: 'riftState', active: true, hoardCues: snapshot } as Parameters<
      typeof mirror.apply
    >[0]);
    const mirrored = mirror.views();
    expect(mirrored.map((cue) => cue.cueId)).toEqual(snapshot.map((cue) => cue.cueId));
    for (let index = 0; index < snapshot.length; index++) {
      expect(mirrored[index].remaining).toBeCloseTo(snapshot[index].remaining, 10);
    }
    mirror.apply({ type: 'hoardBossCueClear', pid: sim.player.id });
    expect(mirror.views()).toEqual([]);
  });
});

describe('Hoard Orbital Lightning localization', () => {
  it('localizes the mechanic name for Spanish and every required non-Latin locale', () => {
    const expected = {
      es: 'Relámpago orbital',
      es_ES: 'Relámpago orbital',
      zh_CN: '轨道闪电',
      zh_TW: '軌道閃電',
      ja_JP: '軌道雷撃',
      ko_KR: '궤도 번개',
      ru_RU: 'Орбитальная молния',
    } as const;

    try {
      for (const [language, translation] of Object.entries(expected)) {
        setLanguage(language as keyof typeof expected);
        expect(localizeSimAuraName('Orbital Lightning')).toBe(translation);
      }
    } finally {
      setLanguage('en');
    }
  });
});
