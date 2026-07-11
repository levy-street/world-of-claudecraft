// Protect Yumi! content: the team objective cat familiar. Data-as-code,
// merged into MOBS by data.ts. The cat is a passive 5000 hp objective: it
// never attacks or moves on its own (social/yumi.ts teleports it around the
// maze), its AI is inert (mob/locomotion.ts early-bails on the template id),
// and only the opposing team may strike it while its own team may heal and
// shield it (team hostility in social/yumi.ts).
import type { MobTemplate } from '../types';

export const YUMI_TEMPLATE_ID = 'yumi_cat';

export const YUMI_MOBS: Record<string, MobTemplate> = {
  [YUMI_TEMPLATE_ID]: {
    id: YUMI_TEMPLATE_ID,
    name: 'Yumi',
    minLevel: 1,
    maxLevel: 60,
    family: 'beast',
    hpPerLevel: 0, // 5000 flat regardless of level or format
    hpBase: 5000,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 2,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    loot: [],
    xpMult: 0,
    ccImmune: true,
    slowImmune: true,
    scale: 1,
    color: 0xf2e0c8,
  },
};
