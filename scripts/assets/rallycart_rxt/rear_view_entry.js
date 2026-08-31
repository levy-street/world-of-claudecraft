// Browser half of the rear-view renderer: draw the mount from behind through a
// KNOWN orthographic camera, so a pixel maps back to a model coordinate by
// arithmetic instead of by fitting.
//
// Orthographic is the whole point. Under a perspective camera, recovering the
// model coordinate behind a pixel needs the depth at that pixel, which drags in
// exactly the geometry-fitting problem this exists to avoid. Under ortho, x and
// y are linear in the pixel and the only unknown left is depth ALONG the view
// axis, which a single raycast answers. Mark a shape by eye, cast it back, done:
// no unwrap, no surface fit, no argument with the triangle soup.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { attachKtx2 } from '../../lib/ktx2_entry.js';

/**
 * Build one tail lamp lens.
 *
 * THE SHAPE IS IMPOSED, THE SURFACE IS MEASURED. That split is the whole idea,
 * and it is what every earlier attempt got wrong by trying to trace an outline
 * out of artifacted paint on triangle soup.
 *
 *  - The OUTLINE is a superellipse in (angle, height): a rounded rectangle,
 *    which is what a tail lamp actually is. Nothing about it comes from the
 *    mesh, so nothing about it can be ragged.
 *  - The SURFACE comes from casting a ray inward at every point of that
 *    outline and taking where it hits the bodywork, plus a small offset along
 *    the HIT NORMAL. So the lens hugs whatever curvature is really there.
 *
 * Sweeping about a VERTICAL AXIS is what handles the 81 degree wrap around the
 * corner for free: the lamp is simply an angular span about that axis, so the
 * part on the rear panel and the part on the flank are the same parameter
 * range. A height field over (x, y) cannot express that and was the earlier
 * "piece hanging off the side".
 */
