import { describe, expect, it } from 'vitest';
import { CHERRY_GROVE_COLLIDERS } from '../src/sim/content/cherry_grove';
import { KATANA_EVOLUTIONS, KATANA_TABLE } from '../src/sim/content/katana_forge';
import { sanitizeItemInstancePayloadOnLoad } from '../src/sim/item_instance_load';
import { creditKatanaKill, katanaEvolutionShortfall } from '../src/sim/katana_forge';
import { isValidKatanaLook } from '../src/sim/katana_look';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

const makeSim = () => new Sim({ seed: 11, playerClass: 'rogue', autoEquip: false });

/** Equip a katana and stand at the table (or `away` yards off it). */
function armAtTable(sim: Sim, itemId: string, away = 0) {
  const meta = (sim as any).primary;
  meta.equipment.mainhand = itemId;
  meta.equipmentInstance.mainhand = undefined;
  const p = sim.player;
  p.pos.x = KATANA_TABLE.x + away;
  p.pos.z = KATANA_TABLE.z;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  return meta;
}

describe('Katana Table', () => {
  it('counts kills only while a katana is the main hand', () => {
    const sim = makeSim();
    const meta = armAtTable(sim, 'katana_a');
    creditKatanaKill(meta);
    creditKatanaKill(meta);
    expect(meta.equipmentInstance.mainhand.katana.kills).toBe(2);
    meta.equipment.mainhand = 'rusty_dagger';
    meta.equipmentInstance.mainhand = undefined;
    creditKatanaKill(meta);
    expect(meta.equipmentInstance.mainhand).toBeUndefined();
  });

  it('reports what an evolution still needs, and nothing past the final tier', () => {
    const short = katanaEvolutionShortfall('katana_a', 40, () => 2, 0);
    expect(short).toEqual({
      next: 'katana_b',
      kills: KATANA_EVOLUTIONS.katana_a.kills - 40,
      materials: [{ itemId: 'sunpetal_herb', missing: 3 }],
      copper: KATANA_EVOLUTIONS.katana_a.copper,
    });
    expect(katanaEvolutionShortfall('katana_c', 9999, () => 99, 1e9)).toBeNull();
  });

  it('customizes and evolves at the table, keeping the look and name', () => {
    const sim = makeSim();
    const meta = armAtTable(sim, 'katana_a');
    sim.chat('/katana color blade crimson');
    sim.chat('/katana kanji sakura');
    sim.chat('/katana name Petal Storm');
    const payload = meta.equipmentInstance.mainhand;
    expect(payload.katana).toMatchObject({ blade: 'crimson', kanji: 'sakura' });
    expect(payload.name).toBe('Petal Storm');

    // not enough kills yet
    sim.chat('/katana evolve');
    expect(meta.equipment.mainhand).toBe('katana_a');

    payload.katana.kills = KATANA_EVOLUTIONS.katana_a.kills;
    sim.addItem('sunpetal_herb', 5);
    meta.copper = KATANA_EVOLUTIONS.katana_a.copper;
    sim.chat('/katana evolve');
    expect(meta.equipment.mainhand).toBe('katana_b');
    expect(sim.countItem('sunpetal_herb')).toBe(0);
    expect(meta.copper).toBe(0);
    expect(meta.equipmentInstance.mainhand.katana.blade).toBe('crimson');
    expect(meta.equipmentInstance.mainhand.name).toBe('Petal Storm');
  });

  it('refuses changes away from the table', () => {
    const sim = makeSim();
    const meta = armAtTable(sim, 'katana_a', 40);
    sim.chat('/katana color blade crimson');
    sim.tick();
    expect(meta.equipmentInstance.mainhand?.katana?.blade).toBeUndefined();
  });

  it('the table collider sits on the drawn table', () => {
    const c = CHERRY_GROVE_COLLIDERS.find((d) => d.key === 'collider:katanaTable');
    expect(c).toMatchObject({ x: KATANA_TABLE.x, z: KATANA_TABLE.z });
  });

  it('the load bound keeps a legal record and drops a corrupt one whole', () => {
    expect(isValidKatanaLook({ kills: 3, blade: 'azure', kanji: 'ryu' })).toBe(true);
    const ok = sanitizeItemInstancePayloadOnLoad({ katana: { kills: 3, wrap: 'ivory' } });
    expect(ok.payload?.katana).toEqual({ kills: 3, wrap: 'ivory' });
    const bad = sanitizeItemInstancePayloadOnLoad({ katana: { blade: 'neon' }, name: 'Ok Name' });
    expect(bad.payload?.katana).toBeUndefined();
    expect(bad.dropped).toContain('katana');
  });
});
