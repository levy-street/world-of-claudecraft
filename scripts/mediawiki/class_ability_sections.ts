import { ROW_TREES, specSignatureIds, TALENTS } from '../../src/sim/content/talents';
import { ABILITIES, CLASSES, QUESTS } from '../../src/sim/data';
import type { AbilityDef, PlayerClass } from '../../src/sim/types';
import { abilityIndexGroup, MEMBERSHIP_GROUP } from './ability_access';
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
export type ClassAbilityGroup = (typeof sectionOrder)[number];
type Group = ClassAbilityGroup;

// Abilities a same-class action turns into while a condition holds (stances, procs),
// keyed "class/abilityId".
const replacementTargets = new Set(
  Object.values(ABILITIES).flatMap((def) =>
    def.hiddenFromPlayer || !def.actionReplacement
      ? []
      : (Array.isArray(def.actionReplacement)
          ? def.actionReplacement
          : [def.actionReplacement]
        ).map((rule) => def.class + '/' + rule.abilityId),
  ),
);

/** The spellbook section a class ability belongs in; the ability index uses the same rule. */
export function classAbilityGroup(def: AbilityDef): ClassAbilityGroup {
  const cls = def.class as PlayerClass;
  if (abilityIndexGroup(def) === MEMBERSHIP_GROUP) return 'Membership ability';
  if (def.requiresQuest) return 'Quest abilities';
  if (ROW_TREES[cls]?.some((row) => row.options.some((o) => o.effect.grant?.ability === def.id)))
    return 'Talent choices';
  if (
    TALENTS[cls]?.specs.some(
      (s) => def.specs?.includes(s.id) || specSignatureIds(s).includes(def.id),
    )
  )
    return 'Specialization abilities';
  if (CLASSES[cls]?.abilities.includes(def.id)) return 'Class spellbook';
  if (replacementTargets.has(cls + '/' + def.id)) return 'Conditional replacements';
  return 'Additional class actions';
}
type Entry = { name: string; level: number; line: string; specIds: string[] };

export function classAbilitySections(
  cls: PlayerClass,
  { section, bullets, link, titleBy }: AbilityPageTools,
) {
  const groups = new Map<Group, Entry[]>();
  const specs = TALENTS[cls].specs;
  for (const [id, title] of titleBy.ability) {
    const def = ABILITIES[id];
    if (def.hiddenFromPlayer) continue;
    const source = abilityIndexGroup(def);
    if (source !== CLASSES[cls].name && source !== MEMBERSHIP_GROUP) continue;
    const specIds = specs
      .filter((s) => def.specs?.includes(s.id) || specSignatureIds(s).includes(id))
      .map((s) => s.id);
    const talents = ROW_TREES[cls].flatMap((row) =>
      row.options
        .filter((o) => o.effect.grant?.ability === id)
        .map((o) => ({ name: o.name, level: row.level })),
    );
    const group = classAbilityGroup(def);
    let detail = '';
    let level = def.learnLevel;
    if (group === 'Membership ability') detail = 'Active membership';
    else if (group === 'Quest abilities') detail = QUESTS[def.requiresQuest!]?.name ?? '';
    else if (group === 'Talent choices') {
      detail = talents.map((o) => o.name + ' (level ' + o.level + ')').join(' or ');
      level = Math.min(...talents.map((o) => o.level));
    } else if (group === 'Class spellbook') detail = 'Level ' + def.learnLevel;
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
