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
    '98edb3581974c42c519d7558f1cac0848d0f22b817125c0f1d7a28cb516a6575',
  ],
  drowsy_croaker: [
    'mob_murloc',
    'models/creatures/frog.glb',
    'c1152c0280759863294bb97ed616485ccc2560db94edb9e3075446fdae0b5b3c',
  ],
  mere_lurker: [
    'mob_murloc',
    'models/creatures/frog.glb',
    '80abf56c9439c500d500aab72370cfddcc5a22671dc6fa131a936526e1d4420f',
  ],
  the_meredark: [
    'mob_murloc',
    'models/creatures/frog.glb',
    'cc833563eb0b8d23fd293100bb0744b149004136d01b37d722a61e91fa24c220',
  ],
  breach_wretch: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '077eff5ac44492db84638979750ea7c3136c507a392cfeb3776603392521aaa3',
  ],
  fen_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '96935d397978dc6c5d70fa79514423d2b0361a74dd8909fccff60cfb26cfc537',
  ],
  harvest_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    'c874aae5ec3098f8a0b71c0676d6c12df59d0d4c510b387771368f750a550be2',
  ],
  hedge_gnome: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '2123cc44196125373f8e32a7bdd5918fc10d3f5f1bf4b6841f2696f7a4e76660',
  ],
  willow_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '931bc56628aa99719a211e4e795d7853bc354b2f7be1574189bc522eab0c6f76',
  ],
  downs_bandit: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '2123cc44196125373f8e32a7bdd5918fc10d3f5f1bf4b6841f2696f7a4e76660',
  ],
  wreck_thief: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '2123cc44196125373f8e32a7bdd5918fc10d3f5f1bf4b6841f2696f7a4e76660',
  ],
  training_dummy: [
    'mob_training_dummy',
    'models/creatures/training_dummy.glb',
    '400afcac22527f9e0145b7a1dcc39f068f8f50d265798497925559464cd70915',
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
    'c609eed99dfcc2fd58fd38aa81bfcec49b5585976ea059d63a58e59c7eed5316',
  ],
  castaway_navigator: [
    'npc_villager',
    'models/chars/players/rogue.glb',
    0x4a7a9c,
    0.35,
    'e037b4cc1ec3c0cfb998baf6f9dda403ddbace9dae57dc038a52ac8ac42c3137',
  ],
  fisher_bram: [
    'npc_villager',
    'models/chars/players/rogue.glb',
    0x4a6a8a,
    0.35,
    '9e9da80613ec40aa6c5cd3964257ff7a39b2eaabbe6656856a0255934c5ea502',
  ],
  cindraleth_maw_matriarch: [
    'mob_dragonkin_matriarch',
    'models/creatures/dragonkin_elite.glb',
    0xf0b040,
    0.12,
    '99aa475e6981edb6f34c3b5f1d9aea9aabad4323cfef6dab11fda9a847e7414e',
  ],
  grubjaw: [
    'mob_grubjaw',
    'models/creatures/grubjaw.glb',
    0x145a32,
    0.04,
    'dcb6b87b10521124dd2418981cd9d572c6281927202662bc922fe652b87bd496',
  ],
  the_wreck_warden: [
    'mob_bruiser',
    'models/chars/players/barbarian.glb',
    0x7a8a86,
    0.3,
    '77179c62bad651d805473d92901f455d15dcfafcb0ca0e9c6c8345968e8c1cc1',
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
