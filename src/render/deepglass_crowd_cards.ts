// The Deepglass crowd: thousands of animated cutout fans filling the bowl.
//
// Rocket League's trick, on WOC's stadium: the seated masses are 2D chibi
// sprites on billboarded quads — one InstancedMesh, one draw call — while the
// twenty-odd REAL composed characters (deepglass_event's sitters and pacers)
// stand in the front rows and on the concourse so anywhere the player can walk
// up to still holds full 3D people. The cards bob, sway, jump and run a
// travelling stadium wave in the vertex shader; a goal spikes the whole bowl
// through the shared excitement uniform.
//
// Sprite variety is generated, not shipped: a 1024^2 canvas atlas of 64 fans,
// split into amber rows, cyan rows and neutral rows so the bowl seats by
// SECTION like a real derby — the same two house colours the pylon banners fly.
//
// The fans are CHARACTER-CREATOR PEOPLE, and ONLY them: every cell is an
// offscreen render of a randomizeAppearance() roll wearing a civilian kit
// dyed in its section's colourway (drawModularPortraitInto). The old painted
// chibi set is gone — it clashed with the artstyle — so the atlas starts
// TRANSPARENT and the stands fill with real people as the renders bake in, a
// few cells a frame over the first second.
//
// Everything is deterministic off the seat index (mulberry32), so the crowd is
// the same crowd every session.

import * as THREE from 'three';
import {
  DEEPGLASS_CENTER,
  DG_BOWL_GAP,
  DG_BOWL_INNER_R,
  DG_BOWL_OUTER_R,
  DG_BOWL_TIERS,
  DG_BOWL_TOP_Y,
} from '../sim/deepglass/layout';
import { modularVisualKey } from './characters/manifest';
import {
  type ArmorSetId,
  DEFAULT_APPEARANCE,
  fullSet,
  type ModularLook,
  type OutfitColorway,
  randomizeAppearance,
} from './characters/modular';
import { drawModularPortraitInto } from './characters/portrait';

// The bowl's geometry comes from layout.ts — the same constants the stadium
// draws from and the world stands its blockers on.
const BOWL_INNER_R = DG_BOWL_INNER_R;
const BOWL_TIERS = DG_BOWL_TIERS;
const TIER_STEP_R = (DG_BOWL_OUTER_R - DG_BOWL_INNER_R) / DG_BOWL_TIERS;
const TIER_STEP_Y = DG_BOWL_TOP_Y / DG_BOWL_TIERS;
const BOWL_GAP = DG_BOWL_GAP;

const ATLAS_SIZE = 1024;
const ATLAS_GRID = 8; // 8x8 = 64 sprites
const CELL = ATLAS_SIZE / ATLAS_GRID;

/** Sprite group boundaries in the atlas (by row): amber fans, cyan fans,
 *  neutral fans. Instances pick within a group by section. */
const AMBER_ROWS = 3;
const CYAN_ROWS = 3;

// The card quad, world yards. 2.2 tall — the SAME height the renderer
// normalizes every placed character to — because the crowd used to be chibi
// cards two-thirds of a body tall and read like a stadium of children next to
// the players on the concourse. Aspect stays 0.7 (the bake pre-squeezes to
// it, see bakeCardCell).
const CARD_H = 2.2;
const CARD_W = CARD_H * 0.7;
// Spaced up with the bigger bodies so shoulders brush instead of overlap.
const SEAT_SPACING = 1.45;
/**
 * How full the bowl is, and how the empty seats are ARRANGED. A flat per-seat
 * coin at 0.86 gave an evenly speckled, over-full ring that read as wallpaper.
 * Real crowds clump: a low-frequency density wave around each ring
 * (CLUSTER_WAVES cycles, offset per tier) decides how likely a stretch is to be
 * occupied, so fans arrive in knots with thinner gaps between, and each seat is
 * jittered a little along the row so no two rows line up. Fewer fans overall
 * than the first cut, in the match-day bowl and on the idle concourse alike.
 */
const FILL = 0.68;
const CLUSTER_WAVES = 11;
/** How much of the fill rides the cluster wave (0 = even speckle, 1 = knots only). */
const CLUSTER_DEPTH = 0.75;
/** Seat jitter along the row, as a fraction of SEAT_SPACING either way. */
const SEAT_JITTER = 0.32;
/** One seat in this many is the idle-day (no bout) crowd. Was 4. */
const IDLE_EVERY = 5;

