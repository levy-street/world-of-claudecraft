import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { mobPortraitBackgroundSvg } from '../scripts/lib/mob_portrait_background.mjs';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { MOBS } from '../src/sim/data';
import {
  TRANSIENT_MOB_PORTRAIT_SOURCE_IDS,
  targetPortraitSourceId,
  targetPortraitUrl,
} from '../src/ui/target_portrait_view';

// These twelve portraits had silently retained the old hooded-rogue render after their
// manifest visuals changed to frogs, goblins, and the training dummy. Pin both the current
// visual identity and the deterministic renderer output so a future model remap cannot leave
// a plausible-looking but incorrect portrait behind again.
const CORRECTED_PORTRAITS = {
  bogtoad: [
    'mob_murloc',
    'models/creatures/frog.glb',
    '1e23b41efff2235f42ab7dfc5cc467c782f4e6e9bbcf5f691019d5aa84618b0b',
  ],
  drowsy_croaker: [
    'mob_murloc',
    'models/creatures/frog.glb',
    'd58d617071ead1f8211ea4584cb199ba653022a50c303eeeaad59676976cf1ae',
  ],
  mere_lurker: [
    'mob_murloc',
    'models/creatures/frog.glb',
    '79a58134dc658f8e31749495107d5c2738909ba848b5cb878efe79d86bedef0a',
  ],
  the_meredark: [
    'mob_murloc',
    'models/creatures/frog.glb',
    '571ca5b7ce1dfbea6989c8d3897a2e2a8f68c2f886e918895a136592d507b07c',
  ],
  breach_wretch: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    'afb4783c5f98e72096ff055c57bf9f1cca69287e73e649e302aab9507ac8c40f',
  ],
  fen_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '9452fb7216c7a3237744d2ad6ab3fe4e28a77e96a49bf83853f784517456a6c0',
  ],
  harvest_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '451a9e94af9b7b9396262e6ba2067f8601eb6919fd7d2ebcb252bde569cb8e2b',
  ],
  hedge_gnome: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '63d0b8b7ec80b2d8e49c599dbdab667022bc3b8635876a1db45033c370c541df',
  ],
  willow_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '5f7819fadaed90ff89a31b5f6b8e09b376e807c81f8101e5a94378d89e86f8b1',
  ],
  downs_bandit: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '63d0b8b7ec80b2d8e49c599dbdab667022bc3b8635876a1db45033c370c541df',
  ],
  wreck_thief: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '63d0b8b7ec80b2d8e49c599dbdab667022bc3b8635876a1db45033c370c541df',
  ],
  training_dummy: [
    'mob_training_dummy',
    'models/creatures/training_dummy.glb',
    '2f3e963f5346db997e4dd990ed65bf83f9915d10a5ecbe29260b28d9ac247d0e',
  ],
} as const;

// These portraits all resolve through entity-tinted visuals. The escortees shared one stale
// green hooded render, while Cindraleth, Grubjaw, and the Wreck Warden retained older model
// stand-ins. Pin the tint inputs as well as each visual/model and deterministic output.
const CORRECTED_TINTED_PORTRAITS = {
  gravedigger_mosley: [
    'npc_villager',
    'models/chars/players/rogue.glb',
    0x8a7a5a,
    0.35,
    '699b404cd0e3b1b231b82b3d02357e94c6b3bed37bbf9f46bc6585a9ece0ba36',
  ],
  castaway_navigator: [
    'npc_villager',
    'models/chars/players/rogue.glb',
    0x4a7a9c,
    0.35,
    'caa41418ae0cf05ea788967c7df5e05ec61a7bf10c2e46da7041b63302839457',
  ],
  fisher_bram: [
    'npc_villager',
    'models/chars/players/rogue.glb',
    0x4a6a8a,
    0.35,
    '9a553c04903f0326a369e12e32ab46088ac16b8df85216bd84442349cbb35d95',
  ],
  cindraleth_maw_matriarch: [
    'mob_dragonkin_matriarch',
    'models/creatures/dragonkin_elite.glb',
    0xf0b040,
    0.12,
    '5dd3432a2363096ff0d4bd831a36ed7419e8230248529987de2f71362c979fec',
  ],
  grubjaw: [
    'mob_grubjaw',
    'models/creatures/grubjaw.glb',
    0x145a32,
    0.04,
    '3ddba949b8d523e38f54154957b3dcd354db8bdf78f1ee9129627a38f3d7e56c',
  ],
  the_wreck_warden: [
    'mob_bruiser',
    'models/chars/players/barbarian.glb',
    0x7a8a86,
    0.3,
    '9142ba953bf15b818fb6163bd477439d8f652b94c61de67e51f25efc63429bb0',
  ],
} as const;

