import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ROACH_CROWN_AURA, ROACH_KING_MOBS } from '../src/sim/content/rift/roach_king';
import { abilityDisplayNameFromSource } from '../src/ui/ability_display_name';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { riftCastDisplayName } from '../src/ui/rift_cast_display_name';
import { localizeSimAuraName, localizeSimText } from '../src/ui/sim_i18n';

const REQUIRED_LOCALES = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const;
beforeAll(async () => {
  await Promise.all(REQUIRED_LOCALES.map((locale) => ensureLocaleLoaded(locale)));
});
afterEach(() => setLanguage('en'));

describe('Roach King player text', () => {
  it('shows the crown as a form marker without a false Attack Power effect', () => {
    expect(auraEffectDescriptor({ id: ROACH_CROWN_AURA, kind: 'buff_ap', value: 0 })).toBeNull();
  });

  it('resolves every live boss and add name through the entity catalog', () => {
    setLanguage('en');
    for (const mob of Object.values(ROACH_KING_MOBS)) {
      expect(tEntity({ kind: 'mob', id: mob.id, field: 'name' })).toBe(mob.name);
    }
  });

  it('localizes all encounter casts and preserves the existing rift cast names', () => {
    setLanguage('en');
    const boss = ROACH_KING_MOBS.rift_boss_asmon;
    for (const mechanic of [boss.bigCast!, boss.deathZoneCast!, boss.deathZoneStrike!]) {
      expect(riftCastDisplayName(mechanic.castId)).toBe(mechanic.name);
    }
    expect(riftCastDisplayName('rift_asmon_coronation')).toBe('Coronation of Filth');
    expect(riftCastDisplayName('rift_asmon_tribute')).toBe('Tribute Feast');
    expect(riftCastDisplayName('rift_frost_execution')).toBe('Glacial Grave');
    expect(riftCastDisplayName('ordinary_player_ability')).toBeNull();
    for (const id of [
      'rift_asmon_coronation',
      'rift_asmon_tribute',
      'rift_asmon_desk_slam',
      'rift_asmon_filth',
      'rift_asmon_swarm',
    ]) {
      expect(abilityDisplayNameFromSource(id)).toBe(riftCastDisplayName(id));
    }
  });

  it.each(REQUIRED_LOCALES)('renders translated encounter text in %s', (locale) => {
    setLanguage(locale);
    expect(riftCastDisplayName('rift_asmon_coronation')).not.toBe('Coronation of Filth');
    expect(localizeSimAuraName("Roach King's Crown")).not.toBe("Roach King's Crown");
    expect(localizeSimText('Mountain of Filth: leave the marked ground!')).toBe(
      t('sim.rift.roachKing.filthWarning'),
    );
    expect(localizeSimText('Mountain of Filth: leave the marked ground!')).not.toBe(
      'Mountain of Filth: leave the marked ground!',
    );
  });

  it('recognizes actionable warning text and the crown aura', () => {
    setLanguage('en');
    const messages = [
      ['The hermit rises. The Roach King claims his crown!', 'crownWarning'],
      ['Mountain of Filth: leave the marked ground!', 'filthWarning'],
      ['Tribute Feast: interrupt the channel or kill the tribute beetles!', 'tributeWarning'],
      ['The Roach King winds up: get outside the ring!', 'ringWarning'],
      ['The mountain of filth erupts!', 'filthDetonate'],
      ['The royal swarm erupts!', 'swarmDetonate'],
    ] as const;
    for (const [english, key] of messages) {
      expect(localizeSimText(english)).toBe(t(`sim.rift.roachKing.${key}`));
    }
    expect(localizeSimAuraName("Roach King's Crown")).toBe(t('sim.rift.roachKing.crown'));
    expect(localizeSimAuraName('Tribute Feast')).toBe(t('sim.rift.roachKing.tributeFeast'));
    expect(riftCastDisplayName('rift_asmon_coronation')).toBe(t('sim.rift.roachKing.coronation'));
  });
});
