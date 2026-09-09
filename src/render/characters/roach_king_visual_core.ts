// The replicated crown aura is the form authority, including late joins and
// corpses. HP is deliberately irrelevant: healing cannot undo a coronation.
export function roachKingVisualKey(entity: {
  kind: string;
  templateId: string;
  auras?: readonly { id: string }[];
}): string | null {
  if (entity.kind !== 'mob') return null;
  if (entity.templateId === 'rift_roachling') return 'mob_roachling';
  if (entity.templateId === 'rift_garbage_beetle') return 'mob_garbage_beetle';
  if (entity.templateId !== 'rift_boss_asmon') return null;
  return entity.auras?.some((aura) => aura.id === 'rift_roach_crown')
    ? 'mob_roach_king'
    : 'mob_asmon_hermit';
}
