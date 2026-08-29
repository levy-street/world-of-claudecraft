// Canonical salvage-material table. Kept in a pure leaf so classification can
// read it without evaluating the stateful salvage command module. It reuses
// existing harvested-material ids instead of expanding the item and i18n
// catalogs solely for the salvage loop.

export const SALVAGE_MATERIAL_BY_QUALITY: Readonly<Record<string, string>> = Object.freeze({
  common: 'bone_fragments',
  uncommon: 'linen_scrap',
  rare: 'spider_leg',
  epic: 'spider_leg',
  legendary: 'spider_leg',
});
