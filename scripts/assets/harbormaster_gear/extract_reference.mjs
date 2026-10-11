// Bake a fitting reference for the harbormaster's gear out of the shipped modular body
// (public/models/chars/modular/warrior_modular.glb): the picked parts, unskinned, each
// vertex moved into the BIND-pose frame of one bone (the bone the gear attaches to), so a
// piece authored around the reference lands on the body exactly when the game parents it
// to that bone. Every part in the library carries its own quantization, folded into its
// skin's inverse bind matrices; applying the bone's inverse bind matrix to a part's raw
// positions is therefore exactly "this vertex, seen from the bone at bind pose".
//
//   node scripts/assets/harbormaster_gear/extract_reference.mjs [OUT_DIR]
//
// Writes reference_<bone>.glb per bone (default OUT_DIR tmp/harbormaster_gear, gitignored).
// A preview aid for the builder, whose dimensions are constants (the shipped GLBs never
// depend on this output); tests/harbormaster_gear_asset.test.ts imports the same bone-frame
// math to check the shipped gear still fits the live body.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.join(ROOT, 'public/models/chars/modular/warrior_modular.glb');
const OUT = path.resolve(ROOT, process.argv[2] ?? 'tmp/harbormaster_gear');

/** The harbormaster's composed body (src/render/characters/npc_looks.ts). */
export const REFERENCE_PARTS = [
  'F_Head',
  'F_Ear_round',
  'F_Eye_narrow',
  'F_Brow_thick',
  'F_Mouth_smile',
  'H2_warriorbraid',
  'Armor_mage_Chest',
  'Armor_mage_ArmL',
  'Armor_mage_ArmR',
  'Armor_mage_LegL',
  'Armor_mage_LegR',
  'Armor_mage_FootL',
  'Armor_mage_FootR',
  'Armor_mage_Back',
  'Armor_rogue_HandL',
  'Armor_rogue_HandR',
];
export const REFERENCE_BONES = ['head', 'hips', 'chest'];

function mul(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

/** The shipped modular body, decoded and dequantized (positions stay in each part's own
 *  quantized space: its skin's inverse bind matrices carry the dequantization). */
export async function loadModularBody(file = SRC) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(file);
  await doc.transform(dequantize());
  return doc;
}

/** One part's vertices in `bone`'s bind frame, one Float32Array (xyz) per primitive, with
 *  that primitive's indices. */
export function boneFramePart(doc, name, bone) {
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name || n.getMesh()?.getName() === name);
  const skin = node?.getSkin();
  if (!node || !skin) throw new Error(`no skinned part ${name}`);
  const j = skin.listJoints().findIndex((n) => n.getName() === bone);
  if (j < 0) throw new Error(`${name}: no joint ${bone}`);
  const ibm = skin.getInverseBindMatrices().getElement(j, new Array(16));
  return node
    .getMesh()
    .listPrimitives()
    .map((prim) => {
      const pos = prim.getAttribute('POSITION');
      const out = new Float32Array(pos.getCount() * 3);
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) out.set(mul(ibm, pos.getElement(i, v)), i * 3);
      const idx = prim.getIndices();
      return { positions: out, indices: idx ? new Uint32Array(idx.getArray()) : null };
    });
}

async function main() {
  const src = await loadModularBody();
  mkdirSync(OUT, { recursive: true });
  for (const bone of REFERENCE_BONES) {
    const doc = new Document();
    const buf = doc.createBuffer();
    const scene = doc.createScene('Reference');
    const report = [];
    for (const name of REFERENCE_PARTS) {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      const mesh = doc.createMesh(name);
      for (const { positions, indices } of boneFramePart(src, name, bone)) {
        for (let i = 0; i < positions.length; i++) {
          lo[i % 3] = Math.min(lo[i % 3], positions[i]);
          hi[i % 3] = Math.max(hi[i % 3], positions[i]);
        }
        const prim = doc
          .createPrimitive()
          .setAttribute(
            'POSITION',
            doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buf),
          );
        if (indices) {
          prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buf));
        }
        mesh.addPrimitive(prim);
      }
      scene.addChild(doc.createNode(name).setMesh(mesh));
      const f = (a) => a.map((x) => x.toFixed(3)).join(' ');
      report.push(`${name.padEnd(20)} lo ${f(lo)}  hi ${f(hi)}`);
    }
    const file = path.join(OUT, `reference_${bone}.glb`);
    await new NodeIO().write(file, doc);
    console.log(`# ${bone}-local bind frame -> ${path.relative(ROOT, file)}`);
    for (const line of report) console.log(line);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
