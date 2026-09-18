import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS, WORLD_QUESTS_BY_ID } from '../src/sim/content/world_quests';
import {
  awardFactionReputation,
  FACTION_IDS,
  FACTIONS,
  factionForZone,
  factionTierTitle,
  freshFactionReputation,
  LOW_LEVEL_MAX_STANDING,
  MAX_STANDING,
  maxStandingForLevel,
  STANDING_THRESHOLDS,
  STANDING_TIERS,
  sanitizeFactionReputation,
  standingProgress,
  standingTierForReputation,
  worldQuestFaction,
  worldQuestStandingReward,
} from '../src/sim/factions';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import {
  freshWorldQuestPlayerState,
  restoreWorldQuestState,
  savedWorldQuestState,
} from '../src/sim/world_quest_state';
import {
  worldQuestFactionLine,
  worldQuestFactionName,
  worldQuestRewardLine,
  worldQuestStandingRewardText,
} from '../src/ui/world_quest_view';

describe('factions and zone distribution', () => {
  it('defines the three approved allied factions and their hubs', () => {
    expect(FACTION_IDS).toEqual(['rift_watch', 'church_order', 'automatons']);

    expect(FACTIONS.rift_watch.name).toBe('Rift Watch');
    expect(FACTIONS.rift_watch.hub.name).toBe('Drifthaven');
    expect(FACTIONS.rift_watch.hub.zoneId).toBe('palmreach');

    expect(FACTIONS.church_order.name).toBe('Church Order');
    expect(FACTIONS.church_order.hub.name).toBe('Brother Aldric');
    expect(FACTIONS.church_order.hub.zoneId).toBe('eastbrook_vale');

    expect(FACTIONS.automatons.name).toBe('Automatons');
    expect(FACTIONS.automatons.hub.name).toBe('Wyrmwatch');
    expect(FACTIONS.automatons.hub.zoneId).toBe('drakelands');
  });

  it('maps all 14 non-tutorial overworld zones to the 3 factions', () => {
    // Rift Watch: 5 zones
    expect(factionForZone('farshore')).toBe('rift_watch');
    expect(factionForZone('farshore_isle')).toBe('rift_watch');
    expect(factionForZone('palmreach')).toBe('rift_watch');
    expect(factionForZone('galecrest')).toBe('rift_watch');
    expect(factionForZone('willowfen')).toBe('rift_watch');
    expect(factionForZone('veiled_hollow')).toBe('rift_watch');

    // Church Order: 5 zones
    expect(factionForZone('eastbrook_vale')).toBe('church_order');
    expect(factionForZone('zone1')).toBe('church_order');
    expect(factionForZone('mirefen_marsh')).toBe('church_order');
    expect(factionForZone('zone2')).toBe('church_order');
    expect(factionForZone('thornpeak_heights')).toBe('church_order');
    expect(factionForZone('zone3')).toBe('church_order');
    expect(factionForZone('nightbloom')).toBe('church_order');
    expect(factionForZone('wraithwood')).toBe('church_order');

    // Automatons: 4 zones
    expect(factionForZone('drakelands')).toBe('automatons');
    expect(factionForZone('frostveil')).toBe('automatons');
    expect(factionForZone('amberfall')).toBe('automatons');
    expect(factionForZone('evergarden')).toBe('automatons');

    // Proving Shore (tutorial) is excluded
    expect(factionForZone('proving_shore')).toBeNull();
  });

  it('attributes every authored World Quest to a valid faction', () => {
    expect(WORLD_QUESTS.length).toBeGreaterThanOrEqual(14);
    for (const quest of WORLD_QUESTS) {
      const faction = worldQuestFaction(quest);
      expect(FACTION_IDS).toContain(faction);
    }
  });
});

