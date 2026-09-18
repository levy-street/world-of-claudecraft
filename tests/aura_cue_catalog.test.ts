import { describe, expect, it } from 'vitest';
// @ts-expect-error -- the SFX authoring source is plain ESM JS with no types.
import { UI_SFX_SPECS } from '../scripts/sfx/ui_sfx.mjs';
import {
  AURA_CUE_NONE,
  AURA_CUES,
  auraCueLabelKey,
  isAuraCueId,
  sanitizeAuraCueId,
} from '../src/game/aura_cue_catalog';
import { SFX_CLIPS, SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import { en } from '../src/ui/i18n.catalog';

const cueIds = AURA_CUES.map((cue) => cue.id);

describe('aura cue catalog', () => {
  it('offers exactly 20 distinct cues, all under the ui_aura_ key namespace', () => {
    expect(AURA_CUES).toHaveLength(20);
    expect(new Set(cueIds).size).toBe(20);
    for (const id of cueIds) expect(id).toMatch(/^ui_aura_[a-z0-9_]+$/);
  });

  it('never treats the silence sentinel as a cue', () => {
    // AURA_CUE_NONE is the stored default, so a truthy answer here would send it
    // to the audio engine as a clip key and produce a missing-asset fetch.
    expect(AURA_CUE_NONE).toBe('none');
    expect(isAuraCueId(AURA_CUE_NONE)).toBe(false);
    expect(cueIds).not.toContain(AURA_CUE_NONE);
  });

  it('degrades any unknown or non-string selection to silence', () => {
    expect(sanitizeAuraCueId(cueIds[0])).toBe(cueIds[0]);
    expect(sanitizeAuraCueId('ui_aura_retired_cue')).toBe(AURA_CUE_NONE);
    expect(sanitizeAuraCueId('ui_click')).toBe(AURA_CUE_NONE);
    expect(sanitizeAuraCueId(undefined)).toBe(AURA_CUE_NONE);
    expect(sanitizeAuraCueId(7)).toBe(AURA_CUE_NONE);
    expect(sanitizeAuraCueId({ id: cueIds[0] })).toBe(AURA_CUE_NONE);
  });

  it('gives every cue a distinct, resolvable English label', () => {
    const labels = AURA_CUES.map((cue) => {
      const parts = cue.labelKey.split('.');
      let node: unknown = en;
      for (const part of parts) node = (node as Record<string, unknown>)[part];
      return node;
    });
    for (const label of labels) expect(typeof label).toBe('string');
    expect(new Set(labels).size).toBe(20);
    expect(auraCueLabelKey('ui_aura_cat_meow')).toBe('hudChrome.auraOverlay.cues.catMeow');
    expect(auraCueLabelKey('nope')).toBeUndefined();
  });
});

describe('aura cue audio assets', () => {
  // The catalog row, the FFmpeg recipe, and the shipped clip are three separate
  // edits; drift between them is a cue that silently never plays. Read the real
  // exported specs, not the source text: a formatter rewrapping one cue() call
  // must not decide whether this guard passes.
  const specs = (UI_SFX_SPECS as { key: string; duration: number }[]).filter((spec) =>
    spec.key.startsWith('ui_aura_'),
  );

  it('has an authored recipe for every catalog cue, and no orphan recipe', () => {
    expect(new Set(specs.map((spec) => spec.key))).toEqual(new Set(cueIds));
    expect(specs).toHaveLength(20);
  });

  it('keeps every cue audible on a laptop or phone speaker', () => {
    // The lesson from Temple Gong, which shipped inaudible. It was authored from
    // 98/146/233 Hz partials: faithful to a real gong, and useless in practice,
    // because small speakers have almost no output below ~200 Hz. It lost 14 dB
    // through a 200 Hz high-pass and read as silence, while the per-band check
    // that was supposed to verify it reported "low-dominant" and called that
    // correct. Low-dominant and audible are different claims.
    //
    // Guard at the AUTHORING layer, where the mistake was made: at least half of
    // every cue's authored energy must sit above the small-speaker knee. The old
    // gong scores 0.18 here, so this fails on exactly the shape that shipped.
    const SMALL_SPEAKER_HZ = 200;
    for (const spec of UI_SFX_SPECS as {
      key: string;
      layers: {
        kind: string;
        gain: number;
        duration: number;
        frequency?: number;
        endFrequency?: number;
        highpass?: number;
        lowpass?: number;
      }[];
    }[]) {
      if (!spec.key.startsWith('ui_aura_')) continue;
      let total = 0;
      let above = 0;
      for (const layer of spec.layers) {
        const energy = layer.gain * layer.duration;
        total += energy;
        const centre =
          layer.kind === 'tone'
            ? Math.max(layer.frequency ?? 0, layer.endFrequency ?? layer.frequency ?? 0)
            : (layer.highpass ?? (layer.lowpass ? layer.lowpass / 2 : 2000));
        if (centre >= SMALL_SPEAKER_HZ) above += energy;
      }
      expect(
        above / total,
        `${spec.key} is too bass-heavy to hear on a small speaker`,
      ).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('holds every cue to the 1 to 2 second band the palette promises', () => {
    for (const spec of specs) {
      expect(spec.duration, `${spec.key} duration`).toBeGreaterThanOrEqual(1);
      expect(spec.duration, `${spec.key} duration`).toBeLessThanOrEqual(2);
    }
  });

  it('ships every cue in the generated sfx manifest, so playUi can resolve it', () => {
    // Membership in the real exported catalog, not a substring of the file: a
    // catalog row whose clip never generated would still match the text.
    const keys = new Set<string>(SFX_FIXED_CATALOG_KEYS);
    for (const id of cueIds) {
      expect(keys.has(id), `${id} missing from the catalog keys`).toBe(true);
      const entry = (SFX_CLIPS as Record<string, { url?: string } | undefined>)[id];
      expect(entry, `${id} has no manifest entry`).toBeDefined();
      // A real shipped file, cache-busted by the manifest's content hash.
      expect(entry?.url, `${id} has no shipped clip`).toMatch(
        new RegExp(`^/audio/sfx/${id}\\.mp3\\?v=`),
      );
    }
  });
});
