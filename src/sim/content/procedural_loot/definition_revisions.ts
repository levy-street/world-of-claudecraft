// Historical validation snapshots for persisted procedural items.
//
// Do not edit an existing revision. When generation definitions change, append
// a new snapshot, bump PROCEDURAL_LOOT_CONTENT_REVISION, and keep the old rows.
// Revisions 1 and 2 were reconstructed from commits 23bead0b and 3ad946b5.
import type {
  ItemTag,
  ProceduralAffixPosition,
  ProceduralItemDefinitionRevision,
  ProceduralRarity,
} from '../../procedural_item';
import type { AffixTier, NumericRoll } from './types';

type ActiveRarity = Exclude<ProceduralRarity, 'mythic'>;

export interface ProceduralItemDefinitionSnapshot {
  readonly revision: ProceduralItemDefinitionRevision;
  /**
   * Revisions 1 and 2 predate the canonical total-budget tolerance check.
   * Their affixes, rolls, ranges, quantization, and per-affix budgets remain strict.
   */
  readonly validationMode: 'legacy-budget-v1' | 'strict-v1';
  readonly bases: Readonly<
    Record<string, { readonly tags: readonly ItemTag[]; readonly slotMultiplier: number }>
  >;
  readonly affixes: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly family: string;
        readonly position: ProceduralAffixPosition;
        readonly nameFragmentId?: string;
        readonly tags: readonly ItemTag[];
        readonly excludedTags?: readonly ItemTag[];
        readonly minItemLevel: number;
        readonly maxItemLevel?: number;
        readonly tiers: readonly AffixTier[];
        readonly exclusiveGroups?: readonly string[];
      }
    >
  >;
  readonly rarities: Readonly<
    Record<
      ActiveRarity,
      {
        readonly id: ActiveRarity;
        readonly affixCounts: readonly {
          readonly count: number;
          readonly weight: number;
        }[];
        readonly budgetMultiplier: number;
        readonly rollFloor: number;
      }
    >
  >;
  readonly statBudgetCost: Readonly<Record<string, number>>;
  readonly rareFirstWordIds: readonly string[];
  readonly rareSecondWordIds: readonly string[];
  readonly powers: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly revision: number;
        readonly compatibleBaseIds: readonly string[];
        readonly rolls: Readonly<Record<string, NumericRoll>>;
      }
    >
  >;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const REVISION_1 = deepFreeze({
  revision: 1,
  validationMode: 'legacy-budget-v1',
  bases: {
    iron_broadsword: {
      tags: ['weapon', 'melee', 'onehand'],
      slotMultiplier: 1.15,
    },
    ashwood_staff: {
      tags: ['weapon', 'caster', 'twohand'],
      slotMultiplier: 1.75,
    },
    mirefen_leather_gloves: {
      tags: ['armor', 'leather', 'light_slot', 'melee', 'ranged'],
      slotMultiplier: 0.65,
    },
    thornpeak_mail_chest: {
      tags: ['armor', 'mail', 'heavy_slot', 'melee', 'ranged'],
      slotMultiplier: 1,
    },
    gravecaller_cloth_hood: {
      tags: ['armor', 'cloth', 'heavy_slot', 'caster'],
      slotMultiplier: 0.85,
    },
    gravecaller_ring: {
      tags: ['armor', 'jewelry', 'caster', 'melee', 'ranged', 'light_slot'],
      slotMultiplier: 0.55,
    },
  },
  affixes: {
    mighty: {
      id: 'mighty',
      family: 'primary.strength',
      position: 'prefix',
      nameFragmentId: 'procedural.name.mighty',
      tags: ['melee'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            str: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 1,
          rolls: {
            str: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            str: {
              min: 4,
              max: 6,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            str: {
              min: 6,
              max: 9,
            },
          },
        },
      ],
    },
    deft: {
      id: 'deft',
      family: 'primary.agility',
      position: 'prefix',
      nameFragmentId: 'procedural.name.deft',
      tags: ['melee', 'ranged'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 4,
              max: 6,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 6,
              max: 9,
            },
          },
        },
      ],
    },
    stalwart: {
      id: 'stalwart',
      family: 'primary.stamina',
      position: 'prefix',
      nameFragmentId: 'procedural.name.stalwart',
      tags: ['armor', 'weapon', 'jewelry'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 4,
              max: 7,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 7,
              max: 10,
            },
          },
        },
      ],
    },
    sages: {
      id: 'sages',
      family: 'primary.intellect',
      position: 'prefix',
      nameFragmentId: 'procedural.name.sages',
      tags: ['caster'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            int: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 1,
          rolls: {
            int: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            int: {
              min: 4,
              max: 6,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            int: {
              min: 6,
              max: 9,
            },
          },
        },
      ],
    },
    spiritual: {
      id: 'spiritual',
      family: 'primary.spirit',
      position: 'prefix',
      nameFragmentId: 'procedural.name.spiritual',
      tags: ['caster'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 4,
              max: 7,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 7,
              max: 10,
            },
          },
        },
      ],
    },
    focused: {
      id: 'focused',
      family: 'offense.spell_power',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_focus',
      tags: ['caster'],
      minItemLevel: 4,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 1,
              max: 3,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 3,
              max: 6,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 6,
              max: 10,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 10,
              max: 15,
            },
          },
        },
      ],
    },
    striking: {
      id: 'striking',
      family: 'rating.crit',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_striking',
      tags: ['armor', 'weapon', 'jewelry'],
      minItemLevel: 4,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 4,
              max: 8,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 8,
              max: 14,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 14,
              max: 20,
            },
          },
        },
      ],
    },
    alacrity: {
      id: 'alacrity',
      family: 'rating.haste',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_alacrity',
      tags: ['armor', 'weapon', 'jewelry'],
      minItemLevel: 6,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 4,
              max: 8,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 8,
              max: 13,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 13,
              max: 19,
            },
          },
        },
      ],
    },
    precision: {
      id: 'precision',
      family: 'rating.hit',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_precision',
      tags: ['armor', 'weapon', 'jewelry'],
      minItemLevel: 10,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 1,
              max: 3,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 3,
              max: 6,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 6,
              max: 11,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 11,
              max: 16,
            },
          },
        },
      ],
    },
    warded: {
      id: 'warded',
      family: 'defense.armor',
      position: 'prefix',
      nameFragmentId: 'procedural.name.warded',
      tags: ['armor'],
      excludedTags: ['jewelry'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 4,
              max: 8,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 8,
              max: 16,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 16,
              max: 28,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 28,
              max: 42,
            },
          },
        },
      ],
    },
    reaping: {
      id: 'reaping',
      family: 'resource.health_on_kill',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_reaping',
      tags: ['melee', 'ranged'],
      minItemLevel: 8,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 4,
              max: 7,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 7,
              max: 10,
            },
          },
        },
      ],
    },
    remembrance: {
      id: 'remembrance',
      family: 'resource.mana_on_kill',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_remembrance',
      tags: ['caster'],
      minItemLevel: 8,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 4,
              max: 7,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 7,
              max: 10,
            },
          },
        },
      ],
    },
  },
  rarities: {
    common: {
      id: 'common',
      affixCounts: [
        {
          count: 0,
          weight: 1,
        },
      ],
      budgetMultiplier: 0,
      rollFloor: 0,
    },
    magic: {
      id: 'magic',
      affixCounts: [
        {
          count: 1,
          weight: 0.55,
        },
        {
          count: 2,
          weight: 0.45,
        },
      ],
      budgetMultiplier: 0.7,
      rollFloor: 0,
    },
    rare: {
      id: 'rare',
      affixCounts: [
        {
          count: 3,
          weight: 0.65,
        },
        {
          count: 4,
          weight: 0.35,
        },
      ],
      budgetMultiplier: 1,
      rollFloor: 0.15,
    },
    epic: {
      id: 'epic',
      affixCounts: [
        {
          count: 4,
          weight: 0.55,
        },
        {
          count: 5,
          weight: 0.45,
        },
      ],
      budgetMultiplier: 1.25,
      rollFloor: 0.35,
    },
    legendary: {
      id: 'legendary',
      affixCounts: [
        {
          count: 3,
          weight: 0.65,
        },
        {
          count: 4,
          weight: 0.35,
        },
      ],
      budgetMultiplier: 1.2,
      rollFloor: 0.5,
    },
  },
  statBudgetCost: {
    str: 1,
    agi: 1,
    sta: 1,
    int: 1,
    spi: 0.85,
    spellPower: 0.65,
    critRating: 0.25,
    hasteRating: 0.28,
    hitRating: 0.32,
    armor: 0.08,
    healthOnKill: 0.5,
    manaOnKill: 0.5,
  },
  rareFirstWordIds: [
    'procedural.rare.ashen',
    'procedural.rare.blackfen',
    'procedural.rare.doom',
    'procedural.rare.grave',
    'procedural.rare.mire',
    'procedural.rare.storm',
    'procedural.rare.thorn',
    'procedural.rare.wyrm',
  ],
  rareSecondWordIds: [
    'procedural.rare.bite',
    'procedural.rare.brand',
    'procedural.rare.promise',
    'procedural.rare.thread',
    'procedural.rare.vigil',
    'procedural.rare.ward',
    'procedural.rare.whisper',
    'procedural.rare.oath',
  ],
  powers: {
    crown_last_pyre: {
      id: 'crown_last_pyre',
      revision: 1,
      compatibleBaseIds: ['ashwood_staff', 'gravecaller_cloth_hood', 'gravecaller_ring'],
      rolls: {
        potencyPct: {
          min: 29,
          max: 34,
          step: 1,
        },
      },
    },
    greyjaws_edge: {
      id: 'greyjaws_edge',
      revision: 1,
      compatibleBaseIds: ['iron_broadsword', 'thornpeak_mail_chest', 'gravecaller_ring'],
      rolls: {
        potencyPct: {
          min: 38,
          max: 40,
          step: 1,
        },
      },
    },
    hushwood_longbow: {
      id: 'hushwood_longbow',
      revision: 1,
      compatibleBaseIds: ['mirefen_leather_gloves', 'thornpeak_mail_chest', 'gravecaller_ring'],
      rolls: {
        durationMs: {
          min: 800,
          max: 1200,
          step: 100,
        },
      },
    },
    nightglass_fang: {
      id: 'nightglass_fang',
      revision: 1,
      compatibleBaseIds: ['iron_broadsword', 'mirefen_leather_gloves', 'gravecaller_ring'],
      rolls: {
        potencyPct: {
          min: 10,
          max: 14,
          step: 1,
        },
      },
    },
    ysoleis_vigil: {
      id: 'ysoleis_vigil',
      revision: 1,
      compatibleBaseIds: ['ashwood_staff', 'gravecaller_cloth_hood', 'gravecaller_ring'],
      rolls: {
        potencyPct: {
          min: 14,
          max: 20,
          step: 1,
        },
      },
    },
    stormwake_idol: {
      id: 'stormwake_idol',
      revision: 1,
      compatibleBaseIds: ['ashwood_staff', 'thornpeak_mail_chest', 'gravecaller_ring'],
      rolls: {
        potencyPct: {
          min: 22,
          max: 30,
          step: 1,
        },
      },
    },
    ashbinders_seal: {
      id: 'ashbinders_seal',
      revision: 1,
      compatibleBaseIds: ['ashwood_staff', 'gravecaller_cloth_hood', 'gravecaller_ring'],
      rolls: {
        potencyPct: {
          min: 15,
          max: 20,
          step: 1,
        },
      },
    },
    dawnward_signet: {
      id: 'dawnward_signet',
      revision: 1,
      compatibleBaseIds: ['iron_broadsword', 'thornpeak_mail_chest', 'gravecaller_ring'],
      rolls: {
        potencyPct: {
          min: 16,
          max: 22,
          step: 1,
        },
      },
    },
    feral_moonclasp: {
      id: 'feral_moonclasp',
      revision: 1,
      compatibleBaseIds: ['ashwood_staff', 'mirefen_leather_gloves', 'gravecaller_ring'],
      rolls: {
        resource: {
          min: 4,
          max: 7,
          step: 1,
        },
      },
    },
    bell_of_the_ninth_peal: {
      id: 'bell_of_the_ninth_peal',
      revision: 1,
      compatibleBaseIds: ['ashwood_staff', 'gravecaller_cloth_hood'],
      rolls: {
        potencyPct: {
          min: 25,
          max: 29,
          step: 1,
        },
      },
    },
    mantle_of_borrowed_time: {
      id: 'mantle_of_borrowed_time',
      revision: 1,
      compatibleBaseIds: [
        'iron_broadsword',
        'ashwood_staff',
        'mirefen_leather_gloves',
        'thornpeak_mail_chest',
        'gravecaller_cloth_hood',
        'gravecaller_ring',
      ],
      rolls: {
        potencyPct: {
          min: 14,
          max: 20,
          step: 1,
        },
      },
    },
    boots_of_the_unbroken_road: {
      id: 'boots_of_the_unbroken_road',
      revision: 1,
      compatibleBaseIds: [
        'iron_broadsword',
        'ashwood_staff',
        'mirefen_leather_gloves',
        'thornpeak_mail_chest',
        'gravecaller_cloth_hood',
        'gravecaller_ring',
      ],
      rolls: {
        potencyPct: {
          min: 8,
          max: 12,
          step: 1,
        },
      },
    },
  },
} satisfies ProceduralItemDefinitionSnapshot);

