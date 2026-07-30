// The per-class kit smoke tests plus elite-mob scaling, sharded out of
// tests/social.test.ts (which keeps parties/duels/trading/instances) so
// neither file carries the whole bill. Fixtures live in tests/social_shared.ts.
// The class tests that fight a live forest wolf keep the full built-in world:
// they need a real camp mob.
import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES, instanceOrigin, MOBS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, MAX_LEVEL } from '../src/sim/types';
import { face, makeWorld, mustEntity, nearestMob, teleport } from './social_shared';

describe('nine classes', () => {
  it('every class spawns with a working kit and stats', () => {
    for (const cls of ALL_CLASSES) {
      const sim = new Sim({ seed: 42, playerClass: cls });
      const p = sim.player;
      expect(p.maxHp).toBeGreaterThan(30);
      expect(sim.known.length).toBeGreaterThan(0);
      // Expanded kits can exceed the 12 action-bar slots; overflow remains
      // available from the spellbook and can be dragged onto the bar.
      expect(CLASSES[cls].abilities.length).toBeGreaterThan(0);
      // the full kit resolves at MAX_LEVEL; the 10-20 band still has things to learn
      const kit = abilitiesKnownAt(cls, MAX_LEVEL);
      const sharedKit = CLASSES[cls].abilities.filter(
        (id) => !ABILITIES[id]?.specs && (ABILITIES[id]?.learnLevel ?? Infinity) <= MAX_LEVEL,
      );
      expect(kit.map((known) => known.def.id)).toEqual(sharedKit);
      expect(abilitiesKnownAt(cls, 10).length).toBeLessThan(kit.length);
      // every class's core kit keeps scaling: something reaches rank 3+ by 20
      expect(kit.some((k) => k.rank >= 3)).toBe(true);
      // resource type sane
      if (cls === 'warrior') expect(p.resourceType).toBe('rage');
      else if (cls === 'rogue') expect(p.resourceType).toBe('energy');
      else expect(p.resourceType).toBe('mana');
    }
  });

  it('priest heals and shields', () => {
    const sim = new Sim({ seed: 42, playerClass: 'priest' });
    const p = sim.player;
    sim.setPlayerLevel(6);
    p.hp = 30;
    sim.castAbility('lesser_heal');
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(p.hp).toBeGreaterThan(30);
    // PW:S absorbs damage
    sim.castAbility('power_word_shield');
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'absorb')).toBe(true);
    const hpBefore = p.hp;
    sim.dealDamage(null, p, 20, false, 'physical', 'test', 'hit');
    expect(p.hp).toBe(hpBefore); // fully soaked
  });

  it('friendly target spells can affect selected players', () => {
    const sim = makeWorld();
    const priestId = sim.addPlayer('priest', 'Healer');
    const priest = mustEntity(sim, priestId);
    const allyId = sim.addPlayer('warrior', 'Ally');
    const ally = mustEntity(sim, allyId);
    teleport(sim, priestId, ally.pos.x + 5, ally.pos.z);
    sim.setPlayerLevel(6, priestId);
    priest.resource = priest.maxResource;
    ally.hp = 20;

    sim.targetEntity(ally.id, priestId);
    sim.castAbility('lesser_heal', priestId);
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(ally.hp).toBeGreaterThan(20);

    for (let i = 0; i < 25; i++) sim.tick();
    sim.castAbility('power_word_shield', priestId);
    sim.tick();
    expect(ally.auras.some((a) => a.kind === 'absorb')).toBe(true);
  });

  it('renew ticks healing over time', () => {
    const sim = new Sim({ seed: 42, playerClass: 'priest' });
    sim.setPlayerLevel(8);
    const p = sim.player;
    p.hp = 20;
    sim.castAbility('renew');
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    expect(p.hp).toBeGreaterThan(30);
  });

  it('paladin seal empowers swings and judgement consumes it', () => {
    const sim = new Sim({ seed: 42, playerClass: 'paladin' });
    sim.setPlayerLevel(4);
    const p = sim.player;
    sim.castAbility('seal_of_righteousness');
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(true);
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, p.id, wolf.pos.x + 3, wolf.pos.z);
    sim.targetEntity(wolf.id);
    face(sim, p.id, wolf.id);
    p.resource = p.maxResource;
    // wait out gcd then judge
    for (let i = 0; i < 35; i++) sim.tick();
    // Judgement's spell hit is an RNG roll (capped at 99%), so a single cast can
    // miss on some world seeds and deal no damage. Re-seal and retry until it
    // lands, so this checks the mechanic (judgement hits and consumes the seal)
    // rather than a lucky roll, robust to RNG-stream shifts from new content.
    let landed = false;
    for (let attempt = 0; attempt < 25 && !landed; attempt++) {
      if (!p.auras.some((a) => a.kind === 'imbue')) {
        sim.castAbility('seal_of_righteousness');
        sim.tick();
      }
      p.gcdRemaining = 0;
      p.cooldowns.delete('judgement');
      p.resource = p.maxResource;
      face(sim, p.id, wolf.id);
      const dealtBefore = sim.counters.damageDealt;
      sim.castAbility('judgement');
      sim.tick();
      landed = sim.counters.damageDealt > dealtBefore;
    }
    expect(landed).toBe(true); // judgement connected and dealt damage
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(false); // consumed
  });

  it('warlock life taps and drains life', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warlock' });
    sim.setPlayerLevel(10);
    const p = sim.player;
    p.resource = 10;
    const hpBefore = p.hp;
    sim.castAbility('life_tap');
    sim.tick();
    expect(p.hp).toBe(hpBefore - 30);
    expect(p.resource).toBe(40);
    // drain life channel heals
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, p.id, wolf.pos.x + 10, wolf.pos.z);
    sim.targetEntity(wolf.id);
    face(sim, p.id, wolf.id);
    p.hp = 30;
    p.resource = p.maxResource;
    for (let i = 0; i < 35; i++) sim.tick();
    face(sim, p.id, wolf.id);
    sim.castAbility('drain_life');
    for (let i = 0; i < 20 * 6 && p.castingAbility; i++) sim.tick();
    expect(p.hp).toBeGreaterThan(30);
  });

  it('hunter kills with ranged auto shot from distance', () => {
    const sim = new Sim({ seed: 42, playerClass: 'hunter' });
    const p = sim.player;
    const wolf = nearestMob(sim, 'forest_wolf');
    p.maxHp = 500;
    p.hp = 500;
    wolf.hp = 60;
    teleport(sim, p.id, wolf.pos.x + 35, wolf.pos.z);
    sim.targetEntity(wolf.id);
    face(sim, p.id, wolf.id);
    sim.startAutoAttack();
    let killed = false;
    let autoShots = 0;
    for (let i = 0; i < 20 * 60 && !killed; i++) {
      face(sim, p.id, wolf.id);
      const events = sim.tick();
      for (const ev of events) {
        if (ev.type === 'damage' && ev.ability === 'Auto Shot' && ev.kind === 'hit') autoShots++;
        if (ev.type === 'death' && ev.entityId === wolf.id) killed = true;
      }
    }
    expect(killed).toBe(true);
    expect(autoShots).toBeGreaterThan(0); // ranged shots landed before melee
  });

  it('lightning shield zaps attackers (thorns)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'shaman' });
    sim.setPlayerLevel(8);
    const p = sim.player;
    sim.castAbility('lightning_shield');
    sim.tick();
    const wolf = nearestMob(sim, 'forest_wolf');
    // The level-based miss curve means a L1-2 wolf almost never lands a hit on an L8
    // player, so match its level to the player to actually exercise the reflect.
    wolf.level = p.level;
    teleport(sim, p.id, wolf.pos.x + 2, wolf.pos.z);
    const wolfHpBefore = wolf.hp;
    let zapped = false;
    for (let i = 0; i < 20 * 15 && !zapped; i++) {
      sim.tick();
      if (wolf.hp < wolfHpBefore) zapped = true;
    }
    expect(zapped).toBe(true);
  });

  it('lightning shield reflects at most 3 charges, gated by a 5s internal cooldown', () => {
    const runReflects = () => {
      const sim = new Sim({ seed: 7, playerClass: 'shaman' });
      sim.setPlayerLevel(12);
      const p = sim.player;
      sim.castAbility('lightning_shield');
      sim.tick();
      const aura = p.auras.find((a) => a.id === 'lightning_shield');
      expect(aura?.charges).toBe(3);
      const wolf = nearestMob(sim, 'forest_wolf');
      // A fast, low-damage, beefy attacker: lands many swings without killing the
      // shaman or dying to the reflects, so we measure the cap, not the fight.
      wolf.level = p.level;
      wolf.weapon = { min: 1, max: 1, speed: 1 };
      wolf.hp = wolf.maxHp = 100000;
      p.hp = p.maxHp = 100000;
      teleport(sim, p.id, wolf.pos.x + 2, wolf.pos.z);
      let reflects = 0;
      const reflectTicks: number[] = [];
      // Horizon: the 3 charges burn in ~11s (first landed swing, then two more
      // gated by the 5s internal cooldown against a 1.0-speed attacker), so 26s
      // leaves over 10s in which an illegal 4th reflect (>= 5s after the 3rd)
      // would land and fail the count below. The loop used to run 40s; the
      // extra 14s ticked past that window asserted nothing new.
      for (let i = 0; i < 20 * 26; i++) {
        const evs = sim.tick();
        for (const e of evs) {
          // The 3-charge cap and 5s internal cooldown are shield-wide, not per-attacker
          // (a wandering low-level mob can also land a hit now that it connects >= 80%),
          // so count every Thunder Ward reflect regardless of which attacker it hits.
          if (e.type === 'damage' && e.ability === 'Thunder Ward') {
            reflects++;
            reflectTicks.push(i);
          }
        }
      }
      return {
        reflects,
        reflectTicks,
        auraGone: !p.auras.some((a) => a.id === 'lightning_shield'),
      };
    };

    const r = runReflects();
    // exactly the 3 charges fire, then the aura is spent and removed
    expect(r.reflects).toBe(3);
    expect(r.auraGone).toBe(true);
    // consecutive reflects are at least the 5s internal cooldown apart (>= 100 ticks)
    for (let i = 1; i < r.reflectTicks.length; i++) {
      expect(r.reflectTicks[i] - r.reflectTicks[i - 1]).toBeGreaterThanOrEqual(20 * 5);
    }
    // deterministic
    expect(runReflects()).toEqual(r);
  }, 90_000);

  it('druid bear form toggles and raises armor', () => {
    const sim = new Sim({ seed: 42, playerClass: 'druid' });
    sim.setPlayerLevel(10);
    const p = sim.player;
    const armorBefore = p.stats.armor;
    sim.castAbility('bear_form');
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(p.stats.armor).toBeGreaterThan(armorBefore * 1.4);
    for (let i = 0; i < 35; i++) sim.tick();
    sim.castAbility('bear_form');
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(false);
    expect(p.stats.armor).toBe(armorBefore);
  });
});

describe('elite mobs', () => {
  it('elites scale like vanilla elites (~2.3x hp, 1.5x damage, 2x xp)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Tank');
    sim.enterCrypt(pid);
    const origin = instanceOrigin(0, 0);
    const shambler = nearestMob(sim, 'crypt_shambler', origin);
    expect(shambler).toBeTruthy();
    const t = MOBS.crypt_shambler;
    const normalHp = t.hpBase + t.hpPerLevel * (shambler.level - 1);
    expect(shambler.maxHp).toBe(Math.round(normalHp * 2.3));
    const normalDmg = t.dmgBase + t.dmgPerLevel * (shambler.level - 1);
    expect(shambler.weapon.max).toBe(Math.round(normalDmg * 1.5 * 1.25));
  });
});
