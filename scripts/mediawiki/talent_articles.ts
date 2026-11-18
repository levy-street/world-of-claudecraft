import {
  ROW_TREES,
  SPEC_UNLOCK_LEVEL,
  specSignatureIds,
  TALENTS,
  type TalentEffect,
} from '../../src/sim/content/talents';
import { ABILITIES, CLASSES } from '../../src/sim/data';
import type { PlayerClass } from '../../src/sim/types';
import { specIconUrl } from '../../src/ui/spec_icon_art';
import { specBaselineDescription } from '../../src/ui/talent_i18n';
import { renameSpecTags } from './ability_description';
import { talentArtPath } from './article_art';
import { specAbilityLines } from './class_ability_sections';

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
  unique: (title: string, used: Set<string>, hint?: string) => string;
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

const ROLE_NAMES = { dps: 'Damage', tank: 'Tank', healer: 'Healer' } as const;

/** The first sentence of a talent's effect, short enough for a grid cell. */
export function talentSummary(description: string): string {
  const flat = description.replace(/\s+/g, ' ').trim();
  const first = flat.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? flat;
  return first.length > 150 ? first.slice(0, 147).replace(/\s+\S*$/, '') + '...' : first;
}

/** A class's talent rows as a grid: one row per unlock level, its choices side by side,
 *  each with the game's icon, a link to the talent and the first line of its effect. */
export function talentGrid(cls: PlayerClass, { titleBy, link }: AbilityPageTools): string {
  const rows = ROW_TREES[cls];
  const width = Math.max(...rows.map((row) => row.options.length));
  const grid = [
    ['Level', ...Array.from({ length: width }, (_, i) => 'Choice ' + (i + 1))],
    ...rows.map((row) => [
      'Level ' + row.level,
      ...row.options.map((option) => {
        const icon = talentArtPath(option);
        const page = titleBy.talent?.get(cls + '/' + option.id);
        // The summary rides in italics so the reader can set it under the name.
        return (
          (icon ? '<woc-art path="' + icon + '" size="icon" /> ' : '') +
          (page ? link(page, option.name) : option.name) +
          " ''" +
          talentSummary(renameSpecTags(option.description, cls)) +
          "''"
        );
      }),
    ]),
  ];
  const [head, ...body] = grid;
  return [
    '{| class="wikitable talent-grid"',
    '|-',
    '! ' + head.join(' !! '),
    ...body.flatMap((cells) => ['|-', '| ' + cells.join(' || ')]),
    '|}',
  ].join('\n');
}

/** Every specialization of a class, written into the class page: its role, what it does,
 *  its mastery, the abilities it grants on the pick, and the rest of its kit. */
export function classSpecSections(cls: PlayerClass, tools: AbilityPageTools): string {
  const { titleBy, link, section, bullets } = tools;
  const abilityLink = (id: string) =>
    titleBy.ability.has(id) ? link(titleBy.ability.get(id)!, ABILITIES[id].name) : '';
  const blocks = TALENTS[cls].specs.map((spec) => {
    const icon = specIconUrl(spec);
    const page = titleBy.spec?.get(cls + '/' + spec.id);
    const signature = specSignatureIds(spec).map(abilityLink).filter(Boolean);
    const kit = specAbilityLines(cls, spec.id, tools);
    return [
      '=== ' + spec.name + ' ===',
      (icon ? '<woc-art path="' + icon + '" size="icon" /> ' : '') +
        "'''" +
        ROLE_NAMES[spec.role as keyof typeof ROLE_NAMES] +
        "''' · " +
        spec.description,
      "'''Mastery: " + spec.mastery.name + ".''' " + spec.mastery.description,
      signature.length ? "'''Granted on the pick:''' " + signature.join(' · ') : '',
      kit.length ? bullets(kit) : '',
      page ? link(page, 'Full ' + spec.name + ' page') : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  });
  return section(
    'Specializations',
    'At level ' +
      SPEC_UNLOCK_LEVEL +
      ' you choose one of three specializations. It sets your role in a group and adds its own abilities.\n\n' +
      blocks.join('\n\n'),
  );
}

export function addTalentPages(tools: TalentPageTools): void {
  const { titleBy, link, section, bullets, table, add, usedTitles, unique } = tools;
  const specs = new Map<string, string>(),
    talents = new Map<string, string>();
  titleBy.spec = specs;
  titleBy.talent = talents;
  const specIndex: string[][] = [];
  const abilityLink = (id: string) =>
    titleBy.ability.has(id) ? link(titleBy.ability.get(id)!, ABILITIES[id].name) : '';
  for (const cls of Object.values(TALENTS)) {
    const id = cls.class;
    const classLink = link(titleBy.class.get(id)!, CLASSES[id].name);
    const rows = ROW_TREES[id];
    for (const spec of cls.specs)
      specs.set(
        id + '/' + spec.id,
        unique(spec.name + ' (Specialization)', usedTitles, CLASSES[id].name),
      );
    for (const row of rows)
      for (const option of row.options)
        talents.set(
          id + '/' + option.id,
          unique(option.name + ' (Talent)', usedTitles, CLASSES[id].name),
        );
    const specLinks = cls.specs.map((s) => link(specs.get(id + '/' + s.id)!, s.name));
    const choiceLink = (choice: { id: string; name: string }) =>
      link(talents.get(id + '/' + choice.id)!, choice.name);
    specIndex.push([classLink, specLinks.join(' · ')]);
    const choices = rows.map((row) => [
      'Level ' + row.level,
      row.options.map(choiceLink).join(' · '),
    ]);
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
          'At a glance',
          table([
            ['Class', classLink],
            ['Role', spec.role === 'dps' ? 'Damage' : spec.role === 'tank' ? 'Tank' : 'Healer'],
            ['Unlocks at', 'Level ' + SPEC_UNLOCK_LEVEL],
            ['Mastery', spec.mastery.name],
          ]),
        ) +
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
          section('Effect', renameSpecTags(option.description, id)) +
            section(
              'At a glance',
              table([
                ['Class', classLink],
                ['Unlocks at', 'Level ' + row.level],
                ['Choice', 'Pick 1 of ' + row.options.length + ' in this row'],
                ...(option.effect.grant?.ability && abilityLink(option.effect.grant.ability)
                  ? [['Gives you', abilityLink(option.effect.grant.ability)]]
                  : []),
              ]),
            ) +
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
  add(
    'Talent choices',
    section(
      'How talents work',
      'Each class unlocks a row of talent choices at levels ' +
        ROW_TREES.warrior.map((row) => row.level).join(', ') +
        '. In each row you pick one talent. The rows are the same for every specialization of the class.',
    ) +
      Object.values(TALENTS)
        .map((cls) =>
          section(
            CLASSES[cls.class].name,
            link(titleBy.class.get(cls.class)!, 'Open the ' + CLASSES[cls.class].name + ' page') +
              '\n\n' +
              talentGrid(cls.class, tools),
          ),
        )
        .join(''),
    ['Character progression'],
  );
}
