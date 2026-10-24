import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetById } from '../src/editor/asset_catalog.generated';
import { targetHeightFor } from '../src/render/asset_scale';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const bankUrl = '/models/props/goldcrest_bank_reference.glb';
const bankMetadataUrl = '/models/props/goldcrest_bank_reference.building.json';

describe('Goldcrest bank editor asset', () => {
  it('ships as a built-in, manifested editor asset', () => {
    expect(assetById('props/goldcrest_bank_reference')).toEqual({
      id: 'props/goldcrest_bank_reference',
      category: 'props',
      label: 'Goldcrest Bank Reference',
      path: bankUrl,
    });
    expect(existsSync(path.join(__dirname, '..', 'public', bankUrl))).toBe(true);
    expect(MEDIA_ASSETS[bankUrl.slice(1)]).toBeDefined();
    expect(existsSync(path.join(__dirname, '..', 'public', bankMetadataUrl))).toBe(true);
  });

  it('preserves the authored largest dimension at editor scale 1', () => {
    expect(targetHeightFor(bankUrl)).toBe(14);
  });

  it('keeps the authored dimensions and front-facing axis in its sidecar', () => {
    const metadata = JSON.parse(
      readFileSync(path.join(__dirname, '..', 'public', bankMetadataUrl), 'utf8'),
    );
    expect(metadata.dimensions).toEqual({ width: 14, depth: 11, height: 7.2 });
    expect(metadata.interior.entrance.localAxis).toBe('+z');
    expect(metadata.collision).toMatchObject({
      mode: 'wall-shell',
      fullFootprintObbForbidden: true,
      requiresManualIntegration: true,
    });
  });
});
