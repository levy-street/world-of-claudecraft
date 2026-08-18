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
    'c74d58d2b282328f588d9d51b1b66eb123a963b047410ab95b017518a33794bb',
  ],
  drowsy_croaker: [
    'mob_murloc',
    'models/creatures/frog.glb',
    '994a349fdcb47bfbbfe2af7f92eb7a6feaa95f38a1998147723fb585e240167a',
  ],
  mere_lurker: [
    'mob_murloc',
    'models/creatures/frog.glb',
    'dd958843a504ea6f07e97f92f0e5a477faa6eff52647e8c4af7e2ad5a02a4d0d',
  ],
  the_meredark: [
    'mob_murloc',
    'models/creatures/frog.glb',
    '9317cb96146327564f5dbb821fed757b628e47ace76df133fd3f2acc91df4d0e',
  ],
  breach_wretch: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '7a472425d553051ade36fab448f8cb0091f2bb76a555e93b535ed21ea1a6f427',
  ],
  fen_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '27e20641545265cb933edf9220a7262ef69cd7b5fb9f8ea4ca943417b243303a',
  ],
  harvest_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '91acea51e4a36630146eb55e2b48a980405083aaa997e6325162722e77842c78',
  ],
  hedge_gnome: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    'b35c370fbdbee7c8e60c79c6db28cf0eee8a88cda629aa6235f8642de6fb540d',
  ],
  willow_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    'c1dc29dbb2a2f33a65306af3f7747a6f431d2af9961075fcb6d63a8bdcdebaa3',
  ],
  downs_bandit: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    'b35c370fbdbee7c8e60c79c6db28cf0eee8a88cda629aa6235f8642de6fb540d',
  ],
  wreck_thief: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    'b35c370fbdbee7c8e60c79c6db28cf0eee8a88cda629aa6235f8642de6fb540d',
  ],
  training_dummy: [
    'mob_training_dummy',
    'models/creatures/training_dummy.glb',
    '66efb4999739669201bd44e21aca2d6e222ba8dfeb410d018c1e5e7d156e0e65',
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
    '074e53c4715efc8139889b3232968c6ee54baefb984cb01ed571714b81b5d365',
  ],
  castaway_navigator: [
    'npc_villager',
    'models/chars/players/rogue.glb',
    0x4a7a9c,
    0.35,
    '6711572931e5cfc6ed2d0aca599aa70c4ec92c6163b098bf3f222d90317cbe26',
  ],
  fisher_bram: [
    'npc_villager',
    'models/chars/players/rogue.glb',
    0x4a6a8a,
    0.35,
    '8f18935329142987a17c888b39dfd6bd30413fd0528933829e0b3e0f3c6f6fe5',
  ],
  cindraleth_maw_matriarch: [
    'mob_dragonkin_matriarch',
    'models/creatures/dragonkin_elite.glb',
    0xf0b040,
    0.12,
    '7d8d2dad0b160e147bb719fc48db4fe092bfc2a789cf0ee21993cfa683d72a65',
  ],
  grubjaw: [
    'mob_grubjaw',
    'models/creatures/grubjaw.glb',
    0x145a32,
    0.04,
    'cd9810cbb956c043fe6d1a514c20d3a941afa19910b5fc005c460e66d1a2d2b1',
  ],
  the_wreck_warden: [
    'mob_bruiser',
    'models/chars/players/barbarian.glb',
    0x7a8a86,
    0.3,
    'e11030bfe58ca95bfa73670c6b35ae3004253f501352bac37c47152190b57006',
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
