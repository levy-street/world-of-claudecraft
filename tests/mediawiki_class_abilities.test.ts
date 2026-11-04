import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { abilityIndexGroup } from '../scripts/mediawiki/ability_access';
import { wikiAbilityArtPath } from '../scripts/mediawiki/ability_art_path';
import { classAbilitySections } from '../scripts/mediawiki/class_ability_sections';
import type { AbilityPageTools } from '../scripts/mediawiki/talent_articles';
import { ROW_TREES, specSignatureIds, TALENTS } from '../src/sim/content/talents';
import { ABILITIES, CLASSES } from '../src/sim/data';
import type { PlayerClass } from '../src/sim/types';
import { abilityImageUrl, hasExplicitAbilityIcon } from '../src/ui/icons';

const titles = new Map(Object.keys(ABILITIES).map((id) => [id, 'Ability/' + id]));
const writer: AbilityPageTools = {
  titleBy: { ability: titles, class: new Map(), quest: new Map() },
  section: (name, text) => '== ' + name + ' ==\n' + text + '\n',
  bullets: (lines) => lines.map((line) => '* ' + line).join('\n'),
  link: (title, label) => '[[' + title + '|' + label + ']]',
  table: () => {
    throw Error('Unexpected table');
  },
};
describe('illustrated class spellbooks', () => {
  it('pairs every visible action with its exact art and destination on each eligible class page', () => {
    for (const cls of Object.keys(CLASSES) as PlayerClass[]) {
      const body = classAbilitySections(cls, writer);
      const rows = [
        ...body.matchAll(
          /^\* <woc-art path="([^"]+)" size="icon" \/> \[\[Ability\/([^|]+)\|[^\]]+\]\]/gm,
        ),
      ];
      const ids = rows.map((row) => row[2]);
      const expected = Object.values(ABILITIES)
        .filter(
          (a) =>
            !a.hiddenFromPlayer &&
            [CLASSES[cls].name, 'All classes'].includes(abilityIndexGroup(a)),
        )
        .map((a) => a.id);
      expect([...new Set(ids)].sort()).toEqual(expected.sort());
      expect(body.split('\n').filter((s) => s.startsWith('* '))).toHaveLength(rows.length);
      for (const [, path, id] of rows) {
        expect(path, id).toBe(wikiAbilityArtPath(id));
        expect(existsSync('public' + path), path).toBe(true);
      }
      expect(body).not.toContain('Clockwork Shock Bomb');
    }
  });
  it('lists each specialization action once under every eligible specialization, in game order', () => {
    for (const cls of Object.keys(CLASSES) as PlayerClass[]) {
      const body = classAbilitySections(cls, writer);
      const section = body.split('== Specialization abilities ==\n')[1].split(/^== [^=]/m)[0];
      const subsections = new Map(
        section
          .split(/^=== /m)
          .slice(1)
          .map((block) => {
            const [name, rows] = block.split(' ===\n');
            return [name, rows] as const;
          }),
      );
      const talentGrants = new Set(
        ROW_TREES[cls].flatMap((row) => row.options.map((o) => o.effect.grant?.ability)),
      );
      const seen = new Set<string>();
      const headings: string[] = [];
      for (const spec of TALENTS[cls].specs) {
        const expected = Object.values(ABILITIES)
          .filter(
            (a) =>
              abilityIndexGroup(a) === CLASSES[cls].name &&
              !a.hiddenFromPlayer &&
              !a.requiresQuest &&
              !talentGrants.has(a.id) &&
              (a.specs?.includes(spec.id) || specSignatureIds(spec).includes(a.id)),
          )
          .map((a) => a.id);
        if (!expected.length) continue;
        headings.push(spec.name);
        const text = subsections.get(spec.name) ?? '';
        expect(
          [...text.matchAll(/\[\[Ability\/([^|]+)\|/g)].map((m) => m[1]).sort(),
          spec.name,
        ).toEqual(expected.sort());
        for (const id of expected) seen.add(id);
      }
      expect([...subsections.keys()]).toEqual(headings);
      const otherSections = body.replace(section, '');
      const otherIds = [...otherSections.matchAll(/\[\[Ability\/([^|]+)\|/g)].map((m) => m[1]);
      expect(otherIds.length).toBe(new Set(otherIds).size);
      expect(otherIds.some((id) => seen.has(id))).toBe(false);
    }
  });
  it('uses the painted asset when present and packages Scratch’s explicit in-game canvas recipe', () => {
    expect(wikiAbilityArtPath('fireball')).toBe(abilityImageUrl('fireball'));
    expect(hasExplicitAbilityIcon('scratch')).toBe(true);
    expect(wikiAbilityArtPath('scratch')).toBe(
      abilityImageUrl('scratch') ?? '/ui/encyclopedia/abilities/scratch.webp',
    );
    expect(
      readFileSync('public' + wikiAbilityArtPath('scratch'))
        .subarray(8, 12)
        .toString(),
    ).toBe('WEBP');
  });
});
