// Ignivar's spoken encounter catalog and deterministic supporting-line choice.
// Keeping the text in one sim leaf lets the encounter, localization coverage,
// voice authoring pipeline, and asset tests share the exact runtime literals.

export const IGNIVAR_DIALOGUE = {
  roomEntry: 'The seal hears you, little embers. Step closer, and feed the Last Flame.',
  engage: 'Ignivar Ashcaller awakens. Let the world burn!',
  skyfire: 'The sky itself will burn!',
  lastInferno: 'The last flame consumes all!',
  death: 'Varkhul... the seal is broken.',
  finalBrand: 'Bear the Last Flame. Let it judge you.',
  conduitActivated: 'The old wells answer to my fire.',
  rotatingRays: 'Turn with the flame, or be unmade.',
  apocalypse: 'Varkhul forged me to endure.',
  defeatSpark: 'Another spark, extinguished.',
  defeatForge: 'The forge rejects you.',
  forgeJudgment: 'I am the seal. I will not break.',
} as const;

export const IGNIVAR_DIALOGUE_LINES = [
  IGNIVAR_DIALOGUE.roomEntry,
  IGNIVAR_DIALOGUE.engage,
  IGNIVAR_DIALOGUE.skyfire,
  IGNIVAR_DIALOGUE.lastInferno,
  IGNIVAR_DIALOGUE.death,
  IGNIVAR_DIALOGUE.finalBrand,
  IGNIVAR_DIALOGUE.conduitActivated,
  IGNIVAR_DIALOGUE.rotatingRays,
  IGNIVAR_DIALOGUE.apocalypse,
  IGNIVAR_DIALOGUE.defeatSpark,
  IGNIVAR_DIALOGUE.defeatForge,
  IGNIVAR_DIALOGUE.forgeJudgment,
] as const;

export const IGNIVAR_DIALOGUE_GAP_SECONDS = 4;

export function ignivarDefeatYell(announcedDefeatCount: number): string {
  return announcedDefeatCount % 2 === 0
    ? IGNIVAR_DIALOGUE.defeatSpark
    : IGNIVAR_DIALOGUE.defeatForge;
}
