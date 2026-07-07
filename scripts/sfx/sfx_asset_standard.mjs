// Shared SFX asset standard used by the generator and conformance checker.
// Keep the human-readable rationale in docs/design/sound_effects.md.

export const SFX_STANDARD = Object.freeze({
  extension: '.mp3',
  codec: 'mp3',
  sampleRateHz: 44_100,
  generatedBitrateKbps: 128,
  bitrateCeilingKbps: 192,
  peakDbfs: -6,
  peakToleranceDb: 0.15,
  monoChannels: 1,
  stereoChannels: 2,
  keyPattern: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/,
  filenamePattern: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.mp3$/,
});

export function channelsForEntry(entry) {
  return entry?.stereo === true ? SFX_STANDARD.stereoChannels : SFX_STANDARD.monoChannels;
}

export function channelLabel(channels) {
  if (channels === 1) return 'mono';
  if (channels === 2) return 'stereo';
  return `${channels}ch`;
}

export function filenameForKey(key) {
  return `${key}${SFX_STANDARD.extension}`;
}

export function keyFromFilename(filename) {
  if (!filename.endsWith(SFX_STANDARD.extension)) return null;
  return filename.slice(0, -SFX_STANDARD.extension.length);
}

export function buildSfxCatalogMap(entries) {
  const catalog = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') continue;
    if (catalog.has(entry.key)) throw new Error(`Duplicate SFX key in catalog: ${entry.key}`);
    catalog.set(entry.key, {
      ...entry,
      channels: channelsForEntry(entry),
      filename: filenameForKey(entry.key),
    });
  }
  return catalog;
}

export function validateSfxCatalog(entries) {
  const errors = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') {
      errors.push('Catalog entry is missing a string key.');
      continue;
    }
    if (seen.has(entry.key)) errors.push(`${entry.key}: duplicate key.`);
    seen.add(entry.key);
    if (!SFX_STANDARD.keyPattern.test(entry.key)) {
      errors.push(`${entry.key}: key must be lowercase snake_case alphanumeric.`);
    }
    if (entry.stereo === true && !entry.loop) {
      errors.push(`${entry.key}: stereo clips must be loops; one-shots default to mono.`);
    }
  }
  return errors;
}
