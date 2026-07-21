// Bake the KayKit Rig_Medium animation clip set into the Combat Mech GLB.
//
// The Combat Mech model (`CombatMech.glb`) is rigged to the *exact* same
// KayKit `Rig_Medium` skeleton as every other player class (23 joints, identical
// bone names: hips/spine/chest/head/upperarm.* / ... / root) but ships with ZERO
// animation clips, so it renders as a frozen T-pose. Every other player GLB
// carries its own clip set baked in; this script makes the mech match by copying
// the donor's animations (retargeted onto the mech's identically-named bones) so
// the mech becomes self-contained — no special-case loader path required.
//
// The donor (knight.glb) is meshopt-compressed; the mech is plain/uncompressed.
// We decode the donor, copy only the animation samplers/channels (as plain
// accessors) onto the mech document, and re-emit the mech uncompressed (its
// original form). Mesh, material, skin and node graph are untouched.
//
//   node scripts/bake_mech_anims.mjs [donor.glb] [target.glb]
//
// Defaults bake knight.glb -> CombatMech.glb in place.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DONOR = process.argv[2] ?? resolve(ROOT, 'public/models/chars/players/knight.glb');
const TARGET = process.argv[3] ?? resolve(ROOT, 'public/models/chars/players/Mech/characters/CombatMech.glb');

async function main() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const donor = await io.read(DONOR);
  const target = await io.read(TARGET);

  // Idempotent: drop any clips already on the target so re-running (e.g. after a
  // fresh mech re-export, or a second pass of this script) never duplicates them.
  const existing = target.getRoot().listAnimations();
  if (existing.length) {
    console.log(`  clearing ${existing.length} existing clip(s) on the target before re-baking`);
    for (const anim of existing) anim.dispose();
  }

  // Map the mech's nodes by name so donor channels retarget onto matching bones.
  const targetNodesByName = new Map();
  for (const node of target.getRoot().listNodes()) {
    const name = node.getName();
    if (targetNodesByName.has(name)) {
      console.warn(`  ! duplicate target node name "${name}" — retarget may be ambiguous`);
    }
    targetNodesByName.set(name, node);
  }

  // Single buffer for the appended animation accessors (mech has exactly one).
  const buffer = target.getRoot().listBuffers()[0] ?? target.createBuffer();

  // Clone an accessor's decoded data into the target document.
  const cloneAccessor = (src) => target.createAccessor(src.getName())
    .setType(src.getType())
    .setArray(src.getArray().slice())
    .setNormalized(src.getNormalized())
    .setBuffer(buffer);

  let copiedAnims = 0;
  let copiedChannels = 0;
  const skipped = new Set();

  for (const srcAnim of donor.getRoot().listAnimations()) {
    const anim = target.createAnimation(srcAnim.getName());

    // Copy samplers first; keep a src->dst map to wire channels.
    const samplerMap = new Map();
    for (const srcSampler of srcAnim.listSamplers()) {
      const sampler = target.createAnimationSampler()
        .setInterpolation(srcSampler.getInterpolation())
        .setInput(cloneAccessor(srcSampler.getInput()))
        .setOutput(cloneAccessor(srcSampler.getOutput()));
      samplerMap.set(srcSampler, sampler);
      anim.addSampler(sampler);
    }

    for (const srcChannel of srcAnim.listChannels()) {
      const srcNode = srcChannel.getTargetNode();
      const name = srcNode ? srcNode.getName() : '(none)';
      const dstNode = name ? targetNodesByName.get(name) : null;
      if (!dstNode) { skipped.add(name); continue; } // bone absent on the mech
      const channel = target.createAnimationChannel()
        .setTargetNode(dstNode)
        .setTargetPath(srcChannel.getTargetPath())
        .setSampler(samplerMap.get(srcChannel.getSampler()));
      anim.addChannel(channel);
      copiedChannels++;
    }
    copiedAnims++;
  }

  await io.write(TARGET, target);

  console.log(`Baked ${copiedAnims} clips (${copiedChannels} channels) from`);
  console.log(`  donor:  ${DONOR}`);
  console.log(`  target: ${TARGET}`);
  if (skipped.size) {
    console.log(`  skipped channels targeting bones absent on the mech: ${[...skipped].join(', ')}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