export interface DeepglassCrowdView {
  group: THREE.Group;
  /** dt in seconds; excite 0..1 (goal = 1). Smoothing lives inside. */
  /** dt seconds; excite 0..1; inMatch=true fills every seat (a live bout),
   *  false keeps the quiet quarter-crowd of an ordinary arena day. */
  update(dt: number, excite: number, inMatch?: boolean): void;
  count: number;
  dispose(): void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The atlas. Starts fully transparent; bakeCardCell fills it with composed
// character renders. (The painted chibi fan painter that used to live here is
// gone with the painted crowd.)
// ---------------------------------------------------------------------------

function buildAtlas(): { tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d')!;
  // Transparent until baked: an unbaked cell discards in the fragment shader
  // (alpha 0.45 gate), so seats appear as their people arrive rather than
  // ever showing a painted stand-in.
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return { tex, ctx };
}

// ---------------------------------------------------------------------------
// The character-creator bake. Rows 0..CARD_RENDER_ROWS-1 of the atlas are
// replaced, a few cells a frame, with offscreen renders of composed modular
// characters.
// ---------------------------------------------------------------------------

/** Every atlas row is a composed-character render. */
const CARD_RENDER_ROWS = ATLAS_GRID;
/** Two atlas cells share one rolled character at different mount yaws — half
 *  the assembleModular variants for the same coverage, and a body seen from
 *  two angles never reads as a clone at stadium range. */
const CELLS_PER_LOOK = 2;

/** Civilian kits, matching npc_looks' deepglassCrowdLook: a crowd in full
 *  plate would read as an invasion. */
const CARD_KITS: readonly ArmorSetId[] = ['druid', 'ranger', 'rogue', 'barbarian', 'mage'];
/** Section colourways: warm ambers for the amber rows, tide blues for the
 *  cyan rows, everyday cloth for the neutrals. */
const AMBER_WAYS: readonly OutfitColorway[] = ['gold', 'ember'];
const CYAN_WAYS: readonly OutfitColorway[] = ['teal', 'azure'];
const NEUTRAL_WAYS: readonly OutfitColorway[] = ['classic', 'forest', 'ivory', 'rose'];

/** Roll the fan for an atlas cell — deterministic, so the crowd is the same
 *  crowd every session. Cells in the same CELLS_PER_LOOK pair share the roll. */
function cardLook(row: number, col: number): ModularLook {
  const rng = mulberry32((0xc0de + row * 131 + Math.floor(col / CELLS_PER_LOOK) * 17) >>> 0);
  const gender = rng() < 0.5 ? 'male' : 'female';
  const app = randomizeAppearance({ ...DEFAULT_APPEARANCE, gender }, rng);
  const ways =
    row < AMBER_ROWS ? AMBER_WAYS : row < AMBER_ROWS + CYAN_ROWS ? CYAN_WAYS : NEUTRAL_WAYS;
  app.outfit = ways[(rng() * ways.length) | 0];
  const kit = CARD_KITS[(rng() * CARD_KITS.length) | 0];
  // Bare heads in the stands, same rule as the 3D crowd: hoods and hats would
  // hide the hair the randomiser just picked.
  return { app, worn: { ...fullSet(kit), head: null } };
}

/** Replace one painted cell with its composed-character render. Returns false
 *  while the character assets are still preloading (nothing is touched). */
function bakeCardCell(ctx: CanvasRenderingContext2D, row: number, col: number): boolean {
  const look = cardLook(row, col);
  // The card quad is CARD_W x CARD_H world yards but the atlas cell is
  // square, so a render drawn at the cell's own aspect would stretch 43%
  // taller on the card. Draw it pre-squeezed at the quad's aspect and the
  // stretch cancels.
  // Alternate the facing across each pair, with a little deterministic drift.
  const jitter = mulberry32((row * 8 + col + 1) >>> 0)() * 0.16;
  const yaw = (col % CELLS_PER_LOOK === 0 ? -0.3 : 0.34) + jitter;
  // Render FIRST (into the rig's own canvas), clear the painted fan only once
  // that succeeded — a cleared cell with no render is an empty seat forever.
  const scratchOk = drawModularPortraitInto(
    scratchCell.ctx,
    modularVisualKey('warrior'),
    look,
    'card',
    yaw,
    0,
    0,
    scratchCell.canvas.width,
    scratchCell.canvas.height,
    true, // spectators are unarmed
  );
  if (!scratchOk) return false;
  // Crop to the rendered BODY. The portrait rig frames with generous margin
  // (measured: the body fills only ~0.6 of the frame with ~14% clearance
  // under the feet), so drawing the whole frame made every fan two-thirds
  // size and floating above the seat. Fit the body's opaque bounds to the
  // cell instead: quad height IS body height, feet on the cell floor.
  const sw = scratchCell.canvas.width;
  const sh = scratchCell.canvas.height;
  const pix = scratchCell.ctx.getImageData(0, 0, sw, sh).data;
  let top = sh;
  let bot = -1;
  let left = sw;
  let right = -1;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (pix[(y * sw + x) * 4 + 3] > 24) {
        if (y < top) top = y;
        if (y > bot) bot = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bot <= top || right <= left) return false;
  const bodyW = right - left + 1;
  const bodyH = bot - top + 1;
  const dh = CELL * 0.98;
  // Dest width keeps the body's true proportions after the quad's own
  // cell->CARD_W x CARD_H stretch: dw/dh * CARD_W/CARD_H = bodyW/bodyH.
  const dw = Math.min(CELL, dh * (bodyW / bodyH) * (CARD_H / CARD_W));
  const dx = col * CELL + (CELL - dw) / 2;
  const dy = row * CELL + (CELL - dh);
  ctx.clearRect(col * CELL, row * CELL, CELL, CELL);
  ctx.drawImage(scratchCell.canvas, left, top, bodyW, bodyH, dx, dy, dw, dh);
  scratchCell.ctx.clearRect(0, 0, scratchCell.canvas.width, scratchCell.canvas.height);
  return true;
}

/** A small scratch surface between the portrait rig and the atlas, so a
 *  failed render can never leave a half-cleared cell. Sized at the portrait
 *  rig's own resolution; created lazily (headless tests have no DOM). */
const scratchCell = {
  canvas: null as unknown as HTMLCanvasElement,
  ctx: null as unknown as CanvasRenderingContext2D,
  ready(): boolean {
    if (this.ctx) return true;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    if (!g) return false;
    this.canvas = c;
    this.ctx = g;
    return true;
  },
};

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** Shortest signed angle difference. */
function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function buildDeepglassCrowdCards(): DeepglassCrowdView {
  const cx = DEEPGLASS_CENTER.x;
  const cz = DEEPGLASS_CENTER.z;

  interface Seat {
    x: number;
    y: number;
    z: number;
    angle: number;
    sprite: number;
    phase: number;
    amp: number;
    scale: number;
    /** 0 amber section, 1 cyan section, 2 neutral. */
    house: number;
  }
  const seats: Seat[] = [];
  for (let t = 0; t < BOWL_TIERS; t++) {
    const rIn = BOWL_INNER_R + t * TIER_STEP_R;
    const yTop = (t + 1) * TIER_STEP_Y;
    for (let s = 0; s < 2; s++) {
      const r = rIn + TIER_STEP_R * (0.34 + s * 0.36) + 0.55;
      const n = Math.floor((Math.PI * 2 * r) / SEAT_SPACING);
      // The tier's own cluster phase, so the knots in one ring do not stack
      // over the knots in the next (stripes up the bowl).
      const wavePhase = ((t * 2.399 + s * 1.13) % (Math.PI * 2)) * 3.1;
      for (let i = 0; i < n; i++) {
        const rng = mulberry32((t * 977 + s * 331 + i * 7) ^ 0x5eed);
        const jitter = (rng() * 2 - 1) * SEAT_JITTER * (SEAT_SPACING / r);
        const a = (i / n) * Math.PI * 2 + (s === 1 ? Math.PI / n : 0) + jitter;
        // The north entrance stays open, like every ring the stadium draws.
        if (Math.abs(angleDelta(a, Math.PI / 2)) < BOWL_GAP / 2 + 0.05) continue;
        // Density wave: two harmonics so the knots come in unequal sizes.
        const wave =
          0.5 +
          0.35 * Math.sin(a * CLUSTER_WAVES + wavePhase) +
          0.15 * Math.sin(a * (CLUSTER_WAVES * 2.6) + wavePhase * 1.7);
        const occupancy = FILL * (1 - CLUSTER_DEPTH + CLUSTER_DEPTH * 2 * wave);
        if (rng() > occupancy) continue;
        // 16 sections around the ring, alternating the two houses (the same
        // rhythm the pylon banners fly); every fourth section is mixed.
        const section = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16) % 16;
        const mixed = section % 4 === 3;
        const house = mixed ? rng() < 0.5 : section % 2 === 0;
        const neutral = rng() < 0.22;
        let row: number;
        if (neutral)
          row = AMBER_ROWS + CYAN_ROWS + ((rng() * (ATLAS_GRID - AMBER_ROWS - CYAN_ROWS)) | 0);
        else if (house) row = (rng() * AMBER_ROWS) | 0;
        else row = AMBER_ROWS + ((rng() * CYAN_ROWS) | 0);
        const col = (rng() * ATLAS_GRID) | 0;
        seats.push({
          x: cx + Math.cos(a) * r,
          y: yTop + 0.12,
          z: cz + Math.sin(a) * r,
          angle: a,
          sprite: row * ATLAS_GRID + col,
          phase: rng() * Math.PI * 2,
          amp: 0.12 + rng() * 0.3,
          // Around 1: the quad is already player-height, the band is the
          // natural size variety of a crowd.
          scale: 0.92 + rng() * 0.22,
          house: neutral ? 2 : house ? 0 : 1,
        });
      }
    }
  }

