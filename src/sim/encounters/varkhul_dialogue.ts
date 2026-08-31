// Varkhul's approved spoken encounter catalog. Keeping every literal in one
// sim leaf lets encounter events, localization, voice authoring, and asset
// coverage share the exact runtime text.

export const VARKHUL_DIALOGUE = {
  assembly: 'The spring did not die. I bound its last memory into iron.',
  addsDefeated: 'You call it a prison because your flesh fears endurance.',
  engage: 'I am Varkhul, Forgefather of the Last Flame. Raise your weapons, little sparks.',
  masterpiece:
    'Every blow will feed the furnace in my chest. By ember, stone, and anvil, I will unmake you.',
  death: 'Master... I have failed you.',
} as const;

export const VARKHUL_DIALOGUE_LINES = [
  VARKHUL_DIALOGUE.assembly,
  VARKHUL_DIALOGUE.addsDefeated,
  VARKHUL_DIALOGUE.engage,
  VARKHUL_DIALOGUE.masterpiece,
  VARKHUL_DIALOGUE.death,
] as const;
