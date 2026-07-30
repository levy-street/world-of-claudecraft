// Pure target-portrait selection. Every mob template has committed, prerendered
// portrait art; players use their live class portrait and NPCs keep their crest.

export function targetPortraitUrl(templateId: string, isMobTemplate: boolean): string | null {
  if (!isMobTemplate) return null;
  return `/ui/mobs/${encodeURIComponent(templateId)}.webp`;
}