  // Idle-day ordering: every IDLE_EVERY-th seat (spread around the rings) comes
  // first, so drawing the first quarter of the instance list is the quiet
  // market-day crowd and the full list is a packed match-day bowl. The split
  // is a draw-range flip (geo.instanceCount), not a rebuild.
  const idleSeats = seats.filter((_, i) => i % IDLE_EVERY === 0);
  const matchSeats = seats.filter((_, i) => i % IDLE_EVERY !== 0);
  seats.length = 0;
  seats.push(...idleSeats, ...matchSeats);
  const idleCount = idleSeats.length;

  const base = new THREE.PlaneGeometry(CARD_W, CARD_H);
  base.translate(0, CARD_H / 2, 0); // pivot at the feet
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;
  const n = seats.length;
  const iPos = new Float32Array(n * 3);
  const iData = new Float32Array(n * 4); // sprite, phase, amp, scale
  const iAngle = new Float32Array(n);
  const iHouse = new Float32Array(n);
  seats.forEach((seat, i) => {
    iPos[i * 3] = seat.x;
    iPos[i * 3 + 1] = seat.y;
    iPos[i * 3 + 2] = seat.z;
    iData[i * 4] = seat.sprite;
    iData[i * 4 + 1] = seat.phase;
    iData[i * 4 + 2] = seat.amp;
    iData[i * 4 + 3] = seat.scale;
    iAngle[i] = seat.angle;
    iHouse[i] = seat.house;
  });
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
  geo.setAttribute('iData', new THREE.InstancedBufferAttribute(iData, 4));
  geo.setAttribute('iAngle', new THREE.InstancedBufferAttribute(iAngle, 1));
  geo.setAttribute('iHouse', new THREE.InstancedBufferAttribute(iHouse, 1));
  geo.instanceCount = n;
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(cx, BOWL_TIERS * TIER_STEP_Y * 0.6, cz),
    BOWL_INNER_R + BOWL_TIERS * TIER_STEP_R + 8,
  );

  const { tex: atlas, ctx: atlasCtx } = buildAtlas();
  // The bake queue: every cell of the render rows, replaced painted-fan by
  // composed character a few per frame once the part library is preloaded.
  const bakeQueue: { row: number; col: number }[] = [];
  for (let row = 0; row < CARD_RENDER_ROWS; row++) {
    for (let col = 0; col < ATLAS_GRID; col++) bakeQueue.push({ row, col });
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uExcite: { value: 0 },
      uAtlas: { value: atlas },
      // Dusk grade: unlit sprites in a scene lit by a low warm sun and cyan
      // crystal; a straight white unlit crowd would glow like paper.
      uLight: { value: new THREE.Color(0.78, 0.8, 0.9) },
    },
    vertexShader: `
      attribute vec3 iPos;
      attribute vec4 iData; // sprite, phase, amp, scale
      attribute float iAngle;
      attribute float iHouse;
      uniform float uTime;
      uniform float uExcite;
      varying vec2 vUv;
      varying float vSprite;
      varying float vShade;
      varying float vHouse;
      void main() {
        vSprite = iData.x;
        vHouse = iHouse;
        float phase = iData.y;
        float amp = iData.z;
        float scale = iData.w;
        vUv = uv;
        // Billboard around Y toward the camera.
        vec3 toCam = cameraPosition - iPos;
        float yaw = atan(toCam.x, toCam.z);
        float c = cos(yaw), s = sin(yaw);
        vec3 p = position * scale;
        p = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
        // The bob: idling sway, jumping when excited. Each fan keeps its own
        // beat; excitement raises both tempo and height.
        float tempo = 1.5 + uExcite * 2.6;
        float bob = pow(max(0.0, sin(uTime * tempo + phase)), 2.0)
                  * amp * (0.35 + 1.5 * uExcite);
        // The travelling wave: a bump orbiting the bowl (Rocket League's
        // signature), always faintly alive, stronger with excitement.
        float wave = pow(max(0.0, sin(uTime * 0.85 - iAngle * 3.0 + phase * 0.08)), 6.0)
                   * (0.22 + 0.55 * uExcite);
        // A light lean so a jump reads as a body, not an elevator.
        p.x += sin(uTime * 0.9 + phase) * 0.05 * scale;
        vec3 world = iPos + p + vec3(0.0, bob + wave, 0.0);
        // Rows further back sit slightly dimmer, faking bowl self-shadow.
        vShade = 0.86 + 0.14 * sin(phase * 3.7);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uAtlas;
      uniform vec3 uLight;
      varying vec2 vUv;
      varying float vSprite;
      varying float vShade;
      varying float vHouse;
      void main() {
        float grid = ${ATLAS_GRID.toFixed(1)};
        float col = mod(vSprite, grid);
        float row = floor(vSprite / grid);
        // Atlas rows are top-down; UV v runs bottom-up.
        vec2 cell = vec2(col, grid - 1.0 - row);
        vec2 uv = (cell + vUv) / grid;
        vec4 tex = texture2D(uAtlas, uv);
        if (tex.a < 0.45) discard;
        // The section wash: composed-character fans wear whatever colourway
        // they rolled, so the section identity the painted shirts used to
        // carry comes from a light team-coloured grade instead — the bowl
        // reads amber block / tide block the way the pylon banners do.
        vec3 houseCol = vHouse < 0.5 ? vec3(1.0, 0.76, 0.42)
                      : vHouse < 1.5 ? vec3(0.45, 0.83, 1.0)
                      : vec3(1.0);
        vec3 washed = tex.rgb * mix(vec3(1.0), houseCol, 0.30);
        gl_FragColor = vec4(washed * uLight * vShade, 1.0);
      }
    `,
    transparent: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'deepglass-crowd-cards';
  mesh.frustumCulled = true;
  const group = new THREE.Group();
  group.name = 'deepglass-crowd';
  group.add(mesh);

  let time = 0;
  let excite = 0;
  return {
    group,
    count: n,
    update(dt: number, targetExcite: number, inMatch = false): void {
      geo.instanceCount = inMatch ? n : idleCount;
      time += dt;
      // Fast to rise (a goal hits the whole bowl at once), slow to settle.
      const rate = targetExcite > excite ? 6 : 0.55;
      excite += (targetExcite - excite) * Math.min(1, dt * rate);
      mat.uniforms.uTime.value = time;
      mat.uniforms.uExcite.value = excite;
      // Bake the composed-character cells in, two a frame: ~1.5s to fill the
      // bowl with real people, without a single-frame hitch at world entry.
      if (bakeQueue.length > 0 && scratchCell.ready()) {
        let baked = 0;
        while (baked < 2 && bakeQueue.length > 0) {
          const cell = bakeQueue[0];
          if (!bakeCardCell(atlasCtx, cell.row, cell.col)) break;
          bakeQueue.shift();
          baked++;
        }
        if (baked > 0) atlas.needsUpdate = true;
      }
    },
    dispose(): void {
      geo.dispose();
      base.dispose();
      mat.dispose();
      atlas.dispose();
    },
  };
}
