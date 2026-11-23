import { describe, expect, it } from 'vitest';
import { blankEntity } from '../src/net/blank_entity';
import { MEMBERSHIP_WEAPON_ID } from '../src/sim/content/membership';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { charStatModel } from '../src/ui/char_stat_model_core';
import { buildPlayerCardData } from '../src/ui/hud/player_card/player_card_data';
import { formatNumber, t } from '../src/ui/i18n';
import { weaponDps } from '../src/ui/stat_tooltip';
import { wornItemForPlayer } from '../src/ui/worn_item_definition_core';
import type { IWorld } from '../src/world_api';
import { EMPTY_TEST_WORLD } from './sim_shared';

function member(cls: PlayerClass, spec: string, level = 20) {
  const sim = new Sim({ seed: 42, playerClass: cls, autoEquip: false, world: EMPTY_TEST_WORLD });
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('missing presentation wearer');
  meta.equipment = {};
  meta.inventory = [];
  sim.setPlayerLevel(level);
  expect(sim.setSpec(spec)).toBe(true);
  sim.setMembership(sim.player.id, 60);
  sim.equipItem(MEMBERSHIP_WEAPON_ID);
  expect(sim.equipment.mainhand).toBe(MEMBERSHIP_WEAPON_ID);
  return sim;
}

/** Online entities carry the actual stats and identity, but not derived weapon damage. */
function mirroredWorld(sim: Sim): IWorld {
  const mirror = blankEntity(sim.player.id);
  const { weapon: _notMirrored, ...fields } = sim.player;
  Object.assign(mirror, fields);
  return {
    player: mirror,
    equipment: { ...sim.equipment },
    equipmentInstances: {},
    cfg: sim.cfg,
    arenaInfo: null,
    prestigeRank: 0,
    activeTitle: null,
    realm: 'Test',
  } as unknown as IWorld;
}

function cardDps(world: IWorld): string | undefined {
  const card = buildPlayerCardData(world, {
    characterImage: 'data:image/png;base64,test',
    referral: null,
    standing: null,
    balance: null,
    showDevBadges: false,
    slotName: (slot) => slot,
  });
  return card.combatStats.find((stat) => stat.label === t('itemUi.stats.dps'))?.value;
}

describe('adaptive membership gear presentation', () => {
  it.each([
    ['warrior', 'arms', 20],
    ['warrior', 'prot', 30],
    ['rogue', 'assassination', 20],
  ] as const)(
    'shows combat DPS for %s %s level %s in the sheet and online share card',
    (cls, spec, level) => {
      const sim = member(cls, spec, level);
      const mirror = mirroredWorld(sim);
      const actualDps = weaponDps(sim.player.weapon, sim.player.attackPower);
      expect(actualDps).toBeGreaterThan(
        weaponDps(ITEMS[MEMBERSHIP_WEAPON_ID].weapon, sim.player.attackPower),
      );
      expect(mirror.player.weapon).not.toEqual(sim.player.weapon);
      expect(charStatModel(sim, 'dps').statValue).toBeCloseTo(actualDps, 10);
      expect(charStatModel(mirror, 'dps').statValue).toBeCloseTo(actualDps, 10);
      expect(cardDps(mirror)).toBe(
        formatNumber(actualDps, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      );
      sim.setMembership(sim.player.id, 0);
      const expired = mirroredWorld(sim);
      const expiredDps = weaponDps(sim.player.weapon, sim.player.attackPower);
      expect(charStatModel(expired, 'dps').statValue).toBeCloseTo(expiredDps, 10);
      expect(cardDps(expired)).toBe(
        formatNumber(expiredDps, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      );
    },
  );

  it('changes the live sheet projection when a specialization changes its weapon form', () => {
    const sim = member('warrior', 'arms');
    const arms = charStatModel(mirroredWorld(sim), 'dps').statValue;
    expect(sim.setSpec('prot')).toBe(true);
    const protection = charStatModel(mirroredWorld(sim), 'dps').statValue;
    expect(protection).toBeCloseTo(weaponDps(sim.player.weapon, sim.player.attackPower), 10);
    expect(protection).not.toBe(arms);
    expect(sim.equipment.mainhand).toBe(MEMBERSHIP_WEAPON_ID);
  });

  it('attributes the projected weapon and armour stats to gear, and removes dormant membership sources', () => {
    const sim = member('mage', 'fire');
    sim.equipItem('membership_chest');
    const mirror = mirroredWorld(sim);
    const sources = charStatModel(mirror, 'int').sources;
    let gearIntellect = 0;
    for (const id of [MEMBERSHIP_WEAPON_ID, 'membership_chest']) {
      const item = wornItemForPlayer(mirror, id);
      expect(item?.stats?.int).toBeGreaterThan(0);
      gearIntellect += item?.stats?.int ?? 0;
    }
    expect(sources).toContainEqual({ kind: 'gear', value: gearIntellect });
    sim.setMembership(sim.player.id, 0);
    expect(
      charStatModel(mirroredWorld(sim), 'int').sources.filter((source) => source.kind === 'gear'),
    ).toEqual([]);
  });

  it('projects friendship armour from its own eligibility even without active membership', () => {
    const sim = member('mage', 'fire');
    sim.setMembership(sim.player.id, 0);
    const mirror = mirroredWorld(sim);
    mirror.player.referralInviterName = 'Inviter';
    const item = wornItemForPlayer(mirror, 'referral_helmet');
    expect(item?.stats?.int).toBeGreaterThan(0);
    mirror.player.referralInviterName = undefined;
    expect(wornItemForPlayer(mirror, 'referral_helmet')?.stats).toEqual({});
    expect(wornItemForPlayer(mirror, 'worn_sword')).toBe(ITEMS.worn_sword);
  });
});
