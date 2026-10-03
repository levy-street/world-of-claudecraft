import { describe, expect, it } from 'vitest';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import { hasMorthenIdentity } from '../src/sim/graveyard_shift/morthen_identity';
import { summonMountItem } from '../src/sim/mounts';
import { restorePetFromDelveStash } from '../src/sim/pet/pet_commands';
import { refreshModsForEquipmentChange } from '../src/sim/progression/talents';
import { Sim } from '../src/sim/sim';
import type { Aura, PlayerClass } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function shiftSim(cls: PlayerClass = 'warrior', level = 10) {
  const sim = new Sim({
    seed: 42,
    playerClass: cls,
    autoEquip: true,
    devCommands: true,
    offlineHost: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(level);
  return sim;
}

const meta = (sim: Sim) => (sim as any).players.get(sim.playerId);

function start(sim: Sim) {
  sim.chat('/dev graveyardshift start');
  const run = graveyardShiftRunFor(sim.ctx, sim.playerId);
  expect(run).not.toBeNull();
  return run!;
}

function end(sim: Sim) {
  sim.chat('/dev graveyardshift end');
  sim.tick();
}

function foreignAura(kind: Aura['kind'], sourceId: number): Aura {
  return {
    id: `test_${kind}`,
    name: kind,
    kind,
    remaining: 5,
    duration: 5,
    value: 0.5,
    sourceId,
    school: 'physical',
  };
}

function statLine(sim: Sim) {
  const p = sim.player;
  return {
    level: p.level,
    maxHp: p.maxHp,
    armor: p.stats.armor,
    weapon: { ...p.weapon },
    attackPower: p.attackPower,
    spellPower: p.spellPower,
    critChance: p.critChance,
    dodgeChance: p.dodgeChance,
    stats: { ...p.stats },
    hp: p.hp,
    resourceType: p.resourceType,
    resource: p.resource,
    known: meta(sim).known.map((k: any) => [k.def.id, k.rank]),
  };
}

const KIT_IDS = [
  'gshift_gravecall',
  'gshift_shadow_pulse',
  'gshift_sextons_chain',
  'gshift_barrow_shroud',
];

// A frozen level-10 wolf `dz` yards down the nave in front of Morthen, targeted.
function frozenWolfAhead(sim: Sim, dz: number) {
  sim.chat('/dev spawn forest_wolf 1 10');
  sim.chat('/dev freezemobs on');
  const wolf = [...sim.entities.values()].find((e) => e.devSpawnOwnerId === sim.playerId)!;
  expect(wolf).toBeDefined();
  const p = sim.player;
  wolf.pos = sim.ctx.groundPos(p.pos.x, p.pos.z - dz);
  wolf.prevPos = { ...wolf.pos };
  (sim as any).rebucket(wolf);
  p.facing = Math.PI;
  p.targetId = wolf.id;
  return wolf;
}

function castAndFinish(sim: Sim, id: string) {
  sim.castAbility(id);
  for (let i = 0; i < 20 * 12 && sim.player.castingAbility; i++) sim.tick();
}

function refreshModsUnchanged(sim: Sim): boolean {
  const mods = meta(sim).talentMods;
  refreshModsForEquipmentChange(sim.ctx, meta(sim));
  return meta(sim).talentMods === mods;
}

function hitPlayer(sim: Sim, amount: number) {
  (sim as any).dealDamage(null, sim.player, amount, false, 'physical', null, 'hit', true);
}

describe('Graveyard Shift Morthen identity', () => {
  it.each([
    ['warrior', 10],
    ['mage', 20],
    ['rogue', 15],
    ['hunter', 20],
    ['druid', 14],
    ['paladin', 12],
    ['priest', 18],
    ['shaman', 16],
    ['warlock', 11],
  ] as const)('a level %s %i owner fights with the morthen template numbers', (cls, level) => {
    const sim = shiftSim(cls, level);
    start(sim);
    const p = sim.player;
    expect(hasMorthenIdentity(p)).toBe(true);
    expect(p.level).toBe(10);
    expect(p.maxHp).toBe(3573);
    expect(p.hp).toBe(3573);
    expect(p.stats.armor).toBe(234);
    expect(p.weapon).toEqual({ min: 82, max: 130, speed: 2.6 });
    expect(p.attackPower).toBe(0);
    expect(p.offhandWeapon).toBeNull();
    expect(p.stats.pvpOffense).toBe(0);
    expect(p.stats.pvpDefense).toBe(0);
    expect(p.spellPower).toBe(0);
    expect(p.rangedPower).toBe(0);
    expect(p.critChance).toBe(0.05);
    expect(p.dodgeChance).toBe(0.05);
    expect(meta(sim).talents).toEqual({ spec: null, rows: {} });
    expect(meta(sim).known.map((k: any) => k.def.id)).toEqual(KIT_IDS);
  });

  it('the kit lands at the solo damage multiplier over the template numbers', () => {
    const sim = shiftSim('warrior');
    start(sim);
    const effects = (id: string) => meta(sim).known.find((k: any) => k.def.id === id).effects;
    expect(effects('gshift_gravecall')[0]).toMatchObject({
      type: 'directDamage',
      min: 40,
      max: 64,
    });
    expect(effects('gshift_shadow_pulse')[0]).toMatchObject({
      type: 'aoeDamage',
      min: 24,
      max: 36,
    });
  });

  it('the profile survives a stat recalc from a buff landing and expiring', () => {
    const sim = shiftSim('warrior');
    start(sim);
    const p = sim.player;
    (sim as any).applyAura(p, { ...foreignAura('buff_str', p.id), value: 50, remaining: 0.2 });
    expect(p.maxHp).toBe(3573);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(p.auras.some((a) => a.id === 'test_buff_str')).toBe(false);
    expect(p.maxHp).toBe(3573);
    expect(p.weapon).toEqual({ min: 82, max: 130, speed: 2.6 });
  });

  it('the real class kit is uncastable and the morthen kit casts', () => {
    const sim = shiftSim('warrior');
    start(sim);
    sim.castAbility('heroic_strike');
    expect(
      sim.events.some((e) => e.type === 'error' && e.text === 'You do not know that ability.'),
    ).toBe(true);
    sim.castAbility('gshift_barrow_shroud');
    expect(sim.player.auras.some((a) => a.kind === 'shield_wall' && a.value === 0.6)).toBe(true);
    sim.castAbility('gshift_shadow_pulse');
    expect(sim.player.castingAbility).toBe('gshift_shadow_pulse');
  });

  it('runs the kit on the standard global cooldown whatever the real class', () => {
    const sim = shiftSim('rogue');
    start(sim);
    sim.castAbility('gshift_shadow_pulse');
    expect(sim.player.gcdRemaining).toBeCloseTo(1.5, 5);
  });

  it('locks items, gear, mounts and talent changes for the run', () => {
    const sim = shiftSim('warrior');
    sim.addItem('minor_healing_potion', 2);
    start(sim);
    const m = meta(sim);
    const equipment = { ...m.equipment };
    const slot = Object.keys(equipment)[0] as any;
    expect(slot).toBeDefined();
    expect(sim.unequipItem(slot)).toBe(false);
    expect(m.equipment).toEqual(equipment);
    sim.player.hp = 100;
    sim.useItem('minor_healing_potion');
    expect(sim.countItem('minor_healing_potion')).toBe(2);
    expect(sim.events.some((e) => e.type === 'error' && /full health/.test(e.text))).toBe(false);
    expect(refreshModsUnchanged(sim)).toBe(true);
    sim.chat('/dev bis');
    expect(m.equipment).toEqual(equipment);
    expect(
      sim.events.some(
        (e) => e.type === 'log' && e.text === '[dev] Not while on a Graveyard Shift.',
      ),
    ).toBe(true);
    expect(sim.setSpec('arms')).toBe(false);
    expect(sim.ctx.playerMods(m).spec).toBeNull();
    const loadouts = JSON.stringify(m.loadouts);
    expect(sim.saveLoadout('real build', [])).toBe(-1);
    expect(JSON.stringify(m.loadouts)).toBe(loadouts);
  });

  it('the item lock is what keeps the potion: without a run it is drunk', () => {
    const sim = shiftSim('warrior');
    sim.addItem('minor_healing_potion', 2);
    sim.player.hp = 100;
    sim.useItem('minor_healing_potion');
    expect(sim.countItem('minor_healing_potion')).toBe(1);
  });

  it('refuses to equip gear on shift', () => {
    const sim = shiftSim('warrior');
    const m = meta(sim);
    const weapon = m.equipment.mainhand as string;
    expect(weapon).toBeDefined();
    expect(sim.unequipItem('mainhand')).toBe(true);
    start(sim);
    sim.equipItem(weapon);
    expect(m.equipment.mainhand).toBeUndefined();
  });

  it('refuses to summon a mount on shift', () => {
    const sim = shiftSim('warrior', 20);
    sim.chat('/dev mounts');
    start(sim);
    expect(summonMountItem(sim.ctx, sim.playerId, 'valorsteed')).toBe(false);
    expect(sim.player.mountCastKey).toBe('');
  });

  it('refuses pet commands on shift', () => {
    const sim = shiftSim('warlock');
    castAndFinish(sim, 'summon_imp');
    start(sim);
    restorePetFromDelveStash(sim.ctx, sim.playerId);
    const pet = sim.petOf(sim.playerId)!;
    expect(pet).not.toBeNull();
    const mode = pet.petMode;
    sim.setPetMode(mode === 'passive' ? 'aggressive' : 'passive');
    expect(sim.petOf(sim.playerId)!.petMode).toBe(mode);
  });

  it('no dev path changes the level on shift (/dev mounts levels to 20 off shift)', () => {
    const sim = shiftSim('warrior', 12);
    const lifetimeXp = meta(sim).lifetimeXp;
    start(sim);
    sim.chat('/dev mounts');
    expect(sim.player.level).toBe(10);
    expect(sim.player.maxHp).toBe(3573);
    end(sim);
    expect(sim.player.level).toBe(12);
    expect(meta(sim).lifetimeXp).toBe(lifetimeXp);
  });

  it('earns the real character no XP and never wears a warrior stance', () => {
    const sim = shiftSim('warrior');
    start(sim);
    const xp = meta(sim).xp;
    sim.grantXp(500);
    expect(meta(sim).xp).toBe(xp);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.kind.endsWith('stance'))).toBe(false);
  });

  it('keeps the template immunities: no foreign control or snare, still kickable', () => {
    const sim = shiftSim('warrior');
    const other = sim.addPlayer('mage', 'Kicker');
    start(sim);
    const p = sim.player;
    (sim as any).applyAura(p, foreignAura('stun', other));
    (sim as any).applyAura(p, foreignAura('slow', other));
    (sim as any).applyAura(p, foreignAura('polymorph', other));
    expect(p.auras.some((a) => ['stun', 'slow', 'polymorph'].includes(a.kind))).toBe(false);
    (sim as any).applyAura(p, foreignAura('root', other));
    expect(p.auras.some((a) => a.kind === 'root')).toBe(false);
    (sim as any).applyAura(p, foreignAura('lockout', other));
    expect(p.auras.some((a) => a.kind === 'lockout')).toBe(true);
  });

  it('lets a self-applied or unbreakable control through, like the boss template', () => {
    const sim = shiftSim('warrior');
    const other = sim.addPlayer('mage', 'Scripter');
    start(sim);
    const p = sim.player;
    (sim as any).applyAura(p, { ...foreignAura('stun', p.id), id: 'self_stun' });
    expect(p.auras.some((a) => a.id === 'self_stun')).toBe(true);
    (sim as any).applyAura(p, {
      ...foreignAura('root', other),
      id: 'scripted',
      unbreakableControl: true,
    });
    expect(p.auras.some((a) => a.id === 'scripted')).toBe(true);
  });

  it('ignores health and strength auras: the template numbers stand', () => {
    const sim = shiftSim('warrior');
    start(sim);
    const p = sim.player;
    (sim as any).applyAura(p, {
      ...foreignAura('buff_maxhp_pct', p.id),
      value: 0.2,
      remaining: 30,
    });
    (sim as any).applyAura(p, { ...foreignAura('buff_sta', p.id), value: 50, remaining: 30 });
    (sim as any).applyAura(p, { ...foreignAura('buff_str', p.id), value: 50, remaining: 30 });
    expect(p.maxHp).toBe(3573);
    expect(p.hp).toBe(3573);
    expect(p.attackPower).toBe(0);
    expect(p.stats.str).toBe(0);
  });

  it('keeps the identity for a long shift', () => {
    const sim = shiftSim('warrior');
    start(sim);
    for (let i = 0; i < 20 * 60; i++) sim.tick();
    expect(hasMorthenIdentity(sim.player)).toBe(true);
    expect(sim.player.maxHp).toBe(3573);
  });

  it.each([false, true])(
    'a warrior swinging never rolls Battle Trance on shift (on shift: %s)',
    (onShift) => {
      const sim = shiftSim('warrior');
      if (onShift) start(sim);
      const wolf = frozenWolfAhead(sim, 2);
      wolf.maxHp = 1e7;
      wolf.hp = 1e7;
      sim.player.autoAttack = true;
      let trance = false;
      for (let i = 0; i < 20 * 60; i++) {
        sim.tick();
        if (sim.player.auras.some((a) => a.id === 'battle_trance')) trance = true;
      }
      expect(wolf.hp).toBeLessThan(1e7);
      expect(trance).toBe(!onShift);
    },
  );

  it.each([false, true])('a kill on shift feeds no deed counter (on shift: %s)', (onShift) => {
    const sim = shiftSim('warrior');
    if (onShift) start(sim);
    const wolf = frozenWolfAhead(sim, 2);
    const before = { ...meta(sim).deedStats.counters };
    wolf.hp = 1;
    (sim as any).dealDamage(sim.player, wolf, 5, false, 'shadow', null, 'hit', true);
    sim.tick();
    expect(wolf.dead).toBe(true);
    if (onShift) expect(meta(sim).deedStats.counters).toEqual(before);
    else expect(meta(sim).deedStats.counters).not.toEqual(before);
  });

  it('freezes the real action bar while Morthen and releases it after', () => {
    const sim = shiftSim('warrior');
    expect(sim.actionBarReadOnly).toBe(false);
    start(sim);
    expect(sim.actionBarReadOnly).toBe(true);
    end(sim);
    expect(sim.actionBarReadOnly).toBe(false);
  });

  it.each([
    ['warrior', 10, null],
    ['mage', 20, null],
    ['warrior', 20, 'arms'],
  ] as const)('exit hands back the real %s %i (spec %s) exactly', (cls, level, spec) => {
    const sim = shiftSim(cls, level);
    if (spec) expect(sim.setSpec(spec)).toBe(true);
    for (let i = 0; i < 5; i++) sim.tick();
    const before = statLine(sim);
    const mods = meta(sim).talentMods;
    const talents = meta(sim).talents;
    start(sim);
    end(sim);
    expect(hasMorthenIdentity(sim.player)).toBe(false);
    expect(statLine(sim)).toEqual(before);
    expect(meta(sim).talentMods).toBe(mods);
    expect(meta(sim).talents).toBe(talents);
  });

  it('a death on shift still restores the real character', () => {
    const sim = shiftSim('mage', 20);
    const before = statLine(sim);
    start(sim);
    sim.chat('/dev kill');
    sim.tick();
    expect(hasMorthenIdentity(sim.player)).toBe(false);
    expect(statLine(sim)).toEqual(before);
  });

  it("a stat recalc never drifts Morthen's health", () => {
    const sim = shiftSim('mage', 20);
    start(sim);
    const p = sim.player;
    p.hp = 700;
    for (let i = 0; i < 10; i++) {
      (sim as any).applyAura(p, { ...foreignAura('buff_str', p.id), id: `b${i}`, remaining: 0.05 });
      sim.tick();
    }
    expect(p.hp).toBe(700);
  });

  it('wears none of the real trinket passives', () => {
    const sim = shiftSim('warrior', 20);
    meta(sim).equipment.trinket = 'bastion_sigil';
    start(sim);
    hitPlayer(sim, Math.floor(sim.player.maxHp * 0.7));
    expect(sim.player.auras.some((a) => a.id.startsWith('trinket_'))).toBe(false);
  });

  it.each(['hunter', 'mage'] as const)(
    'a %s owner never auto-fires the class ranged attack',
    (cls) => {
      const sim = shiftSim(cls, 20);
      start(sim);
      const wolf = frozenWolfAhead(sim, 12);
      sim.player.autoAttack = true;
      for (let i = 0; i < 200; i++) sim.tick();
      expect(wolf.hp).toBe(wolf.maxHp);
    },
  );

  it("Morthen's hits feed none of the real character's deed stats", () => {
    const sim = shiftSim('warrior');
    start(sim);
    const wolf = frozenWolfAhead(sim, 3);
    const counters = { ...meta(sim).deedStats.counters };
    (sim as any).dealDamage(sim.player, wolf, 20, false, 'shadow', null, 'hit', true);
    expect(wolf.hp).toBeLessThan(wolf.maxHp);
    expect(meta(sim).deedStats.counters).toEqual(counters);
  });

  it('refuses /dev level on shift so the exit restores the true level', () => {
    const sim = shiftSim('warrior', 12);
    start(sim);
    sim.chat('/dev level 18');
    expect(sim.player.level).toBe(10);
    end(sim);
    expect(sim.player.level).toBe(12);
  });

  it('a kit bolt still in flight at the exit never lands', () => {
    const sim = shiftSim('warrior');
    start(sim);
    const wolf = frozenWolfAhead(sim, 15);
    sim.castAbility('gshift_gravecall');
    expect(sim.ctx.pendingProjectiles.length).toBeGreaterThan(0);
    end(sim);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(wolf.hp).toBe(wolf.maxHp);
  });
});
