import { afterEach, describe, expect, it } from 'vitest';
import { PROFESSION_TRAINERS } from '../src/sim/content/profession_trainers';
import { NPCS, QUESTS, STATIONS } from '../src/sim/data';
import { isProfessionQuest } from '../src/sim/quests/ambient_quest_marker';
import { npcDisplayTitle } from '../src/ui/entity_display_core';
import { getLanguage, setLanguage } from '../src/ui/i18n';
import {
  professionTrainerLabel,
  professionTrainerNameplateLabel,
} from '../src/ui/profession_trainer_label_core';

const originalLanguage = getLanguage();
afterEach(() => setLanguage(originalLanguage));

describe('profession trainer service labels', () => {
  it('covers every station master, farmer and profession quest giver with real NPCs', () => {
    const required = new Set([
      ...STATIONS.map((station) => station.masterNpcId),
      ...Object.values(NPCS)
        .filter((npc) => npc.farmer)
        .map((npc) => npc.id),
      ...Object.values(QUESTS)
        .filter(isProfessionQuest)
        .map((quest) => quest.giverNpcId),
    ]);
    expect(Object.keys(PROFESSION_TRAINERS).sort()).toEqual([...required].sort());
    for (const id of required) {
      expect(NPCS[id], id).toBeDefined();
      expect(professionTrainerLabel(id), id).toMatch(/Trainer$/);
    }
  });

  it.each([
    ['forgemistress_darva', 'Blacksmithing Trainer'],
    ['cook_marlow', 'Cooking Trainer'],
    ['weaver_ottilie', 'Tailoring Trainer'],
    ['tinker_gizzel', 'Engineering Trainer'],
    ['tanner_hesk', 'Leatherworking Trainer'],
    ['alchemist_verane', 'Alchemy Trainer'],
    ['farmer_jessica', 'Farming Trainer'],
    ['foreman_odell', 'Mining Trainer'],
    ['smith_haldren', 'Hobby Trainer'],
  ])('uses the same %s service title in dialogue and beneath the name', (id, title) => {
    setLanguage('en');
    expect(npcDisplayTitle(id)).toBe(title);
    expect(professionTrainerNameplateLabel(id)).toBe(`<${title}>`);
  });

  it('does not turn combat/story vendors or unknown IDs into profession trainers', () => {
    for (const id of [
      'marshal_redbrook',
      'apothecary_lin',
      'fisherman_brandt',
      'constructor',
      'missing',
    ]) {
      expect(professionTrainerLabel(id)).toBe('');
      expect(professionTrainerNameplateLabel(id)).toBe('');
    }
    expect(npcDisplayTitle('marshal_redbrook')).toBe('Town Marshal');
  });
});
