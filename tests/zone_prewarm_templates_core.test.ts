import { describe, expect, it } from 'vitest';
import { zonePrewarmTemplateIds } from '../src/render/zone_prewarm_templates_core';
import { CAMPS, DUNGEON_X_THRESHOLD, NPCS, zoneAt } from '../src/sim/data';

const EASTBROOK = 'eastbrook_vale';

function firstCampIn(zoneId: string): { mobId: string; x: number; z: number } {
  const camp = CAMPS.find((entry) => zoneAt(entry.center.x, entry.center.z).id === zoneId);
  if (!camp) throw new Error(`no camp in ${zoneId}`);
  return { mobId: camp.mobId, x: camp.center.x, z: camp.center.z };
}

describe('zonePrewarmTemplateIds', () => {
  it('takes the static camps of the zone, and only that zone', () => {
    const here = firstCampIn(EASTBROOK);
    const ids = zonePrewarmTemplateIds(EASTBROOK, 'mob', []);
    expect(ids).toContain(here.mobId);
    expect(ids.length).toBeGreaterThan(1);
    // A camp of another zone must not leak in.
    const elsewhere = CAMPS.filter((camp) => zoneAt(camp.center.x, camp.center.z).id !== EASTBROOK)
      .map((camp) => camp.mobId)
      .filter((mobId) => !ids.includes(mobId));
    expect(elsewhere.length).toBeGreaterThan(0);
  });

  it('takes the static NPCs of the zone and never a dynamic one', () => {
    const ids = zonePrewarmTemplateIds(EASTBROOK, 'npc', []);
    expect(ids).toContain('brother_aldric');
    const dynamicHere = Object.values(NPCS).filter(
      (npc) => npc.dynamic && zoneAt(npc.pos.x, npc.pos.z).id === EASTBROOK,
    );
    expect(dynamicHere.length).toBeGreaterThan(0);
    for (const npc of dynamicHere) expect(ids).not.toContain(npc.id);
  });

  it('unions the live entities the sim already knows, of the asked kind only', () => {
    const here = firstCampIn(EASTBROOK);
    const live = [
      { kind: 'mob', templateId: 'live_mob_here', pos: { x: here.x, z: here.z } },
      { kind: 'npc', templateId: 'live_npc_here', pos: { x: here.x, z: here.z } },
      { kind: 'mob', templateId: 'no_template_id', pos: { x: here.x, z: here.z } },
    ];
    live[2].templateId = '';
    const mobs = zonePrewarmTemplateIds(EASTBROOK, 'mob', live);
    expect(mobs).toContain('live_mob_here');
    expect(mobs).not.toContain('live_npc_here');
    expect(mobs).not.toContain('no_template_id');
    expect(zonePrewarmTemplateIds(EASTBROOK, 'npc', live)).toContain('live_npc_here');
  });

  it('never takes a body standing inside a dungeon instance', () => {
    // Interiors sit past the instance threshold and belong to no zone: warming
    // their templates against the outdoor zone is what this guard prevents.
    const inside = [
      {
        kind: 'mob',
        templateId: 'nythraxis_scourge_of_thornpeak',
        pos: { x: DUNGEON_X_THRESHOLD + 1, z: 0 },
      },
    ];
    expect(zonePrewarmTemplateIds(EASTBROOK, 'mob', inside)).not.toContain(
      'nythraxis_scourge_of_thornpeak',
    );
  });

  it('dedupes and sorts, so two callers get the same list', () => {
    const here = firstCampIn(EASTBROOK);
    const live = [
      { kind: 'mob', templateId: here.mobId, pos: { x: here.x, z: here.z } },
      { kind: 'mob', templateId: 'aaa_first', pos: { x: here.x, z: here.z } },
    ];
    const ids = zonePrewarmTemplateIds(EASTBROOK, 'mob', live);
    expect(ids.filter((id) => id === here.mobId)).toHaveLength(1);
    expect(ids[0]).toBe('aaa_first');
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('summon-only quest mobs', () => {
  it('takes the kill targets of the zone quests, so a summoned mob without a camp is prewarmed', () => {
    const ids = zonePrewarmTemplateIds('proving_shore', 'mob', []);
    // Mister Crabs is called by a quest item and has no camp.
    expect(CAMPS.some((camp) => camp.mobId === 'mister_crabs')).toBe(false);
    expect(ids).toContain('mister_crabs');
    // ... and only in the zone whose NPC gives that quest.
    expect(zonePrewarmTemplateIds(EASTBROOK, 'mob', [])).not.toContain('mister_crabs');
  });
});
