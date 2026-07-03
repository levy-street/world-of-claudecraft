// Gathering profession content (data-as-code, exempt from module-first size
// rules per root CLAUDE.md: this is a declarative table, not logic). Starter
// set is Mining, Logging, Herbalism; the state and gain logic live in
// ../professions/gathering.ts behind the SimContext seam. `icon` is a plain
// identifier (no emoji glyph, per the repo copy rule); a future UI surface
// resolves it to a procedural icon the same way ability/item icons do.
//
// Each def extends the settled `ProfessionRecord` shape (src/sim/professions/
// types.ts, from #1164) with the display metadata (name/icon/description)
// the `/dev gather` chat cheat and a future UI need; category/maxSkill are
// the fields later profession issues (#1120/#1125/#1126/#1140) read against.
// maxSkill follows the classic 1-300 profession skill scale.
import type { ProfessionRecord } from '../professions/types';

export type GatheringProfessionId = 'mining' | 'logging' | 'herbalism';

export interface GatheringProfessionDef extends ProfessionRecord {
  id: GatheringProfessionId;
  name: string;
  icon: string;
  description: string;
}

export const GATHERING_PROFESSIONS: Record<GatheringProfessionId, GatheringProfessionDef> = {
  mining: {
    id: 'mining',
    category: 'gathering',
    maxSkill: 300,
    name: 'Mining',
    icon: 'mining',
    description: 'Extracting ore and stone from nodes found in the wild.',
  },
  logging: {
    id: 'logging',
    category: 'gathering',
    maxSkill: 300,
    name: 'Logging',
    icon: 'logging',
    description: 'Felling timber from trees found across the zones.',
  },
  herbalism: {
    id: 'herbalism',
    category: 'gathering',
    maxSkill: 300,
    name: 'Herbalism',
    icon: 'herbalism',
    description: 'Collecting herbs and plants growing in the wild.',
  },
};

// Stable iteration order, used for defaulting/normalizing a per-player
// proficiency record. Keep in sync with GATHERING_PROFESSIONS above.
export const GATHERING_PROFESSION_IDS: GatheringProfessionId[] = ['mining', 'logging', 'herbalism'];
