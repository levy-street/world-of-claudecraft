import { describe, expect, it } from 'vitest';
import { farmBedById } from '../src/sim/content/farm_patches';
import { CRUCIBLE_VENDOR_ENTITY_ID, CRUCIBLE_VENDOR_NPC_ID } from '../src/sim/content/ignivar_loot';
import { plantCrop } from '../src/sim/professions/farming';
import { Sim } from '../src/sim/sim';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('main hotfix integration with release features', () => {
  it('leaves the mouseover queue to the spell path: a release plant lands instantly, no cast', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'priest', autoEquip: false });
    const player = sim.player;
    const meta = sim.players.get(player.id);
    const bed = farmBedById('bed_eastbrook_1');
    if (!meta || !bed) throw new Error('farming fixture is missing');
    player.pos = sim.ctx.groundPos(bed.x, bed.z);
    player.prevPos = { ...player.pos };
    sim.addItem('garden_hoe', 1, player.id);
    sim.addItem('vale_wheat_seed', 1, player.id);
    player.queuedCastAbility = 'lesser_heal';
    player.queuedCastAim = { x: bed.x, z: bed.z };
    player.queuedCastTargetId = player.id;

    plantCrop(sim.ctx, player, meta, bed.id, 'vale_wheat');

    expect(meta.farmPlots.has(bed.id)).toBe(true);
    // Planting starts no cast (the farming-tools report retired the flavor
    // cast), so there is no cast end path for a queued press to leak through
    // and the queue is left exactly as the spell path owns it.
    expect(player.castingAbility).toBeNull();
    expect(player.queuedCastAbility).toBe('lesser_heal');
  });

  it('keeps exactly one quartermaster after the release practice raid is staged', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    sim.chat('/dev ignivarraid');

    const vendors = [...sim.entities.values()].filter(
      (entity) => entity.kind === 'npc' && entity.templateId === CRUCIBLE_VENDOR_NPC_ID,
    );
    expect(vendors.map((vendor) => vendor.id)).toEqual([CRUCIBLE_VENDOR_ENTITY_ID]);
    expect(vendors[0].dungeonId).toBeNull();
    expect(vendors[0].pos.x).toBe(505.5);
    expect(vendors[0].pos.z).toBe(2237.6);
  });
});
