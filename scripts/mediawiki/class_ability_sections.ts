import { ROW_TREES, specSignatureIds, TALENTS } from '../../src/sim/content/talents';
import { ABILITIES, CLASSES, QUESTS } from '../../src/sim/data';
import type { PlayerClass } from '../../src/sim/types';
import { abilityIndexGroup } from './ability_access';
import { wikiAbilityArtPath } from './ability_art_path';
import type { AbilityPageTools } from './talent_articles';

const sectionOrder = [
  'Class spellbook',
  'Specialization abilities',
  'Talent choices',
  'Quest abilities',
  'Conditional replacements',
  'Additional class actions',
  'Membership ability',
] as const;
type Group = (typeof sectionOrder)[number];
type Entry = { name: string; level: number; line: string; specIds: string[] };

export function classAbilitySections(
  cls: PlayerClass,
  { section, bullets, link, titleBy }: AbilityPageTools,
) {
  const groups = new Map<Group, Entry[]>();
  const baseIds = new Set(CLASSES[cls].abilities);
  const specs = TALENTS[cls].specs;
  const replacements = new Set<string>();
  for (const def of Object.values(ABILITIES)) {
    if (def.hiddenFromPlayer || def.class !== cls || !def.actionReplacement) continue;
    const rules = Array.isArray(def.actionReplacement)
      ? def.actionReplacement
      : [def.actionReplacement];
    for (const rule of rules) replacements.add(rule.abilityId);
  }
  for (const [id, title] of titleBy.ability) {
    const def = ABILITIES[id];
    if (def.hiddenFromPlayer) continue;
    const source = abilityIndexGroup(def);
    if (source !== CLASSES[cls].name && source !== 'All classes') continue;
    const specIds = specs
      .filter((s) => def.specs?.includes(s.id) || specSignatureIds(s).includes(id))
      .map((s) => s.id);
    const talents = ROW_TREES[cls].flatMap((row) =>
      row.options
        .filter((o) => o.effect.grant?.ability === id)
        .map((o) => ({ name: o.name, level: row.level })),
    );
    let group: Group;
    let detail = '';
    let level = def.learnLevel;
    if (source === 'All classes') {
      group = 'Membership ability';
      detail = 'Active membership';
    } else if (def.requiresQuest) {
      group = 'Quest abilities';
      detail = QUESTS[def.requiresQuest]?.name ?? '';
    } else if (talents.length) {
      group = 'Talent choices';
      detail = talents.map((o) => o.name + ' (level ' + o.level + ')').join(' or ');
      level = Math.min(...talents.map((o) => o.level));
    } else if (specIds.length) {
      group = 'Specialization abilities';
    } else if (baseIds.has(id)) {
      group = 'Class spellbook';
      detail = 'Level ' + def.learnLevel;
    } else if (replacements.has(id)) {
      group = 'Conditional replacements';
    } else {
      group = 'Additional class actions';
    }
    const path = wikiAbilityArtPath(id);
    if (!path) throw Error('Missing class ability artwork for ' + id);
    const line =
      '<woc-art path="' +
      path +
      '" size="icon" /> ' +
      link(title, def.name) +
      (detail ? ' · ' + detail : '');
    const entries = groups.get(group) ?? [];
    entries.push({
      name: def.name,
      level: group === 'Class spellbook' || group === 'Talent choices' ? level : 0,
      line,
      specIds,
    });
    groups.set(group, entries);
  }
  return sectionOrder
    .filter((group) => groups.has(group))
    .map((group) => {
      const entries = groups.get(group)!;
      entries.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'en'));
      if (group === 'Specialization abilities') {
        const subsections = specs.flatMap((spec) => {
          const lines = entries
            .filter((entry) => entry.specIds.includes(spec.id))
            .map((entry) => entry.line);
          if (!lines.length) return [];
          const title = titleBy.spec?.get(cls + '/' + spec.id);
          const heading = title ? link(title, spec.name) : spec.name;
          return ['=== ' + heading + ' ===\n' + bullets(lines)];
        });
        return section(group, subsections.join('\n\n'));
      }
      return section(group, bullets(entries.map((e) => e.line)));
    })
    .join('');
}
