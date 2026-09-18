// Pins src/sim/town_quests.ts: which quests count as a zone's TOWN quests
// (given or turned in inside the hub circle, not a profession trainer's, not
// repeatable), when a town reads as complete, and the zone-entry hint the HUD's
// chat line resolves from it (welcome while the welcome quest is on offer,
// town_done once every counted quest is turned in AND the zone authors a
// welcomeDone line, nothing in between).
import { describe, expect, it } from 'vitest';
import { PROFESSION_TRAINERS } from '../src/sim/content/profession_trainers';
import { NPCS, QUESTS, ZONES, zoneAt } from '../src/sim/data';
import { isInTownZone } from '../src/sim/professions/focus';
import {
  isProfessionTrainerNpc,
  questAnchorNpcIds,
  townQuestIds,
  townQuestsComplete,
  zoneEntryHint,
} from '../src/sim/town_quests';
import type { QuestState, ZoneDef } from '../src/sim/types';
import { makeSim, teleportTo } from './fixes_shared';
import { expectDefined } from './helpers/defined';

const zone = (id: string): ZoneDef => expectDefined(ZONES.find((z) => z.id === id));
const eastbrook = zone('eastbrook_vale');
const fenbridge = zone('mirefen_marsh');

const stateOf =
  (done: ReadonlySet<string>) =>
  (questId: string): QuestState =>
    done.has(questId) ? 'done' : 'available';

function markDone(sim: ReturnType<typeof makeSim>, ids: Iterable<string>): void {
  const meta = expectDefined(sim.meta(sim.playerId));
  for (const id of ids) meta.questsDone.add(id);
}

describe('townQuestIds', () => {
  it('lists the Eastbrook story quests and none of the trainers or work orders', () => {
    const ids = townQuestIds(eastbrook);
    expect(ids).toEqual(
      expect.arrayContaining(['q_wolves', 'q_greyjaw', 'q_boars', 'q_spiders', 'q_murlocs']),
    );
    // The mine foreman and the farmer are trainers: their onboarding quests
    // are excluded whole, not only the repeatable work orders.
    expect(ids).not.toContain('q_mine');
    expect(ids).not.toContain('q_prof_intro');
    expect(ids).not.toContain('q_farm_intro');
    for (const id of ids) {
      const quest = expectDefined(QUESTS[id]);
      expect(quest.repeatable ?? false).toBe(false);
      expect(isProfessionTrainerNpc(quest.giverNpcId)).toBe(false);
      const anchors = questAnchorNpcIds(quest).map((id) => expectDefined(NPCS[id]));
      expect(anchors.some((npc) => isInTownZone(npc.pos, eastbrook))).toBe(true);
      for (const npc of anchors) expect(zoneAt(npc.pos.x, npc.pos.z).id).toBe('eastbrook_vale');
    }
  });

  it('counts a border breadcrumb that is turned in at the town warden', () => {
    // Frostveil opens with Scout Einna's report on the snowline road; the town
    // warden receives it, so Icemantle is not finished until it is handed in.
    const frostveil = zone('frostveil');
    const snowline = expectDefined(QUESTS.q_fv_snowline_report);
    expect(isInTownZone(expectDefined(NPCS[snowline.giverNpcId]).pos, frostveil)).toBe(false);
    expect(isInTownZone(expectDefined(NPCS[snowline.turnInNpcId]).pos, frostveil)).toBe(true);
    expect(townQuestIds(frostveil)).toContain('q_fv_snowline_report');
  });

  it('every mainland zone with a welcome quest counts that quest as a town quest', () => {
    for (const z of ZONES) {
      if (!z.welcomeQuestId) continue;
      // The tutorial island's welcome quest is the beach gauntlet, given and
      // finished on the shore before the camp; it is the one welcome quest
      // that never touches a town.
      if (z.id === 'proving_shore') continue;
      expect(townQuestIds(z), z.id).toContain(z.welcomeQuestId);
    }
  });

  it('never lists a quest given at a trainer, in any zone', () => {
    const trainerGiven = new Set(
      Object.values(QUESTS)
        .filter((q) => q.giverNpcId in PROFESSION_TRAINERS)
        .map((q) => q.id),
    );
    expect(trainerGiven.size).toBeGreaterThan(0);
    for (const z of ZONES) {
      for (const id of townQuestIds(z)) expect(trainerGiven.has(id), `${z.id}:${id}`).toBe(false);
    }
  });
});

