// The Ignivar raid consolidation's display-label extraction, TRIMMED at the
// eighth v0.41.0 sync (2026-08-30) to the two members the merged tree still
// consumes (src/ui/hud.ts): combatAbilityName and parseSimMoney. The other
// eighteen exports were the double-extraction class a long-lived-branch merge
// meets (the same resolver family extracted by BOTH sides into different
// modules): the branch's homes, src/ui/entity_display_core.ts,
// src/ui/entity_display_name.ts (which carries the feast-title arm) and
// src/ui/ability_tooltip_lines.ts (which carries the spellHaste mirror
// guard), won every consumer at the merge resolution, so the duplicate
// definitions here were dead and two had already drifted stale against the
// live copies. Member deduplicated, file trimmed, one body per helper; the
// trim is recorded in docs/prd/masterwrought/merge-deletion-list.md.
import { abilityDisplayNameFromSource } from './ability_display_name';
import { t } from './i18n';

export function combatAbilityName(name: string | null): string {
  return name ? abilityDisplayNameFromSource(name) : t('hud.combat.attack');
}

export function parseSimMoney(text: string): number | null {
  let copper = 0;
  let matched = false;
  for (const match of text.matchAll(/(\d+)\s*([gsc])/gi)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 'g') copper += amount * 10000;
    else if (unit === 's') copper += amount * 100;
    else copper += amount;
  }
  return matched ? copper : null;
}