describe('targetPortraitUrl', () => {
  it('selects committed portrait art for mob templates only', () => {
    expect(targetPortraitUrl('morthen', true)).toBe('/ui/mobs/morthen.webp');
    expect(targetPortraitUrl('the_merchant', false)).toBeNull();
    // Sexton Marrow is both a living NPC id and an undead encounter id. Entity
    // kind, not catalog overlap, decides whether portrait art is appropriate.
    expect(MOBS.sexton_marrow).toBeDefined();
    expect(targetPortraitUrl('sexton_marrow', false)).toBeNull();
  });

  it('borrows exact existing creature portraits for transient guardians', () => {
    expect(TRANSIENT_MOB_PORTRAIT_SOURCE_IDS).toEqual({
      guardian_tithefiend: 'rift_dread_stalker',
      guardian_stampede_0: 'old_greyjaw',
      guardian_stampede_1: 'wild_boar',
      guardian_stampede_2: 'gloam_strider',
    });
    for (const [guardianId, sourceId] of Object.entries(TRANSIENT_MOB_PORTRAIT_SOURCE_IDS)) {
      expect(targetPortraitSourceId(guardianId, true), guardianId).toBe(sourceId);
      const url = targetPortraitUrl(guardianId, true);
      expect(url, guardianId).toBe(`/ui/mobs/${sourceId}.webp`);
      expect(existsSync(resolve(process.cwd(), `public${url}`)), guardianId).toBe(true);
    }
  });

  it('uses dedicated static art for the procedural Vale Cup ball', async () => {
    const url = targetPortraitUrl('vale_cup_ball', true);
    expect(url).toBe('/ui/portraits/vale_cup_ball.webp');
    const path = resolve(process.cwd(), `public${url}`);
    const bytes = readFileSync(path);
    expect(bytes.byteLength).toBe(2068);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'a7c60d03e01897459a70d9d79aaf575ea6c12fc13db38e981fee3614a8076670',
    );
    expect(await sharp(bytes).metadata()).toMatchObject({
      width: 128,
      height: 128,
      space: 'srgb',
      channels: 3,
      hasAlpha: false,
    });
  });

  it('ships a decodable portrait with an opaque backdrop for every mob template', async () => {
    const entries = Object.entries(MOBS);
    const urls = entries.map(([mobId]) => targetPortraitUrl(mobId, true));
    const missing = urls.filter(
      (url) => !url || !existsSync(resolve(process.cwd(), `public${url}`)),
    );
    expect(missing).toEqual([]);
    const portraits = await Promise.all(
      entries.map(async ([mobId, mob]) => {
        const url = targetPortraitUrl(mobId, true);
        const image = sharp(resolve(process.cwd(), `public${url}`)).ensureAlpha();
        const background = sharp(Buffer.from(mobPortraitBackgroundSvg(mob.family, 128)));
        const [metadata, corner, pixels, backgroundPixels] = await Promise.all([
          image.metadata(),
          image.clone().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer(),
          image.clone().raw().toBuffer(),
          background.raw().toBuffer(),
        ]);
        let subjectPixels = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          const difference =
            Math.abs(pixels[offset] - backgroundPixels[offset]) +
            Math.abs(pixels[offset + 1] - backgroundPixels[offset + 1]) +
            Math.abs(pixels[offset + 2] - backgroundPixels[offset + 2]);
          if (difference > 45) subjectPixels++;
        }
        return {
          metadata,
          cornerAlpha: corner[3],
          cornerBrightness: corner[0] + corner[1] + corner[2],
          subjectPixels,
        };
      }),
    );
    expect(
      portraits.every(({ metadata }) => metadata.width === 128 && metadata.height === 128),
    ).toBe(true);
    expect(portraits.every(({ cornerAlpha }) => cornerAlpha === 255)).toBe(true);
    expect(portraits.every(({ cornerBrightness }) => cornerBrightness > 0)).toBe(true);
    expect(portraits.every(({ subjectPixels }) => subjectPixels > 150)).toBe(true);
  });

  it('does not ship orphan portraits for removed or renamed mob templates', () => {
    const assets = readdirSync(resolve(process.cwd(), 'public/ui/mobs'))
      .filter((file) => !file.startsWith('.'))
      .sort();
    expect(assets).toEqual(
      Object.keys(MOBS)
        .map((id) => `${id}.webp`)
        .sort(),
    );
  });

  it('keeps corrected portraits synchronized with their current rendered models', () => {
    for (const [mobId, [visualKey, model, acceptedHash]] of Object.entries(CORRECTED_PORTRAITS)) {
      const mob = MOBS[mobId];
      expect(mob, `${mobId} fixture`).toBeDefined();
      const currentVisual = visualKeyFor({
        kind: 'mob',
        templateId: mobId,
        family: mob?.family,
      } as never);
      expect(currentVisual, `${mobId} visual key`).toBe(visualKey);
      expect(VISUALS[currentVisual]?.url, `${mobId} model`).toBe(model);
      const hash = createHash('sha256')
        .update(readFileSync(resolve(process.cwd(), `public/ui/mobs/${mobId}.webp`)))
        .digest('hex');
      expect(hash, `${mobId} rerender`).toBe(acceptedHash);
    }
  });

  it('keeps corrected tinted portraits synchronized with their live model and tint', () => {
    for (const [mobId, [visualKey, model, tint, tintStrength, acceptedHash]] of Object.entries(
      CORRECTED_TINTED_PORTRAITS,
    )) {
      const mob = MOBS[mobId];
      expect(mob, `${mobId} fixture`).toBeDefined();
      const currentVisual = visualKeyFor({
        kind: 'mob',
        templateId: mobId,
        family: mob?.family,
      } as never);
      expect(currentVisual, `${mobId} visual key`).toBe(visualKey);
      expect(VISUALS[currentVisual]?.url, `${mobId} model`).toBe(model);
      expect(VISUALS[currentVisual]?.tint, `${mobId} tint source`).toBe('entity');
      expect(VISUALS[currentVisual]?.tintStrength, `${mobId} tint strength`).toBe(tintStrength);
      expect(mob?.color, `${mobId} live tint`).toBe(tint);
      const hash = createHash('sha256')
        .update(readFileSync(resolve(process.cwd(), `public/ui/mobs/${mobId}.webp`)))
        .digest('hex');
      expect(hash, `${mobId} rerender`).toBe(acceptedHash);
    }
  });
});