describe('standing tiers and thresholds', () => {
  it('implements the exact 6 cumulative standing tiers', () => {
    expect(STANDING_TIERS).toEqual([
      'unknown',
      'recognized',
      'trusted',
      'proven',
      'vanguard',
      'champion',
    ]);
    expect(STANDING_THRESHOLDS.unknown).toBe(0);
    expect(STANDING_THRESHOLDS.recognized).toBe(1_000);
    expect(STANDING_THRESHOLDS.trusted).toBe(3_000);
    expect(STANDING_THRESHOLDS.proven).toBe(7_000);
    expect(STANDING_THRESHOLDS.vanguard).toBe(13_000);
    expect(STANDING_THRESHOLDS.champion).toBe(20_000);
  });

  it('evaluates standing tiers accurately at boundaries', () => {
    expect(standingTierForReputation(0)).toBe('unknown');
    expect(standingTierForReputation(999)).toBe('unknown');
    expect(standingTierForReputation(1_000)).toBe('recognized');
    expect(standingTierForReputation(2_999)).toBe('recognized');
    expect(standingTierForReputation(3_000)).toBe('trusted');
    expect(standingTierForReputation(6_999)).toBe('trusted');
    expect(standingTierForReputation(7_000)).toBe('proven');
    expect(standingTierForReputation(12_999)).toBe('proven');
    expect(standingTierForReputation(13_000)).toBe('vanguard');
    expect(standingTierForReputation(19_999)).toBe('vanguard');
    expect(standingTierForReputation(20_000)).toBe('champion');
    expect(standingTierForReputation(50_000)).toBe('champion');
  });

  it('provides thematic faction flavor titles for each standing rank', () => {
    // Rift Watch: Outsider -> Watcher -> Riftwalker -> Warden -> Riftwarden -> Champion
    expect(factionTierTitle('rift_watch', 0)).toBe('Outsider');
    expect(factionTierTitle('rift_watch', 1_000)).toBe('Watcher');
    expect(factionTierTitle('rift_watch', 3_000)).toBe('Riftwalker');
    expect(factionTierTitle('rift_watch', 7_000)).toBe('Warden');
    expect(factionTierTitle('rift_watch', 13_000)).toBe('Riftwarden');
    expect(factionTierTitle('rift_watch', 20_000)).toBe('Champion');

    // Church Order: Outsider -> Acolyte -> Keeper -> Templar -> Dawnkeeper -> Champion
    expect(factionTierTitle('church_order', 0)).toBe('Outsider');
    expect(factionTierTitle('church_order', 1_000)).toBe('Acolyte');
    expect(factionTierTitle('church_order', 3_000)).toBe('Keeper');
    expect(factionTierTitle('church_order', 7_000)).toBe('Templar');
    expect(factionTierTitle('church_order', 13_000)).toBe('Dawnkeeper');
    expect(factionTierTitle('church_order', 20_000)).toBe('Champion');

    // Automatons: Outsider -> Operator -> Mechanist -> Artificer -> Forgemaster -> Champion
    expect(factionTierTitle('automatons', 0)).toBe('Outsider');
    expect(factionTierTitle('automatons', 1_000)).toBe('Operator');
    expect(factionTierTitle('automatons', 3_000)).toBe('Mechanist');
    expect(factionTierTitle('automatons', 7_000)).toBe('Artificer');
    expect(factionTierTitle('automatons', 13_000)).toBe('Forgemaster');
    expect(factionTierTitle('automatons', 20_000)).toBe('Champion');
  });

  it('computes standingProgress percentage and remaining points within a tier', () => {
    // 1,500 rep: in Recognized (starts at 1,000, next is 3,000 -> 500 of 2,000 = 25%)
    const p1 = standingProgress(1_500);
    expect(p1.tier).toBe('recognized');
    expect(p1.tierStart).toBe(1_000);
    expect(p1.tierNext).toBe(3_000);
    expect(p1.tierProgress).toBe(500);
    expect(p1.tierRequired).toBe(2_000);
    expect(p1.percent).toBe(25);

    // At Champion: 100% complete
    const pChamp = standingProgress(20_000);
    expect(pChamp.tier).toBe('champion');
    expect(pChamp.tierNext).toBeNull();
    expect(pChamp.percent).toBe(100);
  });
});

