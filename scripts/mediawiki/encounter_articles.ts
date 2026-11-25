import {
  dungeonJournalSource,
  type JournalBossView,
  type JournalValues,
  RAID_JOURNAL_SOURCE,
} from '../../src/ui/boss_journal/journal_view';
import { DUNGEON_JOURNALS } from '../../src/ui/boss_journal/registry';
import { type TranslationKey, t } from '../../src/ui/i18n';
import { type ArticleTools, pct } from './entity_format';

function prose(
  key: TranslationKey,
  values?: JournalValues,
  percents: readonly string[] = [],
): string {
  return t(
    key,
    Object.fromEntries(
      Object.entries(values ?? {}).map(([k, v]) => [k, percents.includes(k) ? pct(v) : v]),
    ),
  );
}
/** Ends a name or clause with one stop: "Heel!" and "How many?" keep their own. */
export function sentence(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text.trim() : text.trim() + '.';
}

export function journalArticles(w: ArticleTools): Map<string, string> {
  const result = new Map<string, string>();
  for (const source of [...DUNGEON_JOURNALS.map(dungeonJournalSource), RAID_JOURNAL_SOURCE]) {
    for (const key of source.bossKeys) {
      for (const tier of ['normal', 'heroic'] as const) {
        const view: JournalBossView = source.view(key, tier);
        const blocks = [prose(view.overviewKey, view.overviewValues, view.overviewPercentValues)];
        for (const phase of view.phases) {
          blocks.push(
            '=== ' + t(phase.nameKey) + ' ===',
            prose(phase.summaryKey, phase.values, phase.percentValues),
          );
          blocks.push(
            w.bullets(
              phase.mechanics.map((m) =>
                [
                  sentence(prose(m.nameKey, m.values, m.percentValues)),
                  prose(m.summaryKey, m.values, m.percentValues),
                  prose(m.responseKey, m.values, m.percentValues),
                  ...(m.flags.length ? ['(' + m.flags.join(', ') + ')'] : []),
                ].join(' '),
              ),
            ),
          );
        }
        if (view.tips?.length)
          blocks.push(
            '=== Tips by role ===',
            w.bullets(
              view.tips.map(
                (tip) => tip.role + ': ' + prose(tip.key, tip.values, tip.percentValues),
              ),
            ),
          );
        if (view.choices?.length)
          blocks.push(
            '=== Your choice ===',
            w.bullets(
              view.choices.map((c) =>
                [
                  sentence(t(c.nameKey)),
                  sentence(prose(c.gainKey, c.values, c.percentValues)),
                  sentence(prose(c.riskKey, c.values, c.percentValues)),
                ].join(' '),
              ),
            ),
          );
        if (tier === 'heroic' && view.heroicNotes?.length)
          blocks.push(
            '=== Heroic changes ===',
            w.bullets(view.heroicNotes.map((n) => prose(n.key, n.values, n.percentValues))),
          );
        result.set(
          view.mobId,
          (result.get(view.mobId) ?? '') +
            w.section(
              tier === 'normal' ? 'Normal encounter' : 'Heroic encounter',
              blocks.join('\n\n'),
            ),
        );
      }
    }
  }
  return result;
}