const REVISION_2 = deepFreeze({
  revision: 2,
  validationMode: 'legacy-budget-v1',
  bases: {
    iron_broadsword: {
      tags: ['weapon', 'melee', 'onehand'],
      slotMultiplier: 1,
    },
    ashwood_staff: {
      tags: ['weapon', 'caster', 'twohand'],
      slotMultiplier: 1.3,
    },
    mirefen_leather_gloves: {
      tags: ['armor', 'leather', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.7,
    },
    thornpeak_mail_chest: {
      tags: ['armor', 'mail', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 1,
    },
    gravecaller_cloth_hood: {
      tags: ['armor', 'cloth', 'heavy_slot', 'caster'],
      slotMultiplier: 0.85,
    },
    gravecaller_ring: {
      tags: ['armor', 'jewelry', 'caster', 'melee', 'ranged', 'light_slot'],
      slotMultiplier: 0.6,
    },
    gravecaller_cloth_mantle: {
      tags: ['armor', 'cloth', 'heavy_slot', 'caster'],
      slotMultiplier: 0.75,
    },
    gravecaller_cloth_raiment: {
      tags: ['armor', 'cloth', 'heavy_slot', 'caster'],
      slotMultiplier: 1,
    },
    gravecaller_cloth_sash: {
      tags: ['armor', 'cloth', 'light_slot', 'caster'],
      slotMultiplier: 0.7,
    },
    gravecaller_cloth_leggings: {
      tags: ['armor', 'cloth', 'heavy_slot', 'caster'],
      slotMultiplier: 0.9,
    },
    gravecaller_cloth_handwraps: {
      tags: ['armor', 'cloth', 'light_slot', 'caster'],
      slotMultiplier: 0.7,
    },
    gravecaller_cloth_slippers: {
      tags: ['armor', 'cloth', 'light_slot', 'caster'],
      slotMultiplier: 0.65,
    },
    mirefen_leather_hood: {
      tags: ['armor', 'leather', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.85,
    },
    mirefen_leather_shoulderguards: {
      tags: ['armor', 'leather', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.75,
    },
    mirefen_leather_jerkin: {
      tags: ['armor', 'leather', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 1,
    },
    mirefen_leather_belt: {
      tags: ['armor', 'leather', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.7,
    },
    mirefen_leather_leggings: {
      tags: ['armor', 'leather', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.9,
    },
    mirefen_leather_boots: {
      tags: ['armor', 'leather', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.65,
    },
    thornpeak_mail_helm: {
      tags: ['armor', 'mail', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.85,
    },
    thornpeak_mail_pauldrons: {
      tags: ['armor', 'mail', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.75,
    },
    thornpeak_mail_girdle: {
      tags: ['armor', 'mail', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.7,
    },
    thornpeak_mail_legguards: {
      tags: ['armor', 'mail', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.9,
    },
    thornpeak_mail_gauntlets: {
      tags: ['armor', 'mail', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.7,
    },
    thornpeak_mail_sabatons: {
      tags: ['armor', 'mail', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.65,
    },
    thornpeak_war_axe: {
      tags: ['weapon', 'melee', 'onehand'],
      slotMultiplier: 1,
    },
    iron_flanged_mace: {
      tags: ['weapon', 'melee', 'onehand'],
      slotMultiplier: 1,
    },
    mirefen_dirk: {
      tags: ['weapon', 'melee', 'onehand'],
      slotMultiplier: 1,
    },
    gravecaller_wand: {
      tags: ['weapon', 'caster', 'onehand'],
      slotMultiplier: 1,
    },
    thornpeak_polearm: {
      tags: ['weapon', 'melee', 'twohand'],
      slotMultiplier: 1.3,
    },
    mirefen_hunting_bow: {
      tags: ['weapon', 'ranged', 'twohand'],
      slotMultiplier: 1.3,
    },
    thornpeak_crossbow: {
      tags: ['weapon', 'ranged', 'twohand'],
      slotMultiplier: 1.3,
    },
    gravecaller_pendant: {
      tags: ['armor', 'jewelry', 'caster', 'melee', 'ranged', 'light_slot'],
      slotMultiplier: 0.65,
    },
    thornpeak_bulwark: {
      tags: ['armor', 'shield', 'mail', 'melee', 'caster', 'heavy_slot'],
      slotMultiplier: 0.75,
    },
    gravecaller_focus: {
      tags: ['held_offhand', 'caster', 'light_slot'],
      slotMultiplier: 0.75,
    },
  },
  affixes: {
    mighty: {
      id: 'mighty',
      family: 'primary.strength',
      position: 'prefix',
      nameFragmentId: 'procedural.name.mighty',
      tags: ['melee'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            str: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 1,
          rolls: {
            str: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            str: {
              min: 4,
              max: 6,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            str: {
              min: 6,
              max: 9,
            },
          },
        },
      ],
    },
    deft: {
      id: 'deft',
      family: 'primary.agility',
      position: 'prefix',
      nameFragmentId: 'procedural.name.deft',
      tags: ['melee', 'ranged'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 4,
              max: 6,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 6,
              max: 9,
            },
          },
        },
      ],
    },
    stalwart: {
      id: 'stalwart',
      family: 'primary.stamina',
      position: 'prefix',
      nameFragmentId: 'procedural.name.stalwart',
      tags: ['armor', 'weapon', 'held_offhand', 'jewelry'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 4,
              max: 7,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 7,
              max: 10,
            },
          },
        },
      ],
    },
    sages: {
      id: 'sages',
      family: 'primary.intellect',
      position: 'prefix',
      nameFragmentId: 'procedural.name.sages',
      tags: ['caster'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            int: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 1,
          rolls: {
            int: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            int: {
              min: 4,
              max: 6,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            int: {
              min: 6,
              max: 9,
            },
          },
        },
      ],
    },
    spiritual: {
      id: 'spiritual',
      family: 'primary.spirit',
      position: 'prefix',
      nameFragmentId: 'procedural.name.spiritual',
      tags: ['caster'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 4,
              max: 7,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 7,
              max: 10,
            },
          },
        },
      ],
    },
    focused: {
      id: 'focused',
      family: 'offense.spell_power',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_focus',
      tags: ['caster'],
      minItemLevel: 4,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 1,
              max: 3,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 3,
              max: 6,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 6,
              max: 10,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 10,
              max: 15,
            },
          },
        },
      ],
    },
    striking: {
      id: 'striking',
      family: 'rating.crit',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_striking',
      tags: ['armor', 'weapon', 'held_offhand', 'jewelry'],
      minItemLevel: 4,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 4,
              max: 8,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 8,
              max: 14,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 14,
              max: 20,
            },
          },
        },
      ],
    },
    alacrity: {
      id: 'alacrity',
      family: 'rating.haste',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_alacrity',
      tags: ['armor', 'weapon', 'held_offhand', 'jewelry'],
      minItemLevel: 6,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 4,
              max: 8,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 8,
              max: 13,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 13,
              max: 19,
            },
          },
        },
      ],
    },
    precision: {
      id: 'precision',
      family: 'rating.hit',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_precision',
      tags: ['armor', 'weapon', 'held_offhand', 'jewelry'],
      minItemLevel: 10,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 1,
              max: 3,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 3,
              max: 6,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 6,
              max: 11,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 11,
              max: 16,
            },
          },
        },
      ],
    },
    warded: {
      id: 'warded',
      family: 'defense.armor',
      position: 'prefix',
      nameFragmentId: 'procedural.name.warded',
      tags: ['armor'],
      excludedTags: ['jewelry'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 4,
              max: 8,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 8,
              max: 16,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 16,
              max: 28,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 28,
              max: 42,
            },
          },
        },
      ],
    },
    reaping: {
      id: 'reaping',
      family: 'resource.health_on_kill',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_reaping',
      tags: ['melee', 'ranged'],
      minItemLevel: 8,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 4,
              max: 7,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 7,
              max: 10,
            },
          },
        },
      ],
    },
    remembrance: {
      id: 'remembrance',
      family: 'resource.mana_on_kill',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_remembrance',
      tags: ['caster'],
      minItemLevel: 8,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 6,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 2,
              max: 4,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 12,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 4,
              max: 7,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 18,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 7,
              max: 10,
            },
          },
        },
      ],
    },
  },
  rarities: {
    common: {
      id: 'common',
      affixCounts: [
        {
          count: 0,
          weight: 1,
        },
      ],
      budgetMultiplier: 0,
      rollFloor: 0,
    },
    magic: {
      id: 'magic',
      affixCounts: [
        {
          count: 1,
          weight: 0.55,
        },
        {
          count: 2,
          weight: 0.45,
        },
      ],
      budgetMultiplier: 0.7,
      rollFloor: 0,
    },
    rare: {
      id: 'rare',
      affixCounts: [
        {
          count: 3,
          weight: 0.65,
        },
        {
          count: 4,
          weight: 0.35,
        },
      ],
      budgetMultiplier: 1,
      rollFloor: 0.15,
    },
    epic: {
      id: 'epic',
      affixCounts: [
        {
          count: 4,
          weight: 0.55,
        },
        {
          count: 5,
          weight: 0.45,
        },
      ],
      budgetMultiplier: 1.25,
      rollFloor: 0.35,
    },
    legendary: {
      id: 'legendary',
      affixCounts: [
        {
          count: 3,
          weight: 0.65,
        },
        {
          count: 4,
          weight: 0.35,
        },
      ],
      budgetMultiplier: 1.2,
      rollFloor: 0.5,
    },
  },
  statBudgetCost: {
    str: 1,
    agi: 1,
    sta: 1,
    int: 1,
    spi: 0.85,
    spellPower: 0.65,
    critRating: 0.25,
    hasteRating: 0.28,
    hitRating: 0.32,
    armor: 0.08,
    healthOnKill: 0.5,
    manaOnKill: 0.5,
  },
  rareFirstWordIds: [
    'procedural.rare.ashen',
    'procedural.rare.blackfen',
    'procedural.rare.doom',
    'procedural.rare.grave',
    'procedural.rare.mire',
    'procedural.rare.storm',
    'procedural.rare.thorn',
    'procedural.rare.wyrm',
  ],
  rareSecondWordIds: [
    'procedural.rare.bite',
    'procedural.rare.brand',
    'procedural.rare.promise',
    'procedural.rare.thread',
    'procedural.rare.vigil',
    'procedural.rare.ward',
    'procedural.rare.whisper',
    'procedural.rare.oath',
  ],
  powers: {
    crown_last_pyre: {
      id: 'crown_last_pyre',
      revision: 1,
      compatibleBaseIds: ['gravecaller_cloth_hood'],
      rolls: {
        potencyPct: {
          min: 29,
          max: 34,
          step: 1,
        },
      },
    },
    greyjaws_edge: {
      id: 'greyjaws_edge',
      revision: 1,
      compatibleBaseIds: [
        'iron_broadsword',
        'thornpeak_war_axe',
        'iron_flanged_mace',
        'thornpeak_polearm',
      ],
      rolls: {
        potencyPct: {
          min: 38,
          max: 40,
          step: 1,
        },
      },
    },
    hushwood_longbow: {
      id: 'hushwood_longbow',
      revision: 1,
      compatibleBaseIds: ['mirefen_hunting_bow'],
      rolls: {
        durationMs: {
          min: 800,
          max: 1200,
          step: 100,
        },
      },
    },
    nightglass_fang: {
      id: 'nightglass_fang',
      revision: 1,
      compatibleBaseIds: ['mirefen_dirk'],
      rolls: {
        potencyPct: {
          min: 10,
          max: 14,
          step: 1,
        },
      },
    },
    ysoleis_vigil: {
      id: 'ysoleis_vigil',
      revision: 1,
      compatibleBaseIds: ['ashwood_staff', 'gravecaller_focus'],
      rolls: {
        potencyPct: {
          min: 14,
          max: 20,
          step: 1,
        },
      },
    },
    stormwake_idol: {
      id: 'stormwake_idol',
      revision: 1,
      compatibleBaseIds: ['gravecaller_focus'],
      rolls: {
        potencyPct: {
          min: 22,
          max: 30,
          step: 1,
        },
      },
    },
    ashbinders_seal: {
      id: 'ashbinders_seal',
      revision: 1,
      compatibleBaseIds: ['gravecaller_ring'],
      rolls: {
        potencyPct: {
          min: 15,
          max: 20,
          step: 1,
        },
      },
    },
    dawnward_signet: {
      id: 'dawnward_signet',
      revision: 1,
      compatibleBaseIds: ['gravecaller_ring'],
      rolls: {
        potencyPct: {
          min: 16,
          max: 22,
          step: 1,
        },
      },
    },
    feral_moonclasp: {
      id: 'feral_moonclasp',
      revision: 1,
      compatibleBaseIds: ['gravecaller_pendant'],
      rolls: {
        resource: {
          min: 4,
          max: 7,
          step: 1,
        },
      },
    },
    bell_of_the_ninth_peal: {
      id: 'bell_of_the_ninth_peal',
      revision: 1,
      compatibleBaseIds: ['ashwood_staff', 'gravecaller_focus'],
      rolls: {
        potencyPct: {
          min: 25,
          max: 29,
          step: 1,
        },
      },
    },
    mantle_of_borrowed_time: {
      id: 'mantle_of_borrowed_time',
      revision: 1,
      compatibleBaseIds: [
        'gravecaller_cloth_mantle',
        'mirefen_leather_shoulderguards',
        'thornpeak_mail_pauldrons',
      ],
      rolls: {
        potencyPct: {
          min: 14,
          max: 20,
          step: 1,
        },
      },
    },
    boots_of_the_unbroken_road: {
      id: 'boots_of_the_unbroken_road',
      revision: 1,
      compatibleBaseIds: [
        'gravecaller_cloth_slippers',
        'mirefen_leather_boots',
        'thornpeak_mail_sabatons',
      ],
      rolls: {
        potencyPct: {
          min: 8,
          max: 12,
          step: 1,
        },
      },
    },
  },
} satisfies ProceduralItemDefinitionSnapshot);