describe('level brackets and synchronized daily reward math', () => {
  it('awards 30 reputation per WQ for level 5-15 characters', () => {
    const eastbrookQuest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    expect(worldQuestStandingReward(eastbrookQuest, 5)).toBe(30);
    expect(worldQuestStandingReward(eastbrookQuest, 10)).toBe(30);
    expect(worldQuestStandingReward(eastbrookQuest, 15)).toBe(30);
  });

  it('caps level 5-15 characters at Trusted (3,000 standing)', () => {
    expect(maxStandingForLevel(5)).toBe(LOW_LEVEL_MAX_STANDING);
    expect(maxStandingForLevel(15)).toBe(3_000);
    expect(maxStandingForLevel(16)).toBe(MAX_STANDING);
    expect(maxStandingForLevel(20)).toBe(20_000);

    const meta = {
      ...freshWorldQuestPlayerState(),
    } as unknown as PlayerMeta;

    // Advance to 2,980
    meta.factions.church_order = 2_980;
    const r1 = awardFactionReputation(meta, 'church_order', 30, 10);
    expect(r1.gained).toBe(20);
    expect(r1.total).toBe(3_000);
    expect(r1.tier).toBe('trusted');
    expect(r1.capped).toBe(true);

    // Cannot exceed 3,000 while level <= 15
    const r2 = awardFactionReputation(meta, 'church_order', 30, 15);
    expect(r2.gained).toBe(0);
    expect(r2.total).toBe(3_000);
    expect(r2.capped).toBe(true);

    // Leveling up to 16 lifts the cap!
    const r3 = awardFactionReputation(meta, 'church_order', 80, 16);
    expect(r3.gained).toBe(80);
    expect(r3.total).toBe(3_080);
    expect(r3.capped).toBe(false);
  });

  it('reports the tier before the award so a caller can tell a tier from a plain gain', () => {
    const meta = { ...freshWorldQuestPlayerState() } as unknown as PlayerMeta;
    meta.factions = freshFactionReputation();
    meta.factions.rift_watch = 980;
    const crossed = awardFactionReputation(meta, 'rift_watch', 30, 16);
    expect(crossed.previousTier).toBe('unknown');
    expect(crossed.tier).toBe('recognized');
    const plain = awardFactionReputation(meta, 'rift_watch', 30, 16);
    expect(plain.previousTier).toBe('recognized');
    expect(plain.tier).toBe('recognized');
    // A capped award that lands exactly on the threshold still reports the tier.
    meta.factions.rift_watch = 2_990;
    const capped = awardFactionReputation(meta, 'rift_watch', 500, 10);
    expect(capped.capped).toBe(true);
    expect(capped.previousTier).toBe('recognized');
    expect(capped.tier).toBe('trusted');
    // Nothing gained, nothing crossed.
    const stuck = awardFactionReputation(meta, 'rift_watch', 500, 10);
    expect(stuck.gained).toBe(0);
    expect(stuck.previousTier).toBe(stuck.tier);
  });

  it('synchronizes daily progression at levels 16-20 (400 rep/day per faction)', () => {
    // 5 Rift Watch zones * 80 = 400
    const riftQuest = WORLD_QUESTS_BY_ID.wq_farshore_salvage;
    expect(worldQuestFaction(riftQuest)).toBe('rift_watch');
    expect(worldQuestStandingReward(riftQuest, 16)).toBe(80);
    expect(worldQuestStandingReward(riftQuest, 20)).toBe(80);

    // 5 Church Order zones * 80 = 400
    const churchQuest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    expect(worldQuestFaction(churchQuest)).toBe('church_order');
    expect(worldQuestStandingReward(churchQuest, 16)).toBe(80);
    expect(worldQuestStandingReward(churchQuest, 20)).toBe(80);

    // 4 Automaton zones * 100 = 400
    const automatonQuest = WORLD_QUESTS_BY_ID.wq_drakelands_brood;
    expect(worldQuestFaction(automatonQuest)).toBe('automatons');
    expect(worldQuestStandingReward(automatonQuest, 16)).toBe(100);
    expect(worldQuestStandingReward(automatonQuest, 20)).toBe(100);

    // Full daily circuit: 5*80 + 5*80 + 4*100 = 400 + 400 + 400 = 1,200 total
    const totalDaily = 5 * 80 + 5 * 80 + 4 * 100;
    expect(totalDaily).toBe(1_200);
  });
});

