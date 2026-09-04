// The Phase 13 asset handoff manifest (docs/design/farming-asset-manifest.json)
// is the maintainer's contract for sourcing real GLBs, and it survives any
// packet teardown, so it must not rot.
// No generator script
// exists (a re-derivation is a hand edit), which is exactly why this suite
// binds every DERIVABLE half to its pinned source: the asset rows to
// FARM_PROP_CONTRACTS in scripts/assets/farm_props/model.js, the render
// identity block to the src/render/farm_patches_core.ts tables, and the
// importable adapter constants to src/render/farm_patches.ts. The hand-added
// prose fields (heightNote, regenerationNote, the
// replacementIntent rows, renderIdentity.channelUse, and the two enriched
// tint strings below) are pinned for PRESENCE, not content: they are the
// halves a regen must preserve (the manifest's own regenerationNote says so).
//
// Deliberately NOT bound here: drawHeightYd and the adapterParameters rows
// whose constants are module-internal to farm_patches.ts
// (FARM_SYNC_INTERVAL_S, PITCH_SAMPLE_STEP, SOIL_SOCKET_FALLBACK_Y, the
// normalized draw heights, WET_SOIL_DARKEN). Exporting them solely for a
// docs pin would widen the render surface for no consumer; they were
// verified by hand in the Phase 13 QA correctness audit and any future
// drift is caught at the adapter's own suites when behavior moves.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// The exporter's contract table is plain ESM JS; the manifest's asset rows
// derive from it row for row.
import { FARM_PROP_CONTRACTS, FARM_PROP_IDS } from '../scripts/assets/farm_props/model.js';
import { FEAST_SHADOW_CAP } from '../src/render/farm_patches';
import {
  FARM_BIOME_PALETTES,
  FARM_CROP_ACCENT,
  FARM_CROP_FAMILY,
  FARM_FALLBACK_ACCENT,
  FARM_FALLBACK_FAMILY,
  FARM_FALLBACK_PALETTE,
  FARM_WET_BAND_1_MS,
  FARM_WET_BAND_2_MS,
} from '../src/render/farm_patches_core';

type ContractRow = {
  id: string;
  out: string;
  rootNode: string;
  family: string;
  stage: string;
  footprintYd: readonly number[];
  pivot: string;
  heightYd: number;
  meshes: readonly string[];
  materials: readonly string[];
  sockets: Readonly<Record<string, string>>;
  mountsOn: string | null;
  tintChannels: Readonly<Record<string, string>>;
};

const manifestPath = path.join(process.cwd(), 'docs/design/farming-asset-manifest.json');
const manifestText = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText) as {
  generatedFrom: string;
  assetCount: number;
  heightNote: string;
  regenerationNote: string;
  assets: Array<
    Omit<ContractRow, 'sockets' | 'heightYd'> & {
      authoredHeightYd: number;
      drawHeightYd: number;
      replacementIntent?: string;
      sockets: Record<string, string | { purpose: string }>;
    }
  >;
  renderIdentity: {
    cropFamilies: Record<string, string>;
    cropAccents: Record<string, string>;
    fallbackFamily: string;
    fallbackAccent: string;
    biomePalettes: Record<string, Record<string, string>>;
    fallbackPalette: Record<string, string>;
    channelUse: string;
  };
  adapterParameters: Record<string, unknown>;
};

// The two rows whose farm_body tint prose was deliberately hand-enriched past
// the contract string (naming the palette channel). A third divergence is a
// drift, not an enrichment, until it is listed here in the same change.
const ENRICHED_TINTS: Readonly<Record<string, string>> = {
  farm_bed: 'per-hub biome multiply (the palette soil channel) over the whole mesh',
  farm_compost_bin: 'per-hub biome multiply (the palette wood channel) over the whole mesh',
};

const hex = (n: number) => `0x${n.toString(16)}`;

