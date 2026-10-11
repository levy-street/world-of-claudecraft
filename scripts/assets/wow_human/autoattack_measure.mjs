import { MeshoptDecoder } from 'meshoptimizer';
import { AnimationMixer, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Measure the shipped, compressed tracks at runtime float precision. */
export async function measureAutoContacts(bytes) {
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const mixer = new AnimationMixer(gltf.scene),
    result = {};
  for (const clip of gltf.animations) {
    if (/Rifle|Bow|Thrown/.test(clip.name)) continue;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const sides =
      clip.name === 'WoW_AutoDual' ? ['r', 'l'] : [/Off|#off/.test(clip.name) ? 'l' : 'r'];
    const frames = Math.round(clip.duration * 60),
      fps = frames / clip.duration;
    const tips = sides.map(() => []);
    for (let f = 0; f <= frames; f++) {
      mixer.setTime(f / fps);
      gltf.scene.updateMatrixWorld(true);
      for (const [i, side] of sides.entries())
        tips[i].push(
          gltf.scene.getObjectByName(`handslot${side}`).localToWorld(new Vector3(0, 0.3, 0)),
        );
    }
    result[clip.name] = tips.map((points) => {
      let peak = -1,
        at = 0;
      for (let f = 1; f <= frames; f++) {
        if (f / frames < 0.15 || f / frames > 0.7) continue;
        const speed = points[f].distanceTo(points[f - 1]);
        if (speed > peak) {
          peak = speed;
          at = (f - 0.5) / fps;
        }
      }
      return Math.round(at * 1000) / 1000;
    });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
  const dual = ['WoW_AutoDual#main', 'WoW_AutoDual#off', 'WoW_AutoDual'].flatMap((n) => result[n]);
  if (new Set(dual).size !== 1) throw Error('Compressed dual contacts no longer align');
  return result;
}
