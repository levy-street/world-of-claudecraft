// Build the Ignivar raid dressing props (beams, pillars, the vault door,
// reactor, the Inner Crucible forge and anvil, roof chains, the lava and
// steam machinery) from the maintainer's Tripo drop in tmp/asset_src, at
// the willowfen fidelity recipe: weld + BOUNDED simplify (small error so
// the gear filigree survives; ratio chosen per item from a triangle
// target, with a second looser pass where the tight bound stops short),
// prune, dedup, per-item webp texture sizing, meshopt. Only props with a
// live placement in src/sim/ignivar_props.ts are items: every wired prop
// downloads for every player at world entry, so an unplaced prop is pure
// dead weight (tests/ignivar_dressing_plan_core.test.ts pins the rule,
// and the rest of the drop stays in tmp/asset_src for a later pass).
// Every prop re-shares its baseColor as an emissive map (zero extra texture
// bytes): a faint 0.28 self-light on the plain metals so their detail reads
// in the dim forge grades (the tile-kit carrier trick), and a strong
// overdrive on the lava-bearing props.
// After this, run the mandatory KTX2 step + manifest regen:
//   node scripts/assets/compress_glb_textures.mjs
//   node scripts/build_media_manifest.mjs generate
// Usage: node scripts/assets/build_ignivar_props.mjs [name...]
// With name arguments only those items rebuild (the shipped set stays
// byte-identical; a full run reverts every prop to webp until the KTX2
// step re-runs over all of them).
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ITEMS = [
  { src: '_Outter_Walls/Beam_Large_v02.glb', name: 'beam', target: 1400, tex: 512, emissive: 0.28 },
  // Restored with the Drakelands entrance merge: the approach room's
  // forge-lift shaft dressing places gear_machine, so it ships again.
  {
    src: '_Outter_Walls/GEAR%20MACHINE%201v.glb',
    name: 'gear_machine',
    target: 12000,
    tex: 1024,
    emissive: 0.28,
  },
  {
    src: '_Outter_Walls/GEAR%20VAULT%20DOOR.glb',
    name: 'vault_door',
    target: 12000,
    tex: 1024,
    emissive: 0.28,
  },
  { src: '_Outter_Walls/Pillar_Large.glb', name: 'pillar_slim', tex: 512, emissive: 0.28 },
  { src: '_Outter_Walls/REACTOR.glb', name: 'reactor', target: 12000, tex: 1024, emissive: 1.0 },
  {
    src: '_Outter_Walls/Rusty%20gear%20wall%20.glb',
    name: 'gear_wall_rusty',
    target: 12000,
    tex: 1024,
    emissive: 0.28,
  },
  {
    src: '_Outter_Walls/WALL%20LAVE%20FACE%20V5.glb',
    name: 'lava_face',
    target: 10000,
    tex: 1024,
    emissive: 1.5,
  },
  {
    src: '_Raid_Room/%20ANVIL%20LAVA%20.glb',
    name: 'anvil',
    target: 16000,
    tex: 1024,
    emissive: 1.5,
  },
  { src: '_Raid_Room/Forge.glb', name: 'forge', target: 16000, tex: 1024, emissive: 1.4 },
  { src: '_Roof/Chain.glb', name: 'chain', tex: 512, darken: 0.45 },
  { src: '_Roof/Chain_Hanging.glb', name: 'chain_hanging', tex: 512, darken: 0.45 },
  // The New_Assets drop (2026-08-27) arrives pre-decimated (1k-3k tris), so
  // no simplify targets: weld only, texture sizing and the emissive pass.
  { src: 'New_Assets/Lava_Furnace.glb', name: 'lava_furnace', tex: 1024, emissive: 1.5 },
  { src: 'New_Assets/Press+Machine.glb', name: 'press_machine', tex: 1024, emissive: 1.4 },
  { src: 'New_Assets/Square+Wall.glb', name: 'square_wall', tex: 1024, emissive: 0.28 },
  // The New_Assets_Demi drop (2026-08-27): same pre-decimated contract
  // (~1k tris, single mesh, 1024 atlas). Lava carriers run hot, steam
  // machinery gets the reactor-class accent glow, trim stays plain.
  { src: 'New_Assets_Demi/chain-link.glb', name: 'chain_link', tex: 512, emissive: 0.28 },
  { src: 'New_Assets_Demi/hanging-hook.glb', name: 'hanging_hook', tex: 512, emissive: 0.28 },
  {
    src: 'New_Assets_Demi/industrial-pipe.glb',
    name: 'industrial_pipe',
    tex: 1024,
    emissive: 0.28,
  },
  // The Lava/ pair replaces the first-drop channel models (2026-08-27).
  // Both are authored standing upright (lava bed facing front): rotateX
  // lays them flat so the bed faces up and they read as floor gutters.
  // hotBoost pre-brightens the beds' hot pixels before ETC1S, which
  // otherwise crushes the saturated orange gradients to dark crimson (the
  // known block-compressor trap; whole-file UASTC is not runtime-safe here).
  {
    src: 'New_Assets_Demi/Lava/Lava_Curved.glb',
    name: 'lava_channel_curved',
    tex: 1024,
    emissive: 1.5,
    rotateX: -90,
    hotBoost: 1.35,
  },
  {
    src: 'New_Assets_Demi/Lava/Lava_Straight.glb',
    name: 'lava_channel',
    tex: 1024,
    emissive: 1.5,
    rotateX: -90,
    hotBoost: 1.35,
  },
  { src: 'New_Assets_Demi/lava-outlet.glb', name: 'lava_outlet', tex: 1024, emissive: 1.5 },
  { src: 'New_Assets_Demi/lava-port.glb', name: 'lava_port', tex: 1024, emissive: 1.5 },
  {
    src: 'New_Assets_Demi/steam-machine-round.glb',
    name: 'steam_machine_round',
    tex: 1024,
    emissive: 1.0,
  },
  { src: 'New_Assets_Demi/steam-pipes.glb', name: 'steam_pipes', tex: 1024, emissive: 0.28 },
  // The Exterior_Assets drop (2026-08-28): the Forgefather's Isle fortress
  // kit (the bridge trio, towers, gate and gear, walls, stairs, floors,
  // the dragon lava spouts, lava carriers, a cannon). Same pre-decimated
  // contract (~1k tris, single mesh, one atlas). Lava carriers run hot,
  // the dragon head pours (concept art), plain stonework stays faint.
  {
    src: 'Exterior_Assets/bridge_floor.glb',
    name: 'bridge_floor',
    tex: 1024,
    emissive: 0.28,
    glowFloor: [89, 22, 14],
  },
  {
    src: 'Exterior_Assets/bridge_pillar.glb',
    name: 'bridge_pillar',
    tex: 1024,
    emissive: 0.28,
    glowFloor: [89, 22, 14],
  },
  // The rail's brazier flame glows like the firepit's: hotBoost lifts the
  // flame texels clear of the ETC1S crush and the firepit-grade emissive
  // strength makes them bloom, while the dark iron stays inert (a near
  // black texel contributes nothing through base-as-emissive).
  {
    src: 'Exterior_Assets/bridge_rail.glb',
    name: 'bridge_rail',
    tex: 512,
    emissive: 1.6,
    hotBoost: 1.35,
    glowFloor: [16, 4, 3],
  },
  {
    src: 'Exterior_Assets/cannon.glb',
    name: 'cannon',
    tex: 1024,
    emissive: 0.6,
    hotBoost: 1.25,
    glowFloor: [42, 10, 7],
  },
  {
    src: 'Exterior_Assets/dragon_head.glb',
    name: 'dragon_head',
    tex: 1024,
    emissive: 1.5,
    glowFloor: [17, 4, 3],
  },
  // The owner's raid-door facade (2026-08-29 drop): architecture tier.
  {
    src: 'Exterior_Assets/dungeon_entrance.glb',
    name: 'dungeon_entrance',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Exterior_Assets/dragon_pillar.glb',
    name: 'dragon_pillar',
    tex: 1024,
    emissive: 1.0,
    hotBoost: 1.25,
    glowFloor: [25, 6, 4],
  },
  {
    src: 'Exterior_Assets/fortress_wall.glb',
    name: 'fortress_wall',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Exterior_Assets/fountain_base.glb',
    name: 'fountain_base',
    tex: 1024,
    emissive: 1.0,
    glowFloor: [25, 6, 4],
  },
  {
    src: 'Exterior_Assets/gate.glb',
    name: 'gate',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Exterior_Assets/gate_gear.glb',
    name: 'gate_gear',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  // The owner's forge-lift car kit (2026-08-29 drop): the antechamber's
  // iron furniture, all on the architecture sheen tier.
  {
    src: 'Lift_Assets/lift_arch_beam.glb',
    name: 'lift_arch_beam',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Lift_Assets/lift_beam.glb',
    name: 'lift_beam',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Lift_Assets/lift_frame.glb',
    name: 'lift_frame',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Lift_Assets/lift_handle.glb',
    name: 'lift_handle',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Lift_Assets/lift_vertical_beam.glb',
    name: 'lift_vertical_beam',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Lift_Assets/lift_weight.glb',
    name: 'lift_weight',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  // The winch remake (2026-08-29 second drop): the owner split the piece so
  // only the spool turns; the mount is the static cradle it rides in. The
  // one-piece winch and the sliding door left the shipped set with the
  // owner's third drop (zero placements; sources stay archived in
  // tmp/asset_src for a future return).
  {
    src: 'Lift_Assets/lift_mount.glb',
    name: 'lift_mount',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Lift_Assets/lift_spool.glb',
    name: 'lift_spool',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  // lava_furnace_2 (src Exterior_Assets/Lava_Furnace.glb) and lava_ramp
  // (src Exterior_Assets/lava_ramp.glb) are STRIPPED from the shipped set:
  // zero placements in any sim table, and the furnace's mesh is
  // byte-identical to the interior lava_furnace. Their sources stay in
  // tmp/asset_src; restore a build entry here (emissive 1.5, glowFloor
  // [17, 4, 3], hotBoost 1.35 for the ramp) plus the loader rows if the
  // owner ever places one, and the hygiene pin in
  // tests/ignivar_asset_hygiene.test.ts will hold it to a real placement.
  {
    src: 'Exterior_Assets/lava_pillar.glb',
    name: 'lava_pillar',
    tex: 1024,
    emissive: 1.5,
    glowFloor: [17, 4, 3],
  },
  {
    src: 'Exterior_Assets/staircase.glb',
    name: 'staircase',
    tex: 1024,
    emissive: 0.28,
    glowFloor: [89, 22, 14],
  },
  {
    src: 'Exterior_Assets/stone_floor.glb',
    name: 'stone_floor',
    tex: 1024,
    emissive: 0.28,
    glowFloor: [89, 22, 14],
  },
  // The fortress architecture's warm details (window slits, rune trims)
  // glow softly at night: gentle hotBoost plus sub-lava emissive; stone
  // texels stay near black, so base-as-emissive leaves the masonry inert.
  {
    src: 'Exterior_Assets/tower_base.glb',
    name: 'tower_base',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Exterior_Assets/tower_middle.glb',
    name: 'tower_middle',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Exterior_Assets/tower_pillar.glb',
    name: 'tower_pillar',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
  {
    src: 'Exterior_Assets/tower_top.glb',
    name: 'tower_top',
    tex: 1024,
    emissive: 0.7,
    hotBoost: 1.25,
    glowFloor: [36, 9, 6],
  },
];
const SRC_DIR = 'tmp/asset_src/_IGNAR_Environment_Assets';
const OUT_DIR = 'public/models/dungeon';

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

function countTris(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += idx ? idx.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3;
    }
  return tris;
}

const only = process.argv.slice(2);
const unknown = only.filter((name) => !ITEMS.some((item) => item.name === name));
if (unknown.length) throw new Error(`unknown item name(s): ${unknown.join(', ')}`);

for (const item of ITEMS) {
  if (only.length && !only.includes(item.name)) continue;
  const doc = await io.read(path.join(SRC_DIR, item.src));
  const before = countTris(doc);
  if (item.target && item.target < before) {
    await doc.transform(
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: item.target / before, error: 0.009 }),
    );
    const mid = countTris(doc);
    if (mid > item.target * 1.4)
      await doc.transform(
        simplify({ simplifier: MeshoptSimplifier, ratio: item.target / mid, error: 0.03 }),
      );
  } else {
    await doc.transform(weld());
  }
  await doc.transform(
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [item.tex, item.tex] }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const root = doc.getRoot();
  if (item.hotBoost) {
    // Feathered per-pixel lift of the hot (lava) range only: the iron stays
    // put while the bed's oranges go in bright enough that the ETC1S crush
    // lands them where the artist authored them.
    for (const tex of root.listTextures()) {
      const { data, info } = await sharp(Buffer.from(tex.getImage()))
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < info.width * info.height; i++) {
        const at = i * info.channels;
        const r = data[at];
        const b = data[at + 2];
        if (r <= 100 || r <= b * 2) continue;
        const t = Math.min(1, (r - 100) / 60);
        const lift = 1 + (item.hotBoost - 1) * t;
        data[at] = Math.min(255, Math.round(r * lift));
        data[at + 1] = Math.min(255, Math.round(data[at + 1] * lift));
      }
      const boosted = await sharp(data, {
        raw: { width: info.width, height: info.height, channels: info.channels },
      })
        .webp({ quality: 92 })
        .toBuffer();
      tex.setImage(new Uint8Array(boosted));
      tex.setMimeType('image/webp');
    }
  }
  if (item.darken) {
    // Bright steel sources read white in the dark forge grades: multiply the
    // albedo down to dark iron before compression.
    for (const tex of root.listTextures()) {
      const darkened = await sharp(Buffer.from(tex.getImage()))
        .modulate({ brightness: item.darken, saturation: 0.9 })
        .webp({ quality: 90 })
        .toBuffer();
      tex.setImage(new Uint8Array(darkened));
      tex.setMimeType('image/webp');
    }
  }
  if (item.rotateX) {
    // Node-level rotation: the runtime template loader bakes world matrices
    // into the canonical geometry, so an authored-upright model lies flat.
    const half = (item.rotateX * Math.PI) / 360;
    for (const node of root.listNodes())
      if (node.getMesh()) node.setRotation([Math.sin(half), 0, 0, Math.cos(half)]);
  }
  for (const node of root.listNodes())
    if (node.getName().startsWith('tripo_')) node.setName(item.name);
  for (const mesh of root.listMeshes()) mesh.setName(item.name);
  for (const mat of root.listMaterials()) {
    mat.setName(item.name);
    if (item.emissive) {
      const base = mat.getBaseColorTexture();
      if (base && !mat.getEmissiveTexture()) {
        if (item.glowFloor) {
          // The whole piece carries a soft glow: the emissive texture is
          // the base albedo FLOORED per channel at glowFloor, so dark
          // masonry emits the floor's warm sheen while authored hot
          // details keep their extra brightness. (Base-as-emissive alone
          // leaves near-black stone inert, which read as a pitch-dark
          // fortress against lamp-lit ground.)
          const [fr, fg, fb] = item.glowFloor;
          const { data, info } = await sharp(Buffer.from(base.getImage()))
            .raw()
            .toBuffer({ resolveWithObject: true });
          for (let i = 0; i < info.width * info.height; i++) {
            const px = i * info.channels;
            if (data[px] < fr) data[px] = fr;
            if (data[px + 1] < fg) data[px + 1] = fg;
            if (data[px + 2] < fb) data[px + 2] = fb;
          }
          // The sheen is low-frequency: half-resolution keeps the pieces
          // inside the per-prop byte budget with no visible cost.
          const floored = await sharp(data, {
            raw: { width: info.width, height: info.height, channels: info.channels },
          })
            .resize(Math.min(512, info.width))
            .webp({ quality: 88 })
            .toBuffer();
          const glowTex = doc
            .createTexture(`${item.name}_glow`)
            .setImage(new Uint8Array(floored))
            .setMimeType('image/webp');
          mat.setEmissiveTexture(glowTex);
        } else {
          mat.setEmissiveTexture(base);
        }
        // Spec-valid overdrive: emissiveFactor stays in [0,1], the boost
        // rides KHR_materials_emissive_strength.
        mat.setEmissiveFactor([1, 1, 1]);
        const strengthExt = doc.createExtension(KHRMaterialsEmissiveStrength);
        mat.setExtension(
          'KHR_materials_emissive_strength',
          strengthExt.createEmissiveStrength().setEmissiveStrength(item.emissive),
        );
      }
    }
  }
  const outPath = path.join(OUT_DIR, `ignivar_prop_${item.name}.glb`);
  await io.write(outPath, doc);
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(
    `ignivar_prop_${item.name}: ${Math.round(before / 1000)}k -> ${Math.round(countTris(doc) / 1000)}k tris, ${kb}KB`,
  );
}
