// Curated, guide-only presentation tags for the class chooser and class-page headers.
// These are qualitative "feel" labels (never balance numbers), grounded in each class's
// real kit and resource. They live here, not in content.generated.ts, because they are
// authored presentation judgments, not sim-derived facts. Labels render through the
// guide.tag.* i18n keys; the chooser filters on these axes plus the generated role and
// resource data.

export type ClassStyle = 'melee' | 'ranged' | 'both';
export type ClassPlay = 'solo' | 'group' | 'flexible';
export type ClassComplexity = 'low' | 'med' | 'high';

export interface ClassMeta {
  /** Where the class wants to stand in a fight. */
  style: ClassStyle;
  /** How it tends to play: happy alone, built for a group, or comfortable either way. */
  play: ClassPlay;
  /** How much the kit asks of a new player. */
  complexity: ClassComplexity;
  /** A forgiving, easy-to-learn starting choice. */
  goodFirst: boolean;
}

export const CLASS_META: Record<string, ClassMeta> = {
  warrior: { style: 'melee', play: 'flexible', complexity: 'med', goodFirst: true },
  paladin: { style: 'melee', play: 'flexible', complexity: 'low', goodFirst: true },
  hunter: { style: 'ranged', play: 'solo', complexity: 'low', goodFirst: true },
  rogue: { style: 'melee', play: 'solo', complexity: 'high', goodFirst: false },
  priest: { style: 'ranged', play: 'group', complexity: 'med', goodFirst: false },
  shaman: { style: 'both', play: 'flexible', complexity: 'med', goodFirst: false },
  mage: { style: 'ranged', play: 'solo', complexity: 'med', goodFirst: false },
  warlock: { style: 'ranged', play: 'solo', complexity: 'high', goodFirst: false },
  druid: { style: 'both', play: 'flexible', complexity: 'high', goodFirst: false },
};
