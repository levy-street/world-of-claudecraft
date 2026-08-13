// Pure target-portrait selection. Every catalogued mob template has committed,
// prerendered portrait art; players use their live class portrait and NPCs keep
// their crest. Short-lived guardians are not MOBS rows, so they deliberately
// borrow the portrait of the exact existing creature body used in-world.

export const TRANSIENT_MOB_PORTRAIT_SOURCE_IDS: Readonly<Record<string, string>> = Object.freeze({
  guardian_tithefiend: 'rift_dread_stalker',
  guardian_stampede_0: 'old_greyjaw',
  guardian_stampede_1: 'wild_boar',
  guardian_stampede_2: 'gloam_strider',
});

const STATIC_MOB_PORTRAIT_URLS: Readonly<Record<string, string>> = Object.freeze({
  // The Vale Cup ball uses a procedural world renderer rather than the creature
  // manifest. Keep its hand-painted portrait outside the deterministic mob-render
  // ledger instead of accepting the manifest's unrelated wolf fallback.
  vale_cup_ball: '/ui/portraits/vale_cup_ball.webp',
});

export function targetPortraitSourceId(templateId: string, isMobEntity: boolean): string | null {
  if (!isMobEntity) return null;
  return TRANSIENT_MOB_PORTRAIT_SOURCE_IDS[templateId] ?? templateId;
}

export function targetPortraitUrl(templateId: string, isMobEntity: boolean): string | null {
  if (isMobEntity && STATIC_MOB_PORTRAIT_URLS[templateId]) {
    return STATIC_MOB_PORTRAIT_URLS[templateId];
  }
  const sourceId = targetPortraitSourceId(templateId, isMobEntity);
  return sourceId ? `/ui/mobs/${encodeURIComponent(sourceId)}.webp` : null;
}
