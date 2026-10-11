// Mount-safe forms (combat/forms.ts MOUNT_SAFE_FORM_AURA_KINDS): Moonwing Form
// and Gloamveil only adorn the body they keep, so a rider shifts into and out
// of them in the saddle. Casting any other ability still dismounts, every
// other form still dismounts, and mounting strips every other form while
// leaving these two on. A druid shifting in the saddle gets no Loping Stride:
// the sprint would stack onto the mount's speed on every toggle.
import { describe, expect, it } from 'vitest';
import {
  isMountSafeFormAuraKind,
  isMountSafeFormToggle,
  MOUNT_SAFE_FORM_AURA_KINDS,
} from '../src/sim/combat/forms';
import { MOUNTS } from '../src/sim/content/mounts';
import { ABILITIES } from '../src/sim/data';
import {
  MOUNT_SUMMON_SECONDS,
  summonMountItem,
  toggleMount,
  updateMountTransition,
} from '../src/sim/mounts';
import { moveSpeedMult } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { type AuraKind, DT, type Entity, FORM_AURA_KINDS } from '../src/sim/types';
import { VENDOR_TEST_WORLD } from './sim_shared';

const MOUNT = 'valorsteed';

function rider(cls: 'druid' | 'priest', spec: string): { sim: Sim; pid: number; e: Entity } {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: VENDOR_TEST_WORLD,
  });
  const pid = sim.addPlayer(cls, 'Rider');
  sim.tick();
  sim.setPlayerLevel(20, pid);
  expect(sim.setSpec(spec, pid)).toBe(true);
  const meta = sim.players.get(pid);
  const e = sim.entities.get(pid);
  if (!meta || !e) throw new Error('rider did not join');
  meta.ridingTrained = true;
  sim.addItem('reins_valorsteed', 1, pid);
  return { sim, pid, e };
}

function cast(sim: Sim, e: Entity, abilityId: string): void {
  e.gcdRemaining = 0;
  e.resource = e.maxResource;
  sim.castAbility(abilityId, e.id);
}

function finishSummon(sim: Sim, e: Entity): void {
  const steps = Math.ceil(MOUNT_SUMMON_SECONDS / DT) + 2;
  for (let i = 0; i < steps && (e.mountCastRemaining ?? 0) > 0; i++) {
    updateMountTransition(sim.ctx, e, false);
  }
}

function ride(sim: Sim, pid: number, e: Entity): void {
  expect(summonMountItem(sim.ctx, pid, MOUNT)).toBe(true);
  finishSummon(sim, e);
  expect(e.mountKey).toBe(MOUNT);
}

const inForm = (e: Entity, kind: AuraKind) => e.auras.some((a) => a.kind === kind);
const hasLopingStride = (e: Entity) => e.auras.some((a) => a.id === 'loping_stride');

describe('mount-safe form kinds (combat/forms.ts)', () => {
  it('are exactly the two body-keeping caster forms, a subset of FORM_AURA_KINDS', () => {
    expect([...MOUNT_SAFE_FORM_AURA_KINDS].sort()).toEqual(['form_moonkin', 'form_shadow']);
    for (const kind of MOUNT_SAFE_FORM_AURA_KINDS) expect(FORM_AURA_KINDS.has(kind)).toBe(true);
    for (const kind of ['form_bear', 'form_cat', 'form_travel', 'form_fireball', 'form_lich']) {
      expect(isMountSafeFormAuraKind(kind as AuraKind), kind).toBe(false);
    }
  });

  it('classifies the shipped form buttons by what they resolve to', () => {
    expect(isMountSafeFormToggle(ABILITIES.moonkin_form)).toBe(true);
    expect(isMountSafeFormToggle(ABILITIES.shadowform)).toBe(true);
    for (const id of [
      'bear_form',
      'cat_form',
      'travel_form',
      'fireball_form',
      'metamorphosis',
      'ghost_wolf',
    ]) {
      expect(isMountSafeFormToggle(ABILITIES[id]), id).toBe(false);
    }
  });

  it('treats a press that does more than toggle the form as a real cast', () => {
    const withStrike = {
      effects: [
        ...ABILITIES.moonkin_form.effects,
        { type: 'directDamage' as const, min: 1, max: 2 },
      ],
    };
    expect(isMountSafeFormToggle(withStrike)).toBe(false);
    expect(isMountSafeFormToggle({ effects: [] })).toBe(false);
  });
});

