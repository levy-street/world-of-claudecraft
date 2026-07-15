// Guards the GLB replacement of the procedural critters/fish/gather-node/
// mailbox/delve-prop models: every preload URL declared by the render modules
// must point at a real file under public/models, and every referenced GLB
// must have been picked up by the media manifest.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { critterPreloadInternalsForTest } from '../src/render/critters';
import { marshDressingPreloadInternalsForTest } from '../src/render/delve_marsh_dressing';
import { delvePropsPreloadInternalsForTest } from '../src/render/delve_props';
import { doorPortalPreloadInternalsForTest } from '../src/render/door_portal';
import { fishPreloadInternalsForTest } from '../src/render/fish';
import { gatherNodePreloadInternalsForTest } from '../src/render/gather_nodes';
import { mailboxPreloadInternalsForTest } from '../src/render/mailbox';
import { yumiMazePreloadInternalsForTest } from '../src/render/yumi_maze';

const publicDir = path.join(__dirname, '..', 'public');

function expectAssetExistsAndManifested(url: string): void {
  const rel = url.replace(/^\//, '');
  expect(existsSync(path.join(publicDir, rel)), `${url} should exist under public/`).toBe(true);
  expect(
    MEDIA_ASSETS[rel],
    `${url} should be present in the generated media manifest`,
  ).toBeDefined();
}

describe('GLB-replacement asset preload sets resolve to real, manifested files', () => {
  it('critter species assets', () => {
    for (const url of Object.values(critterPreloadInternalsForTest.speciesAssetUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('leaping fish asset', () => {
    expectAssetExistsAndManifested(fishPreloadInternalsForTest.fishAssetUrl);
  });

  it('gather node assets', () => {
    for (const url of Object.values(gatherNodePreloadInternalsForTest.nodeAssetUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('mailbox pillar asset', () => {
    expectAssetExistsAndManifested(mailboxPreloadInternalsForTest.mailboxAssetUrl);
  });

  it('standalone delve prop assets', () => {
    for (const url of Object.values(delvePropsPreloadInternalsForTest.standalonePropUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('marsh dressing anchor assets', () => {
    for (const url of Object.values(marshDressingPreloadInternalsForTest.marshAssetUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('yumi maze brazier and torch assets', () => {
    for (const url of Object.values(yumiMazePreloadInternalsForTest.yumiMazeAssetUrl)) {
      expectAssetExistsAndManifested(url);
    }
  });

  it('dungeon door arch asset', () => {
    expectAssetExistsAndManifested(doorPortalPreloadInternalsForTest.doorArchAssetUrl);
  });
});
