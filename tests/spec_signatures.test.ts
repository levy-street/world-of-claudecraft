// Phase 1: every spec grants a REAL signature ability on selection. Ports the 22 built
// signature spells from the flip branch onto the current spec defs, plus Chain Heal (new,
// resto-exclusive) and the Stormstrike exclusivity fix. Proves each of the 27 signatures
// resolves and, when cast, produces an observable effect.
import { describe, expect, it } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

function producesEffect(cls: PlayerClass, specId: string, sig: string): string {
  const sim = new Sim({ seed: 3, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  const ok = sim.setSpec(specId);
  if (!ok) return 'setSpec failed';
  const pid = sim.playerId;
  const p = sim.entities.get(pid) as any;
  if (!sim.resolvedAbility(sig)) return `signature ${sig} not granted by spec`;
  p.maxHp = p.hp = 1_000_000;
  p.resource = p.maxResource;
  p.comboPoints = 5;
  // a friendly ally (for heals/buffs) and a hostile dummy (for damage/CC), both pinned
  const ally = createMob((sim as any).nextId++, MOBS.ridge_stalker, 20, {
    x: p.pos.x + 3,
    y: p.pos.y,
    z: p.pos.z,
  });
  (ally as any).hostile = false;
  (ally as any).kind = 'player';
  ally.maxHp = 1_000_000;
  ally.hp = 100; // injured, so a heal has something to do
  // Melee signatures (weaponStrike) need the target in melee reach; ranged/CC need distance.
  const isMelee = (ABILITIES[sig]?.effects ?? []).some((e: any) => e.type === 'weaponStrike');
  const mob = createMob((sim as any).nextId++, MOBS.ridge_stalker, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + (isMelee ? 4 : 14),
  });
  mob.maxHp = mob.hp = 1_000_000;
  mob.hostile = true;
  for (const e of [ally, mob]) {
    sim.entities.set(e.id, e);
    (sim as any).rebucket(e);
  }
  p.facing = 0;
  sim.targetEntity(mob.id, pid);
  const before = {
    pA: p.auras.length,
    mA: mob.auras.length,
    cd: p.cooldowns.size,
    res: p.resource,
    allyHp: ally.hp,
  };
  let ev = false;
  for (let i = 0; i < 20 * 3; i++) {
    mob.hp = 1_000_000;
    if (i === 0) sim.castAbility(sig, pid, { x: mob.pos.x, z: mob.pos.z });
    for (const e of sim.tick())
      if ((e.type === 'damage' || e.type === 'heal') && (e as any).sourceId === pid) ev = true;
  }
  const fired =
    ev ||
    p.auras.length > before.pA ||
    mob.auras.length > before.mA ||
    p.cooldowns.size > before.cd ||
    p.resource < before.res ||
    ally.hp > before.allyHp;
  return fired ? '' : 'cast produced no observable effect';
}

describe('Phase 1: spec signatures', () => {
  it('all 27 signatures resolve and produce an effect when cast', () => {
    const duds: string[] = [];
    for (const [cls, ct] of Object.entries(TALENTS) as [PlayerClass, any][]) {
      for (const s of ct.specs) {
        const why = producesEffect(cls, s.id, s.signature);
        if (why) duds.push(`${cls}/${s.name} (${s.signature}): ${why}`);
      }
    }
    expect(duds, `signatures that failed:\n${duds.join('\n')}`).toEqual([]);
  });

  it('Stormstrike is Enhancement-only and Chain Heal is Restoration-only', () => {
    const shaman = TALENTS.shaman!;
    for (const s of shaman.specs) {
      const sim = new Sim({ seed: 1, playerClass: 'shaman', autoEquip: true });
      sim.setPlayerLevel(20);
      sim.setSpec(s.id);
      const isEnh = s.signature === 'stormstrike';
      const isResto = s.signature === 'chain_heal';
      expect(!!sim.resolvedAbility('stormstrike'), `${s.name} stormstrike`).toBe(isEnh);
      expect(!!sim.resolvedAbility('chain_heal'), `${s.name} chain_heal`).toBe(isResto);
    }
  });

  it('picking a spec announces the signature (learnAbility event + log) so it lands on the bar', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.setSpec('fury'); // grants bloodthirst
    const evs = sim.tick();
    const learned = evs.filter((e) => e.type === 'learnAbility').map((e) => (e as any).abilityId);
    const said = evs.some(
      (e) => e.type === 'log' && /have learned/i.test((e as { text: string }).text),
    );
    expect(learned, 'a learnAbility event for the signature').toContain('bloodthirst');
    expect(said, 'a "You have learned" log').toBe(true);
  });
});