function buildLensGeometry(THREE, target, cfg) {
  const { axisX, axisZ, angle0, angle1, y0, y1, gap, round, segU, segV, castFrom } = cfg;
  const raycaster = new THREE.Raycaster();

  // Pass 1: cast, and keep only the DEPTH (distance from the sweep axis). Depth
  // is the only thing the body has to tell us; angle and height are ours.
  const depth = [];
  const angles = [];
  const heights = [];
  const widthAt = [];
  let missed = 0;
  for (let iv = 0; iv <= segV; iv++) {
    // Rows CLUSTERED toward the caps, matching vehicle_taillights.ts. Even
    // spacing dropped this outline's whole top and bottom closure into a single
    // quad, which rendered as a spike at the corner instead of a flat cap.
    const t = Math.sin((Math.PI / 2) * ((iv / segV) * 2 - 1));
    const sMax = (1 - Math.abs(t) ** round) ** (1 / round);
    widthAt.push(sMax > 0 ? sMax : 0);
    const y = (y0 + y1) / 2 + t * ((y1 - y0) / 2);
    heights.push(y);
    const row = [];
    const arow = [];
    for (let iu = 0; iu <= segU; iu++) {
      const s = ((iu / segU) * 2 - 1) * (sMax > 0 ? sMax : 0);
      const angle = (angle0 + angle1) / 2 + s * ((angle1 - angle0) / 2);
      arow.push(angle);
      const out = new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle));
      const origin = new THREE.Vector3(axisX, y, axisZ).addScaledVector(out, castFrom);
      raycaster.set(origin, out.clone().multiplyScalar(-1));
      const hit = raycaster.intersectObject(target, true)[0];
      if (!hit) {
        missed++;
        row.push(null);
        continue;
      }
      row.push(castFrom - hit.distance);
    }
    depth.push(row);
    angles.push(arow);
  }

  // Fill any miss from its neighbours so a hole cannot tear the sheet.
  for (let iv = 0; iv <= segV; iv++) {
    for (let iu = 0; iu <= segU; iu++) {
      if (depth[iv][iu] !== null) continue;
      let sum = 0;
      let n = 0;
      for (const [dv, du] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const r = depth[iv + dv]?.[iu + du];
        if (typeof r === 'number') {
          sum += r;
          n++;
        }
      }
      depth[iv][iu] = n ? sum / n : 0.12;
    }
  }

  // Pass 2: SMOOTH the depth. This is the difference between a lens and a
  // shrink-wrap. The raycast follows every facet and dent of a mesh with no
  // edge flow, and a lens that copies those reads as the same mess it was
  // meant to cover, with the body poking through wherever the surface dips.
  // Blurring the depth keeps the real curvature, including the wrap, and drops
  // the noise. The SHAPE was never taken from the mesh; now the surface is only
  // loosely taken from it too.
  for (let pass = 0; pass < (cfg.smooth ?? 3); pass++) {
    const src = depth.map((r) => r.slice());
    for (let iv = 0; iv <= segV; iv++) {
      for (let iu = 0; iu <= segU; iu++) {
        let sum = 0;
        let n = 0;
        for (let dv = -1; dv <= 1; dv++) {
          for (let du = -1; du <= 1; du++) {
            const r = src[iv + dv]?.[iu + du];
            if (typeof r === 'number') {
              sum += r;
              n++;
            }
          }
        }
        depth[iv][iu] = sum / n;
      }
    }
  }

  const rows = [];
  for (let iv = 0; iv <= segV; iv++) {
    if (widthAt[iv] <= 0) {
      rows.push(null);
      continue;
    }
    const row = [];
    for (let iu = 0; iu <= segU; iu++) {
      const angle = angles[iv][iu];
      const out = new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle));
      // Offset RADIALLY from the sweep axis rather than along a per-face
      // normal. On a surface that is roughly cylindrical about that axis, which
      // is exactly what a wrapped corner is, radial IS the normal, and unlike a
      // face normal it cannot jitter from one facet to the next.
      row.push(
        new THREE.Vector3(axisX, heights[iv], axisZ).addScaledVector(out, depth[iv][iu] + gap),
      );
    }
    rows.push(row);
  }

  const position = [];
  const index = [];
  const rowStart = [];
  for (const row of rows) {
    rowStart.push(row ? position.length / 3 : -1);
    if (!row) continue;
    for (const p of row) position.push(p.x, p.y, p.z);
  }
  for (let iv = 0; iv + 1 < rows.length; iv++) {
    const a = rowStart[iv];
    const b = rowStart[iv + 1];
    if (a < 0 || b < 0) continue;
    for (let iu = 0; iu < segU; iu++) {
      index.push(a + iu, a + iu + 1, b + iu + 1);
      index.push(a + iu, b + iu + 1, b + iu);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geom.setIndex(index);
  geom.computeVertexNormals();
  return { geom, missed };
}

window.renderRear = (glbBase64, view, px, pxH) =>
  new Promise((resolve, reject) => {
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(px, pxH ?? px, false);
      renderer.setClearColor(0x101012, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      // Flat, even light. This is a measuring image, not a beauty shot: strong
      // key light would put the lamp in shadow on one side and invite marking
      // the shading rather than the lamp.
      scene.add(new THREE.AmbientLight(0xffffff, 1.5));
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(-2, 3, -4);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.8);
      fill.position.set(3, 1, -3);
      scene.add(fill);

      // The model's textures are KTX2; the driver injects the transcoder because
      // this page has no origin to fetch /basis/ from.
      const loader = attachKtx2(new GLTFLoader(), renderer);

      const bin = Uint8Array.from(atob(glbBase64), (c) => c.charCodeAt(0));
      loader.parse(
        bin.buffer,
        '',
        (gltf) => {
          try {
            const obj = gltf.scene;
            scene.add(obj);
            obj.updateWorldMatrix(true, true);

            // The frame is given in MODEL units by the caller, not derived from
            // a bounding box, so the pixel-to-model mapping is fixed and known
            // rather than something that shifts when the model changes.
            const { left, right, bottom, top, yaw, pitch } = view;
            // An orthographic frustum is expressed around the CAMERA, not in
            // world space, so it has to be half-extents with the camera parked
            // at the middle of the frame. Passing the world bounds straight in
            // silently offsets the view by the frame's own centre, which shifts
            // the car up and crops the very thing being measured.
            const halfW = (right - left) / 2;
            const halfH = (top - bottom) / 2;
            const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 100);

            // Sit behind the car and look toward its nose (+z is forward).
            const target = new THREE.Vector3((left + right) / 2, (top + bottom) / 2, 0);
            const dir = new THREE.Vector3(0, 0, -1)
              .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw ?? 0)
              .applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch ?? 0);
            cam.position.copy(target).addScaledVector(dir, 5);
            cam.up.set(0, 1, 0);
            cam.lookAt(target);
            cam.updateMatrixWorld(true);
            cam.updateProjectionMatrix();

            // Optional lens preview, so the shape can be judged by eye against
            // the car it has to sit on.
            let missedTotal = 0;
            for (const lens of view.lenses ?? []) {
              // TWO LAYERS, and the first one is the point.
              //
              // A single additive sheet cannot hide anything: additive only ever
              // adds light, so the artifacted paint shows straight through it and
              // red over blue reads as magenta. The BODY layer is opaque, so it
              // covers the mess outright, which is half of why the lens exists.
              // The GLOW layer then sits a hair proud of it and does the lit
              // part, which is what additive is actually good at.
              const body = buildLensGeometry(THREE, obj, lens);
              missedTotal += body.missed;
              scene.add(
                new THREE.Mesh(
                  body.geom,
                  new THREE.MeshBasicMaterial({
                    color: new THREE.Color(lens.bodyColor ?? 0x8e0b06),
                    side: THREE.DoubleSide,
                  }),
                ),
              );
              const glow = buildLensGeometry(THREE, obj, {
                ...lens,
                gap: (lens.gap ?? 0.005) + (lens.glowGap ?? 0.004),
              });
              scene.add(
                new THREE.Mesh(
                  glow.geom,
                  new THREE.MeshBasicMaterial({
                    color: new THREE.Color(lens.glowColor ?? 0xff3a10),
                    transparent: true,
                    opacity: lens.glowOpacity ?? 0.7,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                    side: THREE.DoubleSide,
                  }),
                ),
              );
            }
            window.__lensMissed = missedTotal;

            renderer.render(scene, cam);
            resolve(renderer.domElement.toDataURL('image/png'));
          } catch (e) {
            reject(e);
          }
        },
        reject,
      );
    } catch (e) {
      reject(e);
    }
  });

window.__ready = true;
