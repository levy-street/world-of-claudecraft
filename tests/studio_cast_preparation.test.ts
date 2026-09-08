import { describe, expect, it } from 'vitest';
import { summonUndead } from '../src/sim/combat/necromancy';
import { ABILITIES } from '../src/sim/data';
import type { PlayerClass } from '../src/sim/types';
import { studioAbilityInfo } from '../src/vfx_studio/ability_library';
import { StudioSession } from '../src/vfx_studio/session';

function session(cls: PlayerClass, spec: string | null = null) {
  return new StudioSession({ cls, spec, rows: {}, scene: 'sandbox', seed: 1234 });
}
function cast(s: StudioSession, id: string, seconds = 8) {
  const events = s.dispatch({
    kind: 'cast',
    abilityId: id,
    targetId: s.targetIds[0],
    prepare: true,
  });
  const ticks = (s.sim.player.castTotal + seconds) * 20;
  for (let i = 0; i < ticks; i++) events.push(...s.tick());
  expect(
    events.filter((e) => e.type === 'error'),
    id,
  ).toEqual([]);
  return events;
}
describe('prepared canonical ability reviews', () => {
  it('clears prior defensive locks and restores the group after a resurrection review', () => {
    const mage = session('mage');
    cast(mage, 'ice_block', 0.5);
    expect(cast(mage, 'fireball', 1)).toContainEqual(
      expect.objectContaining({ type: 'damage', ability: ABILITIES.fireball.name }),
    );
    const hunter = session('hunter');
    cast(hunter, 'shellskin', 0.5);
    cast(hunter, 'arcane_shot', 1);
    const shaman = session('shaman', 'restoration');
    cast(shaman, 'ancestor_return', 1);
    const members = shaman.sim.partyOf(shaman.sim.player.id)?.members ?? [];
    expect(members.length).toBeGreaterThan(1);
    expect(members.every((id) => !shaman.sim.entities.get(id)?.dead)).toBe(true);
    cast(shaman, 'healing_wave', 1);
  });
  it('repeats pet commands and summon consumers without stale ownership locks', () => {
    const hunter = session('hunter', 'beast_mastery');
    for (const id of ['unleash_beast', 'pack_command', 'unleash_beast', 'unleash_beast'])
      cast(hunter, id, 0.5);
    const warlock = session('warlock', 'demonology');
    const guard = summonUndead(warlock.sim.ctx, warlock.sim.player, 'graveguard', false);
    expect(guard).not.toBeNull();
    for (const id of [
      'sacrifice_undead',
      'raise_skeletal_warrior',
      'raise_skeletal_warrior',
      'corpse_explosion',
    ])
      cast(warlock, id, 0.5);
    expect(guard?.dead).toBe(false);
  });
  it('emits completion cues for successful utility casts and real resource channel pulses', () => {
    const mage = new StudioSession({
      cls: 'mage',
      spec: null,
      rows: { 20: 'mag_r20_evocation' },
      scene: 'sandbox',
      seed: 1234,
    });
    for (const id of ['conjure_water', 'conjure_food', 'evocation']) {
      const events = cast(mage, id, 1);
      const cues = events.filter(
        (e) => e.type === 'spellfx' && e.ability === id && e.fx === 'selfCast',
      );
      expect(cues, id).toHaveLength(
        id === 'evocation' ? (ABILITIES.evocation.channel?.ticks ?? 0) : 1,
      );
    }
    const hunter = session('hunter');
    const events = cast(hunter, 'revive_pet', 1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'spellfx',
        ability: 'revive_pet',
        targetId: hunter.sim.petOf(hunter.sim.player.id)?.id,
      }),
    );
    const pet = hunter.sim.petOf(hunter.sim.player.id);
    if (!pet) throw new Error('Prepared companion missing');
    pet.dead = true;
    pet.hp = 0;
    cast(hunter, 'revive_pet', 1);
    expect(pet.dead).toBe(false);
  });
  it('casts payoff abilities through the learned base action without adding grants', () => {
    for (const [cls, spec, id, base] of [
      ['rogue', 'combat', 'body_blow', 'sinister_strike'],
      ['rogue', 'assassination', 'venomrend', 'eviscerate'],
      ['druid', 'feral', 'redharvest', 'ferocious_bite'],
      ['druid', 'feral', 'marrowbreak', 'maul'],
      ['druid', 'balance', 'sunlance', 'starfire'],
      ['druid', 'restoration', 'overbloom', 'swiftmend'],
      ['hunter', 'beast_mastery', 'unleash_beast', 'pack_command'],
    ] as const) {
      const s = session(cls, spec),
        known = s.sim.known.map((a) => a.def.id);
      expect(known).not.toContain(id);
      expect(s.abilities).toContain(id);
      const before = s.sim.player.auras.map((aura) => ({ ...aura }));
      expect(studioAbilityInfo(s.sim, id)?.def.id).toBe(id);
      expect(s.sim.player.auras).toEqual(before);
      const events = cast(s, id);
      expect(s.sim.known.map((a) => a.def.id)).toEqual(known);
      expect(
        events.some(
          (e) => 'ability' in e && (e.ability === id || e.ability === ABILITIES[id].name),
        ),
        id,
      ).toBe(true);
      s.sim.player.cooldowns.clear();
      cast(s, base);
      expect(s.sim.resolvedAbility(base)?.def.id).toBe(base);
    }
    expect(session('rogue', 'combat').abilities).not.toContain('venomrend');
  });
  it('keeps self wards in place and gives channel points their actual source', () => {
    const p = session('paladin', 'protection'),
      pos = { ...p.sim.player.pos };
    cast(p, 'bastion_rite');
    expect(p.sim.player.pos).toEqual(pos);
    const w = new StudioSession({
      cls: 'warrior',
      spec: 'fury',
      rows: { 20: 'war_row_bladestorm' },
      scene: 'sandbox',
      seed: 1234,
    });
    const events = cast(w, 'bladestorm', 5);
    const pulses = events.filter((e) => e.type === 'spellfxAt' && e.ability === 'bladestorm');
    expect(pulses).toHaveLength(4);
    for (const pulse of pulses) expect(pulse).toMatchObject({ sourceId: w.sim.player.id });
  });
  it('prepares real full Devotion, companions, weapon enchants and a Dirge target', () => {
    const p = session('paladin', 'holy');
    cast(p, 'divine_ascension', 1);
    expect(p.sim.player.paladinDevotion?.ascensionCharges).toBeGreaterThan(0);
    for (const spec of [null, 'elemental', 'enhancement', 'restoration']) {
      const s = session('shaman', spec);
      const events = cast(s, 'unleash_weapon');
      expect(events.some((e) => e.type === 'damage' || e.type === 'heal')).toBe(true);
    }
    const h = session('hunter', 'beast_mastery');
    cast(h, 'pack_command');
    expect(h.sim.petOf(h.sim.player.id)?.ownerId).toBe(h.sim.player.id);
    const priest = session('priest', 'shadow');
    cast(priest, 'summon_tithefiend');
  });
  it('lets resurrection and travel channels finish out of combat', () => {
    for (const [cls, spec, id] of [
      ['mage', 'arcane', 'collective_reversal'],
      ['shaman', 'restoration', 'ancestor_return'],
      ['warlock', 'affliction', 'soulwell'],
    ] as const) {
      const s = session(cls, spec);
      cast(s, id, 10);
      expect(s.sim.player.castingAbility).toBeNull();
    }
    expect(session('paladin').abilities).toContain('recall_the_fallen');
  });
});
