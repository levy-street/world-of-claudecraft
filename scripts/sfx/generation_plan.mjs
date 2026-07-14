// Validate the whole catalog and materialize every paid-generation track before
// the first API request. This keeps catalog mistakes from causing partial spend.

import { sfxTrackDescriptors } from './manifest.mjs';

export function generationTracks(entry) {
  return sfxTrackDescriptors(entry).map((descriptor) => ({
    ...entry,
    ...descriptor.overrides,
    trackId: descriptor.id,
    filename: descriptor.filename,
  }));
}

export function buildSfxGenerationPlan(catalog) {
  return catalog.map((entry) => ({ entry, tracks: generationTracks(entry) }));
}
