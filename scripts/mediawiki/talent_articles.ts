import {
  ROW_TREES,
  SPEC_UNLOCK_LEVEL,
  specSignatureIds,
  TALENTS,
  type TalentEffect,
} from '../../src/sim/content/talents';
import { ABILITIES, CLASSES } from '../../src/sim/data';
import { specBaselineDescription } from '../../src/ui/talent_i18n';

export interface AbilityPageTools {
  titleBy: {
    class: Map<string, string>;
    ability: Map<string, string>;
    quest: Map<string, string>;
    item?: Map<string, string>;
    spec?: Map<string, string>;
    talent?: Map<string, string>;
  };
  section: (heading: string, body: string) => string;
  table: (rows: string[][]) => string;
  bullets: (entries: string[]) => string;
  link: (title: string, label?: string) => string;
}
interface TalentPageTools extends AbilityPageTools {
  add: (title: string, text: string, categories: string[]) => void;
  unique: (title: string, used: Set<string>) => string;
  usedTitles: Set<string>;
}
export function affectedAbilities(effect: TalentEffect): string[] {
  return [
    ...new Set(
      [effect.grant?.ability, ...(effect.ability ?? []).map((mod) => mod.ability)].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
}

export function addTalentPages({
  titleBy,
  link,
  section,
  bullets,
  table,
  add,
  usedTitles,
  unique,
}: TalentPageTools): void {
  const specs = new Map<string, string>(),
    talents = new Map<string, string>();
  titleBy.spec = specs;
  titleBy.talent = talents;
  const specIndex: string[][] = [],
    talentIndex: string[][] = [];
  const abilityLink = (id: string) =>
    titleBy.ability.has(id) ? link(titleBy.ability.get(id)!, ABILITIES[id].name) : '';
  for (const cls of Object.values(TALENTS)) {
    const id = cls.class;
    const classLink = link(titleBy.class.get(id)!, CLASSES[id].name);
    const rows = ROW_TREES[id];
    for (const spec of cls.specs)
      specs.set(id + '/' + spec.id, unique(spec.name + ' (Specialization)', usedTitles));
    for (const row of rows)
      for (const option of row.options)
        talents.set(id + '/' + option.id, unique(option.name + ' (Talent)', usedTitles));
    const specLinks = cls.specs.map((s) => link(specs.get(id + '/' + s.id)!, s.name));
    const choiceLink = (choice: { id: string; name: string }) =>
      link(talents.get(id + '/' + choice.id)!, choice.name);
    specIndex.push([classLink, specLinks.join(' · ')]);
    const choices = rows.map((row) => [
      'Level ' + row.level,
      row.options.map(choiceLink).join(' · '),
    ]);
    for (const [level, list] of choices) talentIndex.push([classLink + ' · ' + level, list]);
    for (const spec of cls.specs) {
      const baseline = specBaselineDescription(spec);
      const signatureIds = specSignatureIds(spec);
      const kit = Object.values(ABILITIES)
        .filter((a) => a.class === id && a.specs?.includes(spec.id) && !signatureIds.includes(a.id))
        .map((a) => abilityLink(a.id))
        .filter(Boolean);
      add(
        specs.get(id + '/' + spec.id)!,
        section(
          'Overview',
          spec.description +
            ' ' +
            classLink +
            ' characters can choose this specialization from level ' +
            SPEC_UNLOCK_LEVEL +
            '. Its job in a group is ' +
            (spec.role === 'dps'
              ? 'dealing damage'
              : spec.role === 'tank'
                ? 'tanking'
                : 'healing') +
            '.',
        ) +
          section('Signature abilities', bullets(signatureIds.map(abilityLink))) +
          section(spec.mastery.name, spec.mastery.description) +
          (baseline ? section('Specialization bonuses', baseline) : '') +
          (kit.length ? section('Specialization abilities', bullets(kit)) : '') +
          section('Class talent choices', table(choices)),
        ['Specializations', CLASSES[id].name],
      );
    }
    for (const row of rows)
      for (const option of row.options) {
        const related = affectedAbilities(option.effect).map(abilityLink).filter(Boolean);
        const alternatives = row.options.filter((o) => o !== option).map(choiceLink);
        add(
          talents.get(id + '/' + option.id)!,
          section('Effect', option.description) +
            section(
              'Unlock',
              classLink +
                ' characters can choose this talent at level ' +
                row.level +
                '. You can pick only one talent from each row, so taking this one means you do not get the other choices below.',
            ) +
            (related.length ? section('Affected abilities', bullets(related)) : '') +
            section('Other choices at level ' + row.level, bullets(alternatives)),
          ['Talent choices', CLASSES[id].name],
        );
      }
  }
  add('Specializations', section('Choose a specialization', table(specIndex)), [
    'Character progression',
  ]);
  add('Talent choices', section('Talents by class and level', table(talentIndex)), [
    'Character progression',
  ]);
}