describe('faction state persistence and invariants', () => {
  it('starts fresh players with 0 reputation across all three factions', () => {
    const state = freshWorldQuestPlayerState();
    expect(state.factions).toEqual({
      rift_watch: 0,
      church_order: 0,
      automatons: 0,
    });
  });

  it('persists and restores earned standing cleanly', () => {
    const meta = {
      ...freshWorldQuestPlayerState(),
      unlockedMilestones: new Set<string>(),
      worldQuestCycle: 'wq1_10',
    } as unknown as PlayerMeta;

    meta.factions.rift_watch = 1_400;
    meta.factions.church_order = 3_200;
    meta.factions.automatons = 800;

    const saved = savedWorldQuestState(meta);
    expect(saved.worldQuests?.factions).toEqual({
      rift_watch: 1_400,
      church_order: 3_200,
      automatons: 800,
    });
    expect(saved.factions).toEqual({
      rift_watch: 1_400,
      church_order: 3_200,
      automatons: 800,
    });

    const targetMeta = {
      ...freshWorldQuestPlayerState(),
      unlockedMilestones: new Set<string>(),
    } as unknown as PlayerMeta;

    restoreWorldQuestState(targetMeta, saved.worldQuests, saved.factions);
    expect(targetMeta.factions).toEqual({
      rift_watch: 1_400,
      church_order: 3_200,
      automatons: 800,
    });
  });

  it('clamps invalid or corrupted save values', () => {
    const sanitized = sanitizeFactionReputation({
      rift_watch: -500,
      church_order: 999_999,
      automatons: 12.7,
      unknown_faction: 1_000,
    });
    expect(sanitized.rift_watch).toBe(0);
    expect(sanitized.church_order).toBe(MAX_STANDING);
    expect(sanitized.automatons).toBe(12);
  });
});

describe('world quest UI display lines', () => {
  it('clearly formats faction and standing reward strings', () => {
    const riftQuest = WORLD_QUESTS_BY_ID.wq_farshore_salvage;
    expect(worldQuestFactionName(riftQuest)).toBe('Rift Watch');
    expect(worldQuestFactionLine(riftQuest)).toBe('Faction: Rift Watch');
    expect(worldQuestStandingRewardText(riftQuest, 20)).toBe('+80 Rift Watch Standing');

    const churchQuest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    expect(worldQuestFactionName(churchQuest)).toBe('Church Order');
    expect(worldQuestFactionLine(churchQuest)).toBe('Faction: Church Order');
    expect(worldQuestStandingRewardText(churchQuest, 10)).toBe('+30 Church Order Standing');

    const autoQuest = WORLD_QUESTS_BY_ID.wq_drakelands_brood;
    expect(worldQuestFactionName(autoQuest)).toBe('Automatons');
    expect(worldQuestFactionLine(autoQuest)).toBe('Faction: Automatons');
    expect(worldQuestStandingRewardText(autoQuest, 20)).toBe('+100 Automatons Standing');
  });

  it('includes standing in the unified reward line', () => {
    const autoQuest = WORLD_QUESTS_BY_ID.wq_drakelands_brood;
    const line = worldQuestRewardLine(autoQuest, 20);
    expect(line).toContain('+100 Automatons Standing');
  });
});
describe('simulation WQ completion standing integration', () => {
  it('awards standing when a quest is completed in the live simulation', () => {
    const sim = new Sim({ seed: 410, playerClass: 'warrior', autoEquip: true });
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    sim.setPlayerLevel(10);
    sim.utcDay = '2026-08-31';
    sim.resetDay = '2026-08-31';
    const player = sim.player;
    player.pos.x = quest.area.x;
    player.pos.z = quest.area.z;
    player.prevPos = { ...player.pos };
    sim.tick();

    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Missing player meta');
    expect(meta.factions.church_order).toBe(0);
    expect(sim.factions.church_order).toBe(0);

    const objective = quest.objective;
    if (objective.type !== 'delivery') throw new Error('Expected delivery quest');
    const pickup = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === objective.pickupObjectItemId,
    );
    const destination = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === objective.deliveryObjectItemId,
    );
    if (!pickup || !destination) throw new Error('Missing delivery objects');
    expect(pickup).toBeDefined();
    expect(destination).toBeDefined();
    for (let i = 0; i < quest.count; i++) {
      player.pos.x = pickup.pos.x;
      player.pos.z = pickup.pos.z;
      expect(sim.pickUpObject(pickup.id)).toBe(true);
      player.pos.x = destination.pos.x;
      player.pos.z = destination.pos.z;
      expect(sim.pickUpObject(destination.id)).toBe(true);
    }

    expect(meta.factions.church_order).toBe(30);
    expect(sim.factions.church_order).toBe(30);
  });
});
