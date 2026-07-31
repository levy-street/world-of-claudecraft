// Pure target-portrait selection. Templates with the same rendered look share
// committed art; players use their live class portrait and NPCs keep their crest.

export const MOB_PORTRAIT_ALIASES: Readonly<Record<string, string>> = {
  undermount_cinderling: 'volzharr_buried_furnace',
  wyrmcult_dig_foreman: 'wyrmcult_necromancer',
};

export function targetPortraitUrl(templateId: string, isMobTemplate: boolean): string | null {
  if (!isMobTemplate) return null;
  const portraitId = MOB_PORTRAIT_ALIASES[templateId] ?? templateId;
  return `/ui/mobs/${encodeURIComponent(portraitId)}.webp`;
}