describe('Moonwing Form in the saddle', () => {
  it('shifts in and out while mounted without dismounting', () => {
    const { sim, pid, e } = rider('druid', 'balance');
    ride(sim, pid, e);

    cast(sim, e, 'moonkin_form');
    expect(e.mountKey).toBe(MOUNT);
    expect(inForm(e, 'form_moonkin')).toBe(true);

    cast(sim, e, 'moonkin_form');
    expect(e.mountKey).toBe(MOUNT);
    expect(inForm(e, 'form_moonkin')).toBe(false);
  });

  it('grants no Loping Stride in the saddle, and the next shift on foot still sprints', () => {
    const { sim, pid, e } = rider('druid', 'balance');
    ride(sim, pid, e);

    cast(sim, e, 'moonkin_form');
    expect(inForm(e, 'form_moonkin')).toBe(true);
    expect(hasLopingStride(e)).toBe(false);
    expect(e.procState?.icds.dru_loping_stride).toBeUndefined();
    // Mounted speed is the mount's alone: the shift added nothing on top.
    expect(moveSpeedMult(e)).toBeCloseTo(1 + MOUNTS.valorsteed.moveSpeedPct);

    expect(toggleMount(sim.ctx, pid)).toBe(true);
    expect(e.mountKey).toBe('');
    cast(sim, e, 'moonkin_form'); // out
    cast(sim, e, 'moonkin_form'); // back in, on foot
    expect(hasLopingStride(e)).toBe(true);
  });

  it('stays on through the mount summon, start to completion', () => {
    const { sim, pid, e } = rider('druid', 'balance');
    cast(sim, e, 'moonkin_form');
    expect(inForm(e, 'form_moonkin')).toBe(true);

    sim.drainEvents();
    expect(summonMountItem(sim.ctx, pid, MOUNT)).toBe(true);
    expect(inForm(e, 'form_moonkin')).toBe(true);
    finishSummon(sim, e);
    const events = sim.drainEvents();

    expect(e.mountKey).toBe(MOUNT);
    expect(inForm(e, 'form_moonkin')).toBe(true);
    const removal = events.find(
      (ev) =>
        ev.type === 'aura' && ev.targetId === pid && !ev.gained && ev.name === 'Moonwing Form',
    );
    expect(removal).toBeUndefined();
  });

  it('shifting mid-summon neither cancels the channel nor is stripped at completion', () => {
    const { sim, pid, e } = rider('druid', 'balance');
    expect(summonMountItem(sim.ctx, pid, MOUNT)).toBe(true);
    expect(e.mountCastKey).toBe(MOUNT);

    cast(sim, e, 'moonkin_form');
    expect(e.mountCastKey).toBe(MOUNT);
    expect((e.mountCastRemaining ?? 0) > 0).toBe(true);
    expect(hasLopingStride(e)).toBe(false);
    expect(e.procState?.icds.dru_loping_stride).toBeUndefined();

    finishSummon(sim, e);
    expect(e.mountKey).toBe(MOUNT);
    expect(inForm(e, 'form_moonkin')).toBe(true);
    expect(moveSpeedMult(e)).toBeCloseTo(1 + MOUNTS.valorsteed.moveSpeedPct);
  });

  it('Cat Form still dismounts the rider', () => {
    const { sim, pid, e } = rider('druid', 'balance');
    ride(sim, pid, e);

    cast(sim, e, 'cat_form');
    expect(e.mountKey).toBe('');
    expect(inForm(e, 'form_cat')).toBe(true);
  });
});

describe('Gloamveil in the saddle', () => {
  it('shifts in and out while mounted without dismounting', () => {
    const { sim, pid, e } = rider('priest', 'shadow');
    ride(sim, pid, e);

    cast(sim, e, 'shadowform');
    expect(e.mountKey).toBe(MOUNT);
    expect(inForm(e, 'form_shadow')).toBe(true);

    cast(sim, e, 'shadowform');
    expect(e.mountKey).toBe(MOUNT);
    expect(inForm(e, 'form_shadow')).toBe(false);
  });

  it('stays on when the priest mounts', () => {
    const { sim, pid, e } = rider('priest', 'shadow');
    cast(sim, e, 'shadowform');
    expect(inForm(e, 'form_shadow')).toBe(true);

    ride(sim, pid, e);
    expect(inForm(e, 'form_shadow')).toBe(true);
  });

  it('any other spell still dismounts the rider', () => {
    const { sim, pid, e } = rider('priest', 'shadow');
    ride(sim, pid, e);
    cast(sim, e, 'shadowform');
    expect(e.mountKey).toBe(MOUNT);

    cast(sim, e, 'lesser_heal');
    expect(e.mountKey).toBe('');
  });
});
