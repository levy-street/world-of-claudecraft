// Which Riftbound band a first clear mints: the shell whose primary stat the
// winner's SPEC actually scales with. A class-only pick handed hybrids one ring
// for every spec (every druid got the Agility band, though no druid spec
// converts Agility into damage; every shaman got the Strength band, though
// Elemental and Restoration live on Intellect), so the choice reads the spec.
//
// Pure leaf: no SimContext, no rng. The table is explicit per spec rather than
// derived from the spec's role, because role does not say the stat (Arcane is
// a healer role on Intellect, every hunter spec is Agility, Feral tanks on
// Strength). A character with no spec yet, or a spec id this table does not
// know, gets its class fallback: the shell most of the class's specs use.

import type { PlayerClass } from '../types';

export type RiftBandShellId =
  | 'riftbound_band_of_might'
  | 'riftbound_band_of_insight'
  | 'riftbound_band_of_guile';

const MIGHT: RiftBandShellId = 'riftbound_band_of_might';
const INSIGHT: RiftBandShellId = 'riftbound_band_of_insight';
const GUILE: RiftBandShellId = 'riftbound_band_of_guile';

interface ClassBandChoice {
  /** The spec-less (or unknown-spec) shell: the majority of the class's specs. */
  fallback: RiftBandShellId;
  /** Spec id to shell. Every live spec of the class is listed. */
  specs: Readonly<Record<string, RiftBandShellId>>;
}

export const RIFT_BAND_SHELL_BY_SPEC: Readonly<Record<PlayerClass, ClassBandChoice>> = {
  warrior: { fallback: MIGHT, specs: { arms: MIGHT, fury: MIGHT, prot: MIGHT } },
  paladin: {
    fallback: MIGHT,
    specs: { holy: INSIGHT, protection: MIGHT, retribution: MIGHT },
  },
  hunter: {
    fallback: GUILE,
    specs: { beast_mastery: GUILE, marksmanship: GUILE, survival: GUILE },
  },
  rogue: {
    fallback: GUILE,
    specs: { assassination: GUILE, combat: GUILE, subtlety: GUILE },
  },
  priest: {
    fallback: INSIGHT,
    specs: { discipline: INSIGHT, holy: INSIGHT, shadow: INSIGHT },
  },
  shaman: {
    fallback: INSIGHT,
    specs: { elemental: INSIGHT, enhancement: MIGHT, restoration: INSIGHT },
  },
  mage: { fallback: INSIGHT, specs: { arcane: INSIGHT, fire: INSIGHT, frost: INSIGHT } },
  warlock: {
    fallback: INSIGHT,
    specs: { affliction: INSIGHT, demonology: INSIGHT, destruction: INSIGHT },
  },
  druid: {
    fallback: INSIGHT,
    specs: { balance: INSIGHT, feral: MIGHT, restoration: INSIGHT },
  },
};

/** The band a `cls` player in `spec` earns from a Rift first clear. */
export function riftBandShellFor(cls: PlayerClass, spec?: string | null): RiftBandShellId {
  const choice = RIFT_BAND_SHELL_BY_SPEC[cls];
  if (spec && Object.hasOwn(choice.specs, spec)) return choice.specs[spec];
  return choice.fallback;
}
