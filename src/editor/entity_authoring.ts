import type { MobTemplate } from '../sim/types';

export type CharacterVisualCategory = 'npc' | 'player' | 'humanoid' | 'creature' | 'form';

export interface CharacterVisualOption {
  key: string;
  label: string;
  category: CharacterVisualCategory;
}

export interface MobCatalogOption {
  id: string;
  label: string;
  family: string;
  minLevel: number;
  maxLevel: number;
  elite: boolean;
  rare: boolean;
  boss: boolean;
  scale: number;
  aggroRadius: number;
  mechanics: string[];
}

export function humanizeAuthoringId(id: string): string {
  return id
    .replace(/^(?:npc|mob|player|form|skel|delve)_/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

export function characterVisualCategory(key: string): CharacterVisualCategory {
  if (key.startsWith('npc_')) return 'npc';
  if (key.startsWith('player_')) return 'player';
  if (key.startsWith('form_')) return 'form';
  if (
    key.startsWith('skel_') ||
    key.includes('caster') ||
    key.includes('acolyte') ||
    key.includes('ritualist') ||
    key.includes('bandit') ||
    key.includes('bruiser')
  ) {
    return 'humanoid';
  }
  return 'creature';
}

/** Stable model browser inventory from the rig manifest's keys. */
export function buildCharacterVisualOptions(keys: readonly string[]): CharacterVisualOption[] {
  return [...new Set(keys)]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      key,
      label: humanizeAuthoringId(key),
      category: characterVisualCategory(key),
    }));
}

function mobMechanics(template: MobTemplate): string[] {
  const tags: string[] = [];
  if (template.elite) tags.push('elite');
  if (template.rare) tags.push('rare');
  if (template.boss) tags.push('boss');
  if (template.bigCast || template.aoePulse) tags.push('caster');
  if (template.mendAlly || template.wardAllies || template.channelHeal) tags.push('support');
  if (template.summonAdds) tags.push('summoner');
  if (template.enrage || template.rampage || template.packFrenzy) tags.push('enrage');
  if (template.canSwim) tags.push('swimmer');
  if (template.dummy) tags.push('stationary');
  return tags;
}

/** Rich, stable catalog rows for the editor without exposing mutable templates. */
export function buildMobCatalogOptions(
  templates: Readonly<Record<string, MobTemplate>>,
  labelFor: (id: string) => string,
): MobCatalogOption[] {
  return Object.keys(templates)
    .map((id) => ({ id, label: labelFor(id) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ id, label }) => {
      const template = templates[id];
      return {
        id,
        label,
        family: template.family,
        minLevel: template.minLevel,
        maxLevel: template.maxLevel,
        elite: template.elite === true,
        rare: template.rare === true,
        boss: template.boss === true,
        scale: template.scale,
        aggroRadius: template.aggroRadius,
        mechanics: mobMechanics(template),
      };
    });
}

export function catalogMatches(query: string, ...values: readonly string[]): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return values.some((value) => value.toLocaleLowerCase().includes(needle));
}