describe('farming asset manifest binds to its pinned sources', () => {
  it('carries exactly the FARM_PROP_CONTRACTS rows, field for field', () => {
    expect(manifest.assetCount).toBe(FARM_PROP_IDS.length);
    expect(manifest.assets.map((a) => a.id).sort()).toEqual([...FARM_PROP_IDS].sort());
    const byId = new Map(manifest.assets.map((a) => [a.id, a]));
    for (const id of FARM_PROP_IDS as readonly string[]) {
      const c = (FARM_PROP_CONTRACTS as Record<string, ContractRow>)[id];
      const r = byId.get(id);
      expect(r, `manifest row missing for ${id}`).toBeDefined();
      if (!r) continue;
      expect(r.out, `${id} out`).toBe(c.out);
      expect(r.rootNode, `${id} rootNode`).toBe(c.rootNode);
      expect(r.family, `${id} family`).toBe(c.family);
      expect(r.stage, `${id} stage`).toBe(c.stage);
      expect([...r.footprintYd], `${id} footprintYd`).toEqual([...c.footprintYd]);
      expect(r.pivot, `${id} pivot`).toBe(c.pivot);
      expect(r.authoredHeightYd, `${id} authoredHeightYd is the contract heightYd`).toBe(
        c.heightYd,
      );
      expect([...r.meshes], `${id} meshes`).toEqual([...c.meshes]);
      expect([...r.materials], `${id} materials`).toEqual([...c.materials]);
      expect(r.mountsOn, `${id} mountsOn`).toBe(c.mountsOn);
      expect(Object.keys(r.sockets).sort(), `${id} socket names`).toEqual(
        Object.keys(c.sockets).sort(),
      );
      for (const [name, purpose] of Object.entries(c.sockets)) {
        const row = r.sockets[name];
        const rowPurpose = typeof row === 'object' ? row.purpose : row;
        expect(rowPurpose, `${id} socket ${name} purpose`).toBe(purpose);
      }
      expect(Object.keys(r.tintChannels).sort(), `${id} tint channels`).toEqual(
        Object.keys(c.tintChannels).sort(),
      );
      for (const [channel, prose] of Object.entries(c.tintChannels)) {
        const expected =
          channel === 'farm_body' && id in ENRICHED_TINTS ? ENRICHED_TINTS[id] : prose;
        expect(r.tintChannels[channel], `${id} tint ${channel}`).toBe(expected);
      }
      // drawHeightYd is adapter-internal (see the header): presence only.
      expect(typeof r.drawHeightYd, `${id} drawHeightYd present`).toBe('number');
    }
  });

  it('renderIdentity mirrors the farm_patches_core tables', () => {
    const ri = manifest.renderIdentity;
    expect(ri.cropFamilies).toEqual(FARM_CROP_FAMILY);
    expect(ri.fallbackFamily).toBe(FARM_FALLBACK_FAMILY);
    expect(ri.fallbackAccent).toBe(hex(FARM_FALLBACK_ACCENT));
    expect(Object.keys(ri.cropAccents).sort()).toEqual(Object.keys(FARM_CROP_ACCENT).sort());
    for (const [crop, accent] of Object.entries(FARM_CROP_ACCENT)) {
      expect(ri.cropAccents[crop], `accent ${crop}`).toBe(hex(accent));
    }
    expect(Object.keys(ri.biomePalettes).sort()).toEqual(Object.keys(FARM_BIOME_PALETTES).sort());
    for (const [zone, palette] of Object.entries(FARM_BIOME_PALETTES)) {
      for (const channel of ['soil', 'wood'] as const) {
        expect(ri.biomePalettes[zone][channel], `${zone} ${channel}`).toBe(hex(palette[channel]));
      }
    }
    for (const channel of ['soil', 'wood'] as const) {
      expect(ri.fallbackPalette[channel], `fallback ${channel}`).toBe(
        hex(FARM_FALLBACK_PALETTE[channel]),
      );
    }
  });

  it('binds the importable adapter constants and keeps the hand-added prose', () => {
    expect(manifest.adapterParameters.FEAST_SHADOW_CAP).toBe(FEAST_SHADOW_CAP);
    expect(manifest.adapterParameters.FARM_WET_BAND_1_MS).toBe(FARM_WET_BAND_1_MS);
    expect(manifest.adapterParameters.FARM_WET_BAND_2_MS).toBe(FARM_WET_BAND_2_MS);
    // The hand-added fields a re-derivation must preserve.
    expect(manifest.heightNote.length).toBeGreaterThan(0);
    expect(manifest.regenerationNote).toContain('tests/farming_asset_manifest.test.ts');
    expect(manifest.renderIdentity.channelUse).toContain(
      'wood is the compost bin whole-mesh multiply',
    );
    // Teardown safety: this permanent manifest must not point into a temporary
    // planning packet.
    expect(manifestText.includes('/prd/')).toBe(false);
  });
});
