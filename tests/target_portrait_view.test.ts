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
    'b5ecbb01a36f1aa03094efd54b79962ba3985d8ec8b5bc70f42bc159b0c80f7d',
  ],
  drowsy_croaker: [
    'mob_murloc',
    'models/creatures/frog.glb',
    '46570e1af656c3b9e9428ee39ebac2682ed063e52bef25513a918f0d8cda2baf',
  ],
  mere_lurker: [
    'mob_murloc',
    'models/creatures/frog.glb',
    '5ea2fe8f6953714463a3438cbf20299d1eeac480557c1c8311603eeea44eb567',
  ],
  the_meredark: [
    'mob_murloc',
    'models/creatures/frog.glb',
    'b14db6ec964ea25c6de9b588ade5da44e702b93fa5a270751751322170e8a616',
  ],
  breach_wretch: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    'b6fdd777507a714fe00dd6635535f38dde194c3d7d4c1fead226b7e8d68e21e9',
  ],
  fen_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '3f1c378547f3a490f673583a82981efdb22f066823e4f7936089b2e3d9a3ee07',
  ],
  harvest_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '5168f406c69e6470249d7bdbbd9c3742b603d497aac9719754d147df977937bd',
  ],
  hedge_gnome: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '8aae9d814e1047bf7c038d18483fb836b323ee445cc7b00eabe1b3d917a21e1c',
  ],
  willow_sprite: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    'b766e56fd7817a91616c6832f76d565a30fbda2c879a76f5e55a4957ef773eb2',
  ],
  downs_bandit: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '8aae9d814e1047bf7c038d18483fb836b323ee445cc7b00eabe1b3d917a21e1c',
  ],
  wreck_thief: [
    'mob_kobold',
    'models/creatures/goblin.glb',
    '8aae9d814e1047bf7c038d18483fb836b323ee445cc7b00eabe1b3d917a21e1c',
  ],
  training_dummy: [
    'mob_training_dummy',
    'models/creatures/training_dummy.glb',
    '3d2b84687d58cab79f273735154816cd1cc870b02f76ee9d852f3d7d3d8dc55a',
  ],
} as const;

// The quest escortees draw on the WOC body of the class their roster look names
// (src/render/characters/npc_looks.ts MOB_LOOK_IDS), no longer on the entity-tinted stock
// villager three of them were pinned on here. Their ledger portrait is therefore that
// class body as the portrait pipeline draws it: untinted, in the class's whole kit, so
// the three on the rogue's body share one image. The unit frames show each one's live
// face instead (manifest.ts npcPortraitSourceFor); the files stay because the ledger
// holds a row for every MOBS template. Pin the body, the absence of a tint and the
// deterministic output: a dispatch that slid back to a tinted stock rig, or a body
// change that left the old render behind, fails here.
const ESCORTEE_CLASS_BODY_PORTRAITS = {
  apprentice_wren: [
    'player_mage_female',
    'models/chars/players/woc/base_female.glb',
    '644d7519428301f9f018c7ccf4a2f2a23b21320706dd9084303d2b97d9158750',
  ],
  castaway_navigator: [
    'player_rogue',
    'models/chars/players/woc/base_male.glb',
    '56ee641a3769222428de3ad5dcab643f909f0880fe546768a189971b034600a3',
  ],
  fisher_bram: [
    'player_rogue',
    'models/chars/players/woc/base_male.glb',
    '56ee641a3769222428de3ad5dcab643f909f0880fe546768a189971b034600a3',
  ],
  gravedigger_mosley: [
    'player_rogue',
    'models/chars/players/woc/base_male.glb',
    '56ee641a3769222428de3ad5dcab643f909f0880fe546768a189971b034600a3',
  ],
} as const;

// These portraits all resolve through entity-tinted visuals: Cindraleth, Grubjaw, and the
// Wreck Warden had retained older model stand-ins. Pin the tint inputs as well as each
// visual/model and deterministic output.
const CORRECTED_TINTED_PORTRAITS = {
  cindraleth_maw_matriarch: [
    'mob_dragonkin_matriarch',
    'models/creatures/dragonkin_elite.glb',
    0xf0b040,
    0.12,
    'd557b16d20c41285ecda9da867a183342f9f3f19d3622f451bebfbf35b4f74dd',
  ],
  grubjaw: [
    'mob_grubjaw',
    'models/creatures/grubjaw.glb',
    0x145a32,
    0.04,
    '0fc867ac1c3e9f0fb012472143c9a5258793348d1060750be159d593539d0455',
  ],
  the_wreck_warden: [
    'mob_bruiser',
    'models/chars/players/barbarian.glb',
    0x7a8a86,
    0.3,
    '2216319bb00c82dc6f121135776c77656925075511df2b29a3ec08d8d871a8e4',
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
      guardian_muster_standard_spear: 'muster_footman',
      guardian_muster_standard_sword: 'muster_sergeant',
    });
    for (const [guardianId, sourceId] of Object.entries(TRANSIENT_MOB_PORTRAIT_SOURCE_IDS)) {
      expect(targetPortraitSourceId(guardianId, true), guardianId).toBe(sourceId);
      const url = targetPortraitUrl(guardianId, true);
      expect(url, guardianId).toBe(`/ui/mobs/${sourceId}.webp`);
      expect(existsSync(resolve(process.cwd(), `public${url}`)), guardianId).toBe(true);
    }
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
        .filter((id) => targetPortraitUrl(id, true)?.startsWith('/ui/mobs/'))
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

  it('keeps the escortee portraits synchronized with the class body each one draws', () => {
    for (const [mobId, [visualKey, model, acceptedHash]] of Object.entries(
      ESCORTEE_CLASS_BODY_PORTRAITS,
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
      expect(VISUALS[currentVisual]?.wocCharacter, `${mobId} class body`).toBeDefined();
      // a class body takes no entity tint: the template colour never reaches this render
      expect(VISUALS[currentVisual]?.tint, `${mobId} tint source`).toBeUndefined();
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