const REVISION_3 = deepFreeze({
  revision: 3,
  validationMode: 'strict-v1',
  bases: {
    iron_broadsword: {
      tags: ['weapon', 'melee', 'onehand'],
      slotMultiplier: 1,
    },
    ashwood_staff: {
      tags: ['weapon', 'caster', 'twohand'],
      slotMultiplier: 1.3,
    },
    mirefen_leather_gloves: {
      tags: ['armor', 'leather', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.7,
    },
    thornpeak_mail_chest: {
      tags: ['armor', 'mail', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 1,
    },
    gravecaller_cloth_hood: {
      tags: ['armor', 'cloth', 'heavy_slot', 'caster'],
      slotMultiplier: 0.85,
    },
    gravecaller_ring: {
      tags: ['armor', 'jewelry', 'caster', 'melee', 'ranged', 'light_slot'],
      slotMultiplier: 0.6,
    },
    gravecaller_cloth_mantle: {
      tags: ['armor', 'cloth', 'heavy_slot', 'caster'],
      slotMultiplier: 0.75,
    },
    gravecaller_cloth_raiment: {
      tags: ['armor', 'cloth', 'heavy_slot', 'caster'],
      slotMultiplier: 1,
    },
    gravecaller_cloth_sash: {
      tags: ['armor', 'cloth', 'light_slot', 'caster'],
      slotMultiplier: 0.7,
    },
    gravecaller_cloth_leggings: {
      tags: ['armor', 'cloth', 'heavy_slot', 'caster'],
      slotMultiplier: 0.9,
    },
    gravecaller_cloth_handwraps: {
      tags: ['armor', 'cloth', 'light_slot', 'caster'],
      slotMultiplier: 0.7,
    },
    gravecaller_cloth_slippers: {
      tags: ['armor', 'cloth', 'light_slot', 'caster'],
      slotMultiplier: 0.65,
    },
    mirefen_leather_hood: {
      tags: ['armor', 'leather', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.85,
    },
    mirefen_leather_shoulderguards: {
      tags: ['armor', 'leather', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.75,
    },
    mirefen_leather_jerkin: {
      tags: ['armor', 'leather', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 1,
    },
    mirefen_leather_belt: {
      tags: ['armor', 'leather', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.7,
    },
    mirefen_leather_leggings: {
      tags: ['armor', 'leather', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.9,
    },
    mirefen_leather_boots: {
      tags: ['armor', 'leather', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.65,
    },
    thornpeak_mail_helm: {
      tags: ['armor', 'mail', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.85,
    },
    thornpeak_mail_pauldrons: {
      tags: ['armor', 'mail', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.75,
    },
    thornpeak_mail_girdle: {
      tags: ['armor', 'mail', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.7,
    },
    thornpeak_mail_legguards: {
      tags: ['armor', 'mail', 'heavy_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.9,
    },
    thornpeak_mail_gauntlets: {
      tags: ['armor', 'mail', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.7,
    },
    thornpeak_mail_sabatons: {
      tags: ['armor', 'mail', 'light_slot', 'melee', 'ranged', 'caster'],
      slotMultiplier: 0.65,
    },
    thornpeak_war_axe: {
      tags: ['weapon', 'melee', 'onehand'],
      slotMultiplier: 1,
    },
    iron_flanged_mace: {
      tags: ['weapon', 'melee', 'onehand'],
      slotMultiplier: 1,
    },
    mirefen_dirk: {
      tags: ['weapon', 'melee', 'onehand'],
      slotMultiplier: 1,
    },
    gravecaller_wand: {
      tags: ['weapon', 'caster', 'onehand'],
      slotMultiplier: 1,
    },
    thornpeak_polearm: {
      tags: ['weapon', 'melee', 'twohand'],
      slotMultiplier: 1.3,
    },
    mirefen_hunting_bow: {
      tags: ['weapon', 'ranged', 'twohand'],
      slotMultiplier: 1.3,
    },
    thornpeak_crossbow: {
      tags: ['weapon', 'ranged', 'twohand'],
      slotMultiplier: 1.3,
    },
    gravecaller_pendant: {
      tags: ['armor', 'jewelry', 'caster', 'melee', 'ranged', 'light_slot'],
      slotMultiplier: 0.65,
    },
    thornpeak_bulwark: {
      tags: ['armor', 'shield', 'mail', 'melee', 'caster', 'heavy_slot'],
      slotMultiplier: 0.75,
    },
    gravecaller_focus: {
      tags: ['held_offhand', 'caster', 'light_slot'],
      slotMultiplier: 0.75,
    },
  },
  affixes: {
    mighty: {
      id: 'mighty',
      family: 'primary.strength',
      position: 'prefix',
      nameFragmentId: 'procedural.name.mighty',
      tags: ['melee'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            str: {
              min: 1,
              max: 1,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 1,
          rolls: {
            str: {
              min: 2,
              max: 6,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 1,
          rolls: {
            str: {
              min: 4,
              max: 10,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            str: {
              min: 6,
              max: 16,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            str: {
              min: 6,
              max: 24,
            },
          },
        },
      ],
    },
    deft: {
      id: 'deft',
      family: 'primary.agility',
      position: 'prefix',
      nameFragmentId: 'procedural.name.deft',
      tags: ['melee', 'ranged'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 1,
              max: 1,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 2,
              max: 6,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 4,
              max: 10,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 6,
              max: 16,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            agi: {
              min: 6,
              max: 24,
            },
          },
        },
      ],
    },
    stalwart: {
      id: 'stalwart',
      family: 'primary.stamina',
      position: 'prefix',
      nameFragmentId: 'procedural.name.stalwart',
      tags: ['armor', 'weapon', 'held_offhand', 'jewelry'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 1,
              max: 1,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 2,
              max: 6,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 4,
              max: 10,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 7,
              max: 16,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            sta: {
              min: 7,
              max: 24,
            },
          },
        },
      ],
    },
    sages: {
      id: 'sages',
      family: 'primary.intellect',
      position: 'prefix',
      nameFragmentId: 'procedural.name.sages',
      tags: ['caster'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 1,
          rolls: {
            int: {
              min: 1,
              max: 1,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 1,
          rolls: {
            int: {
              min: 2,
              max: 6,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 1,
          rolls: {
            int: {
              min: 4,
              max: 10,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 1,
          rolls: {
            int: {
              min: 6,
              max: 16,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 1,
          rolls: {
            int: {
              min: 6,
              max: 24,
            },
          },
        },
      ],
    },
    spiritual: {
      id: 'spiritual',
      family: 'primary.spirit',
      position: 'prefix',
      nameFragmentId: 'procedural.name.spiritual',
      tags: ['caster'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 1,
              max: 1,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 2,
              max: 7,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 4,
              max: 11,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 7,
              max: 18,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 0.85,
          rolls: {
            spi: {
              min: 7,
              max: 28,
            },
          },
        },
      ],
    },
    focused: {
      id: 'focused',
      family: 'offense.spell_power',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_focus',
      tags: ['caster'],
      minItemLevel: 4,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 1,
              max: 2,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 3,
              max: 9,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 6,
              max: 15,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 10,
              max: 24,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 0.65,
          rolls: {
            spellPower: {
              min: 10,
              max: 36,
            },
          },
        },
      ],
    },
    striking: {
      id: 'striking',
      family: 'rating.crit',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_striking',
      tags: ['armor', 'weapon', 'held_offhand', 'jewelry'],
      minItemLevel: 4,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 2,
              max: 6,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 4,
              max: 24,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 8,
              max: 40,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 14,
              max: 64,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 0.25,
          rolls: {
            critRating: {
              min: 14,
              max: 96,
            },
          },
        },
      ],
    },
    alacrity: {
      id: 'alacrity',
      family: 'rating.haste',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_alacrity',
      tags: ['armor', 'weapon', 'held_offhand', 'jewelry'],
      minItemLevel: 4,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 2,
              max: 5,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 4,
              max: 21,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 8,
              max: 35,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 13,
              max: 57,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 0.28,
          rolls: {
            hasteRating: {
              min: 13,
              max: 85,
            },
          },
        },
      ],
    },
    precision: {
      id: 'precision',
      family: 'rating.hit',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_precision',
      tags: ['armor', 'weapon', 'held_offhand', 'jewelry'],
      minItemLevel: 10,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 1,
              max: 4,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 3,
              max: 18,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 6,
              max: 31,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 11,
              max: 50,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 0.32,
          rolls: {
            hitRating: {
              min: 11,
              max: 75,
            },
          },
        },
      ],
    },
    warded: {
      id: 'warded',
      family: 'defense.armor',
      position: 'prefix',
      nameFragmentId: 'procedural.name.warded',
      tags: ['armor'],
      excludedTags: ['jewelry'],
      minItemLevel: 1,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 4,
              max: 18,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 8,
              max: 75,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 16,
              max: 125,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 28,
              max: 200,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 0.08,
          rolls: {
            armor: {
              min: 28,
              max: 300,
            },
          },
        },
      ],
    },
    reaping: {
      id: 'reaping',
      family: 'resource.health_on_kill',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_reaping',
      tags: ['melee', 'ranged'],
      minItemLevel: 4,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 1,
              max: 3,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 2,
              max: 12,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 4,
              max: 20,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 7,
              max: 32,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 0.5,
          rolls: {
            healthOnKill: {
              min: 7,
              max: 48,
            },
          },
        },
      ],
    },
    remembrance: {
      id: 'remembrance',
      family: 'resource.mana_on_kill',
      position: 'suffix',
      nameFragmentId: 'procedural.name.of_remembrance',
      tags: ['caster'],
      minItemLevel: 8,
      tiers: [
        {
          tier: 1,
          minItemLevel: 1,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 1,
              max: 3,
            },
          },
        },
        {
          tier: 2,
          minItemLevel: 4,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 2,
              max: 12,
            },
          },
        },
        {
          tier: 3,
          minItemLevel: 8,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 4,
              max: 20,
            },
          },
        },
        {
          tier: 4,
          minItemLevel: 12,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 7,
              max: 32,
            },
          },
        },
        {
          tier: 5,
          minItemLevel: 18,
          budgetCost: 0.5,
          rolls: {
            manaOnKill: {
              min: 7,
              max: 48,
            },
          },
        },
      ],
    },
  },
  rarities: {
    common: {
      id: 'common',
      affixCounts: [
        {
          count: 0,
          weight: 1,
        },
      ],
      budgetMultiplier: 0,
      rollFloor: 0,
    },
    magic: {
      id: 'magic',
      affixCounts: [
        {
          count: 1,
          weight: 0.55,
        },
        {
          count: 2,
          weight: 0.45,
        },
      ],
      budgetMultiplier: 0.7,
      rollFloor: 0,
    },
    rare: {
      id: 'rare',
      affixCounts: [
        {
          count: 3,
          weight: 0.65,
        },
        {
          count: 4,
          weight: 0.35,
        },
      ],
      budgetMultiplier: 1,
      rollFloor: 0.15,
    },
    epic: {
      id: 'epic',
      affixCounts: [
        {
          count: 4,
          weight: 0.55,
        },
        {
          count: 5,
          weight: 0.45,
        },
      ],
      budgetMultiplier: 1.25,
      rollFloor: 0.35,
    },
    legendary: {
      id: 'legendary',
      affixCounts: [
        {
          count: 3,
          weight: 0.65,
        },
        {
          count: 4,
          weight: 0.35,
        },
      ],
      budgetMultiplier: 1.2,
      rollFloor: 0.5,
    },
  },
  statBudgetCost: {
    str: 1,
    agi: 1,
    sta: 1,
    int: 1,
    spi: 0.85,
    spellPower: 0.65,
    critRating: 0.25,
    hasteRating: 0.28,
    hitRating: 0.32,
    armor: 0.08,
    healthOnKill: 0.5,
    manaOnKill: 0.5,
  },
  rareFirstWordIds: [
    'procedural.rare.ashen',
    'procedural.rare.blackfen',
    'procedural.rare.doom',
    'procedural.rare.grave',
    'procedural.rare.mire',
    'procedural.rare.storm',
    'procedural.rare.thorn',
    'procedural.rare.wyrm',
  ],
  rareSecondWordIds: [
    'procedural.rare.bite',
    'procedural.rare.brand',
    'procedural.rare.promise',
    'procedural.rare.thread',
    'procedural.rare.vigil',
    'procedural.rare.ward',
    'procedural.rare.whisper',
    'procedural.rare.oath',
  ],
  powers: {
    crown_last_pyre: {
      id: 'crown_last_pyre',
      revision: 1,
      compatibleBaseIds: ['gravecaller_cloth_hood'],
      rolls: {
        potencyPct: {
          min: 29,
          max: 34,
          step: 1,
        },
      },
    },
    greyjaws_edge: {
      id: 'greyjaws_edge',
      revision: 1,
      compatibleBaseIds: [
        'iron_broadsword',
        'thornpeak_war_axe',
        'iron_flanged_mace',
        'thornpeak_polearm',
      ],
      rolls: {
        potencyPct: {
          min: 38,
          max: 40,
          step: 1,
        },
      },
    },
    hushwood_longbow: {
      id: 'hushwood_longbow',
      revision: 1,
      compatibleBaseIds: ['mirefen_hunting_bow'],
      rolls: {
        durationMs: {
          min: 800,
          max: 1200,
          step: 100,
        },
      },
    },
    nightglass_fang: {
      id: 'nightglass_fang',
      revision: 1,
      compatibleBaseIds: ['mirefen_dirk'],
      rolls: {
        potencyPct: {
          min: 10,
          max: 14,
          step: 1,
        },
      },
    },
    ysoleis_vigil: {
      id: 'ysoleis_vigil',
      revision: 1,
      compatibleBaseIds: ['ashwood_staff', 'gravecaller_focus'],
      rolls: {
        potencyPct: {
          min: 14,
          max: 20,
          step: 1,
        },
      },
    },
    stormwake_idol: {
      id: 'stormwake_idol',
      revision: 1,
      compatibleBaseIds: ['gravecaller_focus'],
      rolls: {
        potencyPct: {
          min: 22,
          max: 30,
          step: 1,
        },
      },
    },
    ashbinders_seal: {
      id: 'ashbinders_seal',
      revision: 1,
      compatibleBaseIds: ['gravecaller_ring'],
      rolls: {
        potencyPct: {
          min: 15,
          max: 20,
          step: 1,
        },
      },
    },
    dawnward_signet: {
      id: 'dawnward_signet',
      revision: 1,
      compatibleBaseIds: ['gravecaller_ring'],
      rolls: {
        potencyPct: {
          min: 16,
          max: 22,
          step: 1,
        },
      },
    },
    feral_moonclasp: {
      id: 'feral_moonclasp',
      revision: 1,
      compatibleBaseIds: ['gravecaller_pendant'],
      rolls: {
        resource: {
          min: 4,
          max: 7,
          step: 1,
        },
      },
    },
    bell_of_the_ninth_peal: {
      id: 'bell_of_the_ninth_peal',
      revision: 1,
      compatibleBaseIds: ['ashwood_staff', 'gravecaller_focus'],
      rolls: {
        potencyPct: {
          min: 25,
          max: 29,
          step: 1,
        },
      },
    },
    mantle_of_borrowed_time: {
      id: 'mantle_of_borrowed_time',
      revision: 1,
      compatibleBaseIds: [
        'gravecaller_cloth_mantle',
        'mirefen_leather_shoulderguards',
        'thornpeak_mail_pauldrons',
      ],
      rolls: {
        potencyPct: {
          min: 14,
          max: 20,
          step: 1,
        },
      },
    },
    boots_of_the_unbroken_road: {
      id: 'boots_of_the_unbroken_road',
      revision: 1,
      compatibleBaseIds: [
        'gravecaller_cloth_slippers',
        'mirefen_leather_boots',
        'thornpeak_mail_sabatons',
      ],
      rolls: {
        potencyPct: {
          min: 8,
          max: 12,
          step: 1,
        },
      },
    },
  },
} satisfies ProceduralItemDefinitionSnapshot);

export const PROCEDURAL_ITEM_DEFINITION_REVISIONS = deepFreeze({
  1: REVISION_1,
  2: REVISION_2,
  3: REVISION_3,
} as const);

export const LEGACY_PROCEDURAL_DEFINITION_MIGRATION_ORDER = [3, 2, 1] as const;

export function proceduralItemDefinitionSnapshot(
  revision: unknown,
): ProceduralItemDefinitionSnapshot | undefined {
  if (revision !== 1 && revision !== 2 && revision !== 3) return undefined;
  return PROCEDURAL_ITEM_DEFINITION_REVISIONS[revision];
}
