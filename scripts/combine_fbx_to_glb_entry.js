// Browser-side merge: parse N FBX files with three.js FBXLoader, pick the one
// that carries the skinned mesh as the base, graft every other FBX's animation
// clips onto it by bone name, optionally apply an external base-color texture
// (or preserve the FBX's own embedded one), and export a single binary GLB.
//
// Bundled by combine_fbx_to_glb.mjs (esbuild) and run in headless Chrome, so it
// uses the SAME loader the game uses -- which is why it handles FBX skinning and
// embedded textures that standalone Node FBX->glTF converters choke on.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

function b64ToAB(b64) {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a.buffer;
}
function abToB64(ab) {
  const bytes = new Uint8Array(ab);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
// Lock root (Hips) horizontal translation to frame 0 so a locomotion cycle plays
// in place; keep Y so a vertical bob / death-fall is preserved.
function stripRootXZ(clip) {
  for (const tr of clip.tracks) {
    if (/Hips\.position$/i.test(tr.name)) {
      const v = tr.values;
      const x0 = v[0],
        z0 = v[2];
      for (let i = 0; i < v.length; i += 3) {
        v[i] = x0;
        v[i + 2] = z0;
      }
    }
  }
}
// Drop the skeleton-root (Armature) transform tracks so every clip inherits the
// base model's orientation instead of whatever up-axis its export baked ("cooked
// axis" fix).
function stripArmature(clip) {
  clip.tracks = clip.tracks.filter(
    (tr) => !/(^|[^A-Za-z])Armature\.(quaternion|position|scale)$/.test(tr.name),
  );
}
function loadImage(dataUrl) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('image decode failed'));
    img.src = dataUrl;
  });
}

// files: [{ name, b64 }]  (name = the clip name to use for that file's clip(s))
// opts:  { externalTexB64?, targetHeight?, stripRoot?, stripArmature?, restClip?,
//          restT?, flipY?, minDur?, allClips? }
window.combine = async (files, opts) => {
  const dbg = { files: files.length };
  const minDur = opts.minDur ?? 0.1;

  // Parse every FBX; the first one with a skinned mesh is the base model.
  const parsed = files.map((f) => ({
    name: f.name,
    group: new FBXLoader().parse(b64ToAB(f.b64), ''),
  }));
  const baseEntry =
    parsed.find((p) => {
      let has = false;
      p.group.traverse((o) => {
        if (o.isSkinnedMesh || (o.isMesh && o.skeleton)) has = true;
      });
      return has;
    }) || parsed[0];
  const base = baseEntry.group;
  base.updateMatrixWorld(true);
  dbg.base = baseEntry.name;

  // Collect clips from every FBX (base first), naming them from the file. Skip
  // junk takes shorter than minDur (e.g. a 0.03s bind-pose snapshot).
  const clips = [];
  const addFrom = (entry) => {
    const anims = (entry.group.animations || []).filter((c) => c.duration >= minDur);
    const take = opts.allClips ? anims : anims.slice(0, 1);
    take.forEach((clip, i) => {
      const meaningful =
        clip.name && !/^mixamo\.com/i.test(clip.name) && !/^Armature\|/i.test(clip.name);
      clip.name = take.length > 1 ? (meaningful ? clip.name : `${entry.name}_${i}`) : entry.name;
      clips.push(clip);
    });
  };
  addFrom(baseEntry);
  for (const e of parsed) if (e !== baseEntry) addFrom(e);
  dbg.preFix = clips.map((c) => `${c.name}(${c.duration.toFixed(2)}s)`);

  // Per-clip fixups.
  for (const c of clips) {
    if (opts.stripArmature) stripArmature(c);
    if (opts.stripRoot) stripRootXZ(c);
  }

  // Texture: external base-color PNG if given, else preserve the FBX's own
  // embedded texture (FBXLoader decodes it async -> wait, then bake to canvas so
  // GLTFExporter can serialize it).
  const mats = new Set();
  base.traverse((o) => {
    if (o.isMesh) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m) mats.add(m);
      }
    }
  });
  if (opts.externalTexB64) {
    const img = await loadImage(`data:image/png;base64,${opts.externalTexB64}`);
    dbg.texSize = `${img.width}x${img.height} (external)`;
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    cv.getContext('2d').drawImage(img, 0, 0);
    for (const m of mats) {
      const srcFlipY = m.map ? m.map.flipY : undefined;
      const tex = new THREE.CanvasTexture(cv);
      tex.flipY = opts.flipY != null ? opts.flipY : srcFlipY != null ? srcFlipY : true;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      m.map = tex;
      if (m.color) m.color.set(0xffffff);
      m.emissiveMap = m.normalMap = m.roughnessMap = m.metalnessMap = m.aoMap = null;
      m.transparent = false;
      m.alphaTest = 0;
      m.needsUpdate = true;
    }
  } else {
    const mapped = [...mats].filter((m) => m.map);
    const t0 = performance.now();
    while (mapped.some((m) => !m.map.image?.width) && performance.now() - t0 < 10000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    let kept = 0;
    for (const m of mats) {
      const src = m.map;
      if (src?.image?.width) {
        const img = src.image;
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = img.height;
        cv.getContext('2d').drawImage(img, 0, 0);
        const tex = new THREE.CanvasTexture(cv);
        tex.flipY = src.flipY;
        tex.colorSpace = src.colorSpace || THREE.SRGBColorSpace;
        tex.wrapS = src.wrapS;
        tex.wrapT = src.wrapT;
        m.map = tex;
        kept++;
      } else m.map = null;
      m.emissiveMap = m.normalMap = m.roughnessMap = m.metalnessMap = m.aoMap = null;
    }
    dbg.texSize = kept ? 'embedded' : 'none';
  }

  // Optional height normalization.
  const box = new THREE.Box3().setFromObject(base);
  dbg.nativeHeight = +(box.max.y - box.min.y).toFixed(2);
  if (opts.targetHeight) {
    const s = opts.targetHeight / (box.max.y - box.min.y);
    base.scale.multiplyScalar(s);
    base.updateMatrixWorld(true);
    dbg.scale = +s.toFixed(5);
  }

  base.animations = clips;
  dbg.clips = clips.map((c) => `${c.name}(${c.duration.toFixed(2)}s,${c.tracks.length}tr)`);

  // Optional: bake the bind/rest pose to an idle frame so it never shows a T-pose
  // when un-animated.
  if (opts.restClip != null && opts.restT != null) {
    const idle = clips.find((c) => c.name === opts.restClip) || clips[0];
    if (idle) {
      const mixer = new THREE.AnimationMixer(base);
      mixer.clipAction(idle).play();
      mixer.update(opts.restT);
      base.updateMatrixWorld(true);
      dbg.posedAt = `${idle.name}@${opts.restT}`;
    }
  }

  const glb = await new Promise((res, rej) =>
    new GLTFExporter().parse(base, res, rej, {
      binary: true,
      animations: clips,
      onlyVisible: false,
    }),
  );
  return { b64: abToB64(glb), dbg };
};
window.__ready = true;
