import { describe, expect, it } from 'vitest';
import { infernalAbyssLoreLines } from '../src/sim/quests/infernal_abyss_lore';
import { Sim } from '../src/sim/sim';
import { setLanguage } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

describe('Infernal Abyss lore visions', () => {
  it('provides a two-line revelation for every authored lore object', () => {
    for (const itemId of [
      'charred_legion_tablet',
      'brands_of_the_first_flame',
      'forgekeepers_ledger',
      'azazels_broken_covenant',
    ]) {
      const lines = infernalAbyssLoreLines(itemId);
      expect(lines, itemId).toHaveLength(2);
      expect(lines?.every((line) => line.length > 20)).toBe(true);
    }
  });

  it('does not invent dialogue for ordinary interactables', () => {
    expect(infernalAbyssLoreLines('not_infernal_lore')).toBeNull();
  });

  it('shares lore credit and the vision with nearby party members, like the graves', () => {
    const sim = new Sim({ seed: 77, playerClass: 'warrior', playerName: 'Lead' });
    sim.setPlayerLevel(20);
    const allyPid = sim.addPlayer('mage', 'Ally');
    sim.partyInvite(allyPid);
    sim.partyAccept(allyPid);
    sim.enterDungeon('infernal_abyss');

    const tablet = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === 'charred_legion_tablet',
    );
    expect(tablet, 'the tablet spawns with the claimed instance').toBeTruthy();
    if (!tablet) return;
    sim.player.pos = { ...tablet.pos };
    sim.player.prevPos = { ...tablet.pos };
    const ally = sim.entities.get(allyPid);
    if (ally) {
      ally.pos = { x: tablet.pos.x + 5, y: tablet.pos.y, z: tablet.pos.z };
      ally.prevPos = { ...ally.pos };
    }
    for (const pid of [sim.playerId, allyPid]) {
      sim.meta(pid)?.questLog.set('q_infernal_abyss_echoes', {
        questId: 'q_infernal_abyss_echoes',
        counts: [0, 0],
        state: 'active',
      });
    }

    sim.pickUpObject(tablet.id);

    expect(sim.questLog.get('q_infernal_abyss_echoes')?.counts[0]).toBe(1);
    expect(sim.meta(allyPid)?.questLog.get('q_infernal_abyss_echoes')?.counts[0]).toBe(1);
    // BOTH vision lines reach BOTH party members (dropping the second line of
    // the two-line revelation must red this test). The second line rides the
    // delayed-event queue five seconds behind the first, so collect across it.
    const collected = [...sim.events];
    for (let i = 0; i < 20 * 6; i++) collected.push(...sim.tick());
    for (const line of infernalAbyssLoreLines('charred_legion_tablet') ?? []) {
      expect(collected).toContainEqual(
        expect.objectContaining({ type: 'log', pid: sim.playerId, text: line }),
      );
      expect(collected).toContainEqual(
        expect.objectContaining({ type: 'log', pid: allyPid, text: line }),
      );
    }
  });

  it('localizes every lore line in the five non-Latin M16 locales', () => {
    const english = Object.values([
      'charred_legion_tablet',
      'brands_of_the_first_flame',
      'forgekeepers_ledger',
      'azazels_broken_covenant',
    ]).flatMap((itemId) => infernalAbyssLoreLines(itemId) ?? []);
    for (const language of ['zh_CN', 'zh_TW', 'ko_KR', 'ja_JP', 'ru_RU'] as const) {
      setLanguage(language);
      for (const line of english) expect(localizeSimText(line)).not.toBe(line);
    }
    setLanguage('en');
  });
});