describe('townQuestsComplete', () => {
  it('is false while any town quest is still open, true once all are turned in', () => {
    const ids = townQuestIds(eastbrook);
    const allButOne = new Set(ids.slice(1));
    expect(townQuestsComplete(eastbrook, stateOf(allButOne), 'warrior')).toBe(false);
    expect(townQuestsComplete(eastbrook, stateOf(new Set(ids)), 'warrior')).toBe(true);
  });

  it('skips retired and other-class quests, but holds a class to its own', () => {
    const ids = townQuestIds(fenbridge);
    // Both live in Fenbridge: the retired star quest and the paladin-only rite.
    expect(ids).toContain('q_aldrics_fallen_star');
    expect(ids).toContain('q_rite_of_redemption');
    expect(expectDefined(QUESTS.q_aldrics_fallen_star).retired).toBe(true);
    expect(expectDefined(QUESTS.q_rite_of_redemption).requiredClass).toEqual(['paladin']);
    const reachableForAll = new Set(
      ids.filter((id) => id !== 'q_aldrics_fallen_star' && id !== 'q_rite_of_redemption'),
    );
    expect(townQuestsComplete(fenbridge, stateOf(reachableForAll), 'warrior')).toBe(true);
    expect(townQuestsComplete(fenbridge, stateOf(reachableForAll), 'paladin')).toBe(false);
    const withRite = new Set([...reachableForAll, 'q_rite_of_redemption']);
    expect(townQuestsComplete(fenbridge, stateOf(withRite), 'paladin')).toBe(true);
  });

  it('a zone with no town quests is never complete', () => {
    const empty: ZoneDef = {
      ...eastbrook,
      id: 'nowhere',
      hub: { x: 9000, z: 9000, radius: 1, name: 'Nowhere' },
    };
    expect(townQuestIds(empty)).toEqual([]);
    expect(townQuestsComplete(empty, () => 'done', 'warrior')).toBe(false);
  });
});

describe('zoneEntryHint on a live Sim', () => {
  it('welcome on a fresh character, silent after the welcome quest is taken, town_done once the town is finished', () => {
    const sim = makeSim();
    const questState = (id: string) => sim.questState(id);
    expect(zoneEntryHint(eastbrook, questState, sim.cfg.playerClass)).toBe('welcome');

    const redbrook = expectDefined(
      [...sim.entities.values()].find((e) => e.templateId === 'marshal_redbrook'),
    );
    teleportTo(sim, redbrook.pos.x + 2, redbrook.pos.z + 2);
    sim.acceptQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('active');
    expect(zoneEntryHint(eastbrook, questState, sim.cfg.playerClass)).toBeNull();

    // Finishing every OTHER town quest is not enough while Wolves is still active.
    markDone(
      sim,
      townQuestIds(eastbrook).filter((id) => id !== 'q_wolves'),
    );
    expect(zoneEntryHint(eastbrook, questState, sim.cfg.playerClass)).toBeNull();

    sim.abandonQuest('q_wolves');
    markDone(sim, ['q_wolves']);
    expect(sim.questState('q_wolves')).toBe('done');
    expect(zoneEntryHint(eastbrook, questState, sim.cfg.playerClass)).toBe('town_done');
  });

  it('a zone without a welcome quest keeps its welcome hint until the town is finished', () => {
    const sim = makeSim();
    const questState = (id: string) => sim.questState(id);
    expect(fenbridge.welcomeQuestId).toBeUndefined();
    expect(zoneEntryHint(fenbridge, questState, sim.cfg.playerClass)).toBe('welcome');
    markDone(sim, townQuestIds(fenbridge));
    expect(zoneEntryHint(fenbridge, questState, sim.cfg.playerClass)).toBe('town_done');
  });

  it('only the three founding zones author a town-done line; no other zone reads town_done', () => {
    expect(ZONES.filter((z) => z.welcomeDone !== undefined).map((z) => z.id)).toEqual([
      'eastbrook_vale',
      'mirefen_marsh',
      'thornpeak_heights',
    ]);
    const frostveil = zone('frostveil');
    const sim = makeSim();
    const questState = (id: string) => sim.questState(id);
    markDone(sim, townQuestIds(frostveil));
    expect(townQuestsComplete(frostveil, questState, sim.cfg.playerClass)).toBe(true);
    // Its welcome quest is a border breadcrumb that markDone covered too, so
    // the welcome rule has gone quiet: the entry stays silent, never town_done.
    expect(zoneEntryHint(frostveil, questState, sim.cfg.playerClass)).toBeNull();
  });

  it('trainer work stays out of the decision: a finished town with untouched trainers reads town_done', () => {
    const sim = makeSim();
    markDone(sim, townQuestIds(eastbrook));
    expect(sim.questState('q_mine')).not.toBe('done');
    expect(sim.questState('q_farm_intro')).not.toBe('done');
    expect(zoneEntryHint(eastbrook, (id) => sim.questState(id), sim.cfg.playerClass)).toBe(
      'town_done',
    );
  });
});
