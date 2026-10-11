// Evaluates every exported frame of the hand-keyed libraries after compression
// and measures each melee swing's contact: the peak of the weapon point's speed
// (0.3 along the hand slot) between 15% and 70% of the clip.
//
//   node scripts/assets/woc_keyed_anims/validate.mjs                  shipped libraries
//   node scripts/assets/woc_keyed_anims/validate.mjs --write-contacts and write
//       src/render/characters/woc_autoattack_contacts.json from them
//   node scripts/assets/woc_keyed_anims/validate.mjs --all [dir]      a --all review build
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder } from 'meshoptimizer';
import { AnimationMixer, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CATALOG, SHIPPED_CLIPS } from './catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const all = process.argv[2] === '--all';
const writeContacts = process.argv.includes('--write-contacts');
const output = all
  ? path.resolve(root, process.argv[3] ?? 'tmp/woc_keyed_anims')
  : path.join(root, 'public/models/chars/players/woc_keyed');
const expected = all ? Object.keys(CATALOG) : [...SHIPPED_CLIPS];
await MeshoptDecoder.ready;
const contactsByFit = {};
let evaluated = 0;
for (const fit of ['male', 'female']) {
  const bytes = fs.readFileSync(path.join(output, `woc_${fit}.glb`));
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  assert.deepEqual(gltf.animations.map((a) => a.name).sort(), expected.sort());
  const mixer = new AnimationMixer(gltf.scene);
  const fitContacts = {};
  for (const clip of gltf.animations) {
    assert(clip.validate(), clip.name);
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const intent = CATALOG[clip.name];
    const melee = intent.family === 'attack' && !['bow', 'rifle', 'thrown'].includes(intent.weapon);
    const sides = intent.dual === 'pair' ? ['r', 'l'] : [intent.side];
    const previous = {},
      peaks = {},
      contacts = {};
    const frames = Math.round(clip.duration * 60);
    for (let frame = 0; frame <= frames; frame++) {
      mixer.setTime((clip.duration * frame) / frames);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((n) =>
        assert(n.matrixWorld.elements.every(Number.isFinite), `${fit}/${clip.name}/${n.name}`),
      );
      if (!melee) continue;
      for (const side of sides) {
        const point = gltf.scene
          .getObjectByName(`handslot${side}`)
          .localToWorld(new Vector3(0, 0.3, 0));
        const speed = previous[side] ? point.distanceTo(previous[side]) : 0;
        if (frame / frames >= 0.15 && frame / frames <= 0.7 && speed > (peaks[side] ?? 0)) {
          peaks[side] = speed;
          contacts[side] = Math.round((1000 * (frame - 0.5) * clip.duration) / frames) / 1000;
        }
        previous[side] = point;
      }
    }
    if (melee) fitContacts[clip.name] = sides.map((side) => contacts[side]);
    evaluated++;
  }
  // The pair's two blades and the lone halves land on one frame, so the hit
  // table needs one contact for all three.
  const dual = ['Woc_Attack_Dual#main', 'Woc_Attack_Dual#off', 'Woc_Attack_Dual'].flatMap(
    (n) => fitContacts[n] ?? [],
  );
  assert.equal(new Set(dual).size, 1, `${fit}: dual half/pair hit times disagree`);
  contactsByFit[fit] = Object.fromEntries(
    Object.entries(fitContacts).sort(([a], [b]) => a.localeCompare(b)),
  );
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
}
if (writeContacts) {
  assert(!all, 'contacts are written from the shipped libraries only');
  fs.writeFileSync(
    path.join(root, 'src/render/characters/woc_autoattack_contacts.json'),
    `${JSON.stringify(contactsByFit, null, 2)}\n`,
  );
}
console.log(`${evaluated} compressed clips evaluated; dual contacts aligned on both fits`);
for (const [fit, contacts] of Object.entries(contactsByFit))
  console.log(
    fit,
    Object.entries(contacts)
      .map(([n, c]) => `${n} ${c.join('/')}`)
      .join(', '),
  );
