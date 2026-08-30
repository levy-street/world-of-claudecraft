// Crucible of the Last Spring: the raid professions tier (data-as-code,
// docs/prd/ignivar-raid-professions.md). TODAY this module carries ONLY the
// core reagent: the maintainer's staging call is that reagents start
// dropping ahead of the professions fast-follow (PR 3704), so players bank
// cores while the recipe scrolls, the crafted best-in-slot epics, and the
// legendary hammer land with that PR. The rest of the tier extends THIS
// file when it merges; the definition below is byte-identical to that
// branch's authoring so the merge composes.

import type { ItemDef } from '../types';

export const CRUCIBLE_PROFESSION_ITEMS: Record<string, ItemDef> = {
  // The core reagent (the classic molten-core shape): guaranteed off both
  // bosses, consumed 3/6/15 by the tier's formula, epics, and hammer when
  // the professions PR lands. Ordinary tradeable material; kind 'junk' is
  // the material convention (the junk sweep vendors POOR only, and the
  // tooltip kind line reads Material). Priced so the recipe economy
  // invariant holds with room (inputs always out-value the vendor line of
  // every output).
  lastflame_core: {
    id: 'lastflame_core',
    name: 'Core of the Last Flame',
    kind: 'junk',
    quality: 'epic',
    sellValue: 5000,
  },
};
