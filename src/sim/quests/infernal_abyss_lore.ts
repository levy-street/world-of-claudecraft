const INFERNAL_ABYSS_LORE: Record<string, readonly string[]> = {
  charred_legion_tablet: [
    'We marched beneath a sun that never rose.',
    'Azazel promised a kingdom beyond death. He led us only deeper.',
  ],
  brands_of_the_first_flame: [
    'The first flame was not worshipped. It was a lock.',
    'Each brand bound one legionary to the Heart Cairn.',
  ],
  forgekeepers_ledger: [
    'I forged their chains and called it duty.',
    'When the last seal breaks, let my hammer be the first thing the abyss devours.',
  ],
  azazels_broken_covenant: [
    'Azazel swore his fire would guard the mortal world.',
    'The final clause is burned away. Only his true name remains.',
  ],
};

export function infernalAbyssLoreLines(itemId: string): readonly string[] | null {
  return INFERNAL_ABYSS_LORE[itemId] ?? null;
}
