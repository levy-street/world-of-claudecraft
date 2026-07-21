// The boarball: bespoke visual for the 'vale_cup_ball' entity (an inert
// bell-pattern mob the Vale Cup sim module drives; without this carve-out the
// renderer would dress it as a generic mob rig). A round, machined soccer-ball
// procedural sphere with a CanvasTexture, client-side roll rotation derived
// from per-frame position deltas (axis = up x velocity, pure helper below), a
// soft contact-shadow blob, and a small module-owned dust pool for fast rolls.
//
// Sharing contract: texture + materials + the dust pool are MODULE-level and
// never disposed (renderer.removeView only disposes per-view geometry, which
// is a cheap sphere here), so entity interest churn cannot leak or stall.
import * as THREE from 'three';
import { VALE_CUP_BALL_MOB, VALE_CUP_BALL_TEMPLATE_ID } from '../sim/content/vale_cup';
import { VC_BALL_RADIUS } from '../sim/vale_cup_ball';
import { GFX } from './gfx';

export const VALE_CUP_BALL_TEMPLATE = VALE_CUP_BALL_TEMPLATE_ID;
// Base (unscaled) radius derived from the SIM's physics radius and the mob
// template's entity scale, so the rendered ball is exactly the sphere the
// match physics banks off the boards (never re-tuned by hand here).
export const BALL_RADIUS = VC_BALL_RADIUS / VALE_CUP_BALL_MOB.scale;

// ---------------------------------------------------------------------------
// Pure roll math (unit-testable without three): rolling without slipping on
// the ground plane rotates the ball about axis = up x velocity by
// angle = distance / radius. Returns a normalized axis + angle in radians;
// angle 0 when the motion is too small to read.
// ---------------------------------------------------------------------------
export interface BallRoll {
  ax: number;
  ay: number;
  az: number;
  angle: number;
}

export function ballRollAxisAngle(
  dx: number,
  dz: number,
  radius: number,
  out: BallRoll = { ax: 0, ay: 0, az: 0, angle: 0 },
): BallRoll {
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-5 || radius <= 0) {
    out.ax = 0;
    out.ay = 0;
    out.az = 1;
    out.angle = 0;
    return out;
  }
  // up x v = (vz, 0, -vx), normalized
  out.ax = dz / dist;
  out.ay = 0;
  out.az = -dx / dist;
  out.angle = dist / radius;
  return out;
}

// ---------------------------------------------------------------------------
// Shared textures/materials (module-local canvas code + a tiny local LCG:
// textures.ts's shared LCG is order-load-bearing and off limits).
// ---------------------------------------------------------------------------

function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// A classic Telstar soccer ball: white leather with black pentagons and thin
// panel seams, drawn onto an equirectangular map. The pentagons are laid out in
// offset rows so the sphere reads unmistakably as a football from any angle
// (an exact truncated-icosahedron unwrap is overkill for a ball this size).
function soccerTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  // white leather base with the faintest cool shading so it is not flat paper
  g.fillStyle = '#f2f2ef';
  g.fillRect(0, 0, w, h);
  const rnd = makeLcg(0x50cce7);
  for (let i = 0; i < 60; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    g.fillStyle = rnd() < 0.5 ? 'rgba(210,210,205,0.20)' : 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.ellipse(x, y, 4 + rnd() * 10, 3 + rnd() * 7, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }

  // a filled regular pentagon centered at (cx, cy), flat side down when rot 0
  const pentagon = (cx: number, cy: number, r: number, rot: number): void => {
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = rot - Math.PI / 2 + (k * 2 * Math.PI) / 5;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = '#151515';
    g.fill();
    // a soft edge so the panel does not read as a hard sticker
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.stroke();
  };

  // faint hexagon seams: a light lattice so the white panels have structure
  g.strokeStyle = 'rgba(120,120,120,0.35)';
  g.lineWidth = 1;
  for (let row = 0; row <= 4; row++) {
    const y = (row / 4) * h;
    g.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const yy = y + Math.sin((x / w) * Math.PI * 6 + row) * 4;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }

  // black pentagons in three offset rows (poles + equator band), sized to the
  // classic ball; the wrap seam at u=0/1 is covered by placing one at each edge
  const R = w / 11;
  const rows = [
    { y: h * 0.2, n: 4, off: 0 },
    { y: h * 0.5, n: 5, off: 0.5 },
    { y: h * 0.8, n: 4, off: 0 },
  ];
  for (const { y, n, off } of rows) {
    for (let i = 0; i < n; i++) {
      const x = ((i + off) / n) * w;
      pentagon(x, y, R, (i % 2 === 0 ? 0 : Math.PI) + (off ? Math.PI : 0));
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function shadowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(10,8,5,0.42)');
  grd.addColorStop(0.6, 'rgba(10,8,5,0.22)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

let ballMat: THREE.Material | null = null;
let shadowMat: THREE.MeshBasicMaterial | null = null;

function sharedBallMaterial(): THREE.Material {
  if (!ballMat) {
    ballMat = GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({ map: soccerTexture(), roughness: 0.55, metalness: 0 })
      : new THREE.MeshLambertMaterial({ map: soccerTexture() });
  }
  return ballMat;
}

function sharedShadowMaterial(): THREE.MeshBasicMaterial {
  if (!shadowMat) {
    shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
    });
  }
  return shadowMat;
}

export interface ValeCupBallBuild {
  group: THREE.Group;
  /** the rolling sphere: the renderer premultiplies roll quaternions onto it */
  spinner: THREE.Mesh;
  /** ground-hugging contact blob; repositioned/faded per frame */
  shadow: THREE.Mesh;
  height: number;
}

/** Per-view build. Geometry is view-owned (cheap; removeView disposes it),
 *  materials/textures are the shared module singletons above. */
export function buildValeCupBall(): ValeCupBallBuild {
  const group = new THREE.Group();
  // a round, machined soccer ball (smooth sphere, not the old stuffed hide)
  const geo = new THREE.SphereGeometry(BALL_RADIUS, 28, 20);
  const spinner = new THREE.Mesh(geo, sharedBallMaterial());
  spinner.position.y = BALL_RADIUS;
  spinner.castShadow = true;
  spinner.receiveShadow = true;
  group.add(spinner);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(BALL_RADIUS * 2.6, BALL_RADIUS * 2.6),
    sharedShadowMaterial(),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 2;
  group.add(shadow);

  group.userData.vcSpinner = spinner;
  group.userData.vcShadow = shadow;
  return { group, spinner, shadow, height: BALL_RADIUS * 2 };
}

// scratch (render-thread only)
const rollScratch: BallRoll = { ax: 0, ay: 0, az: 1, angle: 0 };
const axisScratch = new THREE.Vector3();
const quatScratch = new THREE.Quaternion();

/** Apply the roll for a world-space frame delta to the spinner mesh. The
 *  owning group must keep rotation identity (world axes == local axes). */
export function rollBallSpinner(
  spinner: THREE.Object3D,
  dx: number,
  dz: number,
  radius = BALL_RADIUS,
): void {
  ballRollAxisAngle(dx, dz, radius, rollScratch);
  if (rollScratch.angle === 0) return;
  axisScratch.set(rollScratch.ax, rollScratch.ay, rollScratch.az);
  quatScratch.setFromAxisAngle(axisScratch, rollScratch.angle);
  spinner.quaternion.premultiply(quatScratch);
}

// ---------------------------------------------------------------------------
// Dust pool: a handful of scene-level smoke sprites kicked up at the contact
// point when the ball is rolling fast. Module-owned, created once, never
// disposed (view churn safe); the renderer calls update(dt) each frame.
// ---------------------------------------------------------------------------

const DUST_POOL = 10;

interface DustPuff {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
}

export class ValeCupBallDust {
  readonly group = new THREE.Group();
  private puffs: DustPuff[] = [];
  private next = 0;
  private accum = 0;

  constructor() {
    this.group.name = 'vale-cup-ball-dust';
    const tex = shadowTexture(); // soft radial blob doubles as a dust puff
    for (let i = 0; i < DUST_POOL; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xb9a67c,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.puffs.push({ sprite, life: 0, maxLife: 0.55, vx: 0, vy: 0, vz: 0 });
    }
  }

  /** Rate-limited spawn at the ball's ground contact while it rolls fast. */
  kick(x: number, y: number, z: number, dx: number, dz: number, dt: number): void {
    this.accum += dt;
    if (this.accum < 0.07) return;
    this.accum = 0;
    const p = this.puffs[this.next];
    this.next = (this.next + 1) % DUST_POOL;
    p.sprite.visible = true;
    p.sprite.position.set(x, y + 0.12, z);
    p.sprite.scale.setScalar(0.5);
    p.life = p.maxLife;
    // drift backward off the roll direction, slightly up
    const inv = dt > 0 ? 1 / dt : 0;
    p.vx = -dx * inv * 0.18;
    p.vz = -dz * inv * 0.18;
    p.vy = 0.7;
  }

  /** A one-shot ring of puffs at a hard kick (ball leaps from rest to fast). */
  burst(x: number, y: number, z: number): void {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const p = this.puffs[this.next];
      this.next = (this.next + 1) % DUST_POOL;
      const a = (i / n) * Math.PI * 2;
      p.sprite.visible = true;
      p.sprite.position.set(x, y + 0.1, z);
      p.sprite.scale.setScalar(0.4);
      p.life = p.maxLife;
      p.vx = Math.cos(a) * 2.2;
      p.vz = Math.sin(a) * 2.2;
      p.vy = 1.1;
    }
  }

  update(dt: number): void {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        (p.sprite.material as THREE.SpriteMaterial).opacity = 0;
        continue;
      }
      const f = p.life / p.maxLife;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.scale.setScalar(0.5 + (1 - f) * 0.9);
      (p.sprite.material as THREE.SpriteMaterial).opacity = f * 0.34;
    }
  }
}

// ---------------------------------------------------------------------------
// Ball light trail (Rocket League style): a comet of fading additive glow
// sprites dropped along the ball's path, so the ball is easy to track. The
// trail is THICK + bright for a hard kick and thin + faint for a dribble
// (scaled by speed), and each mote stays where it was dropped and fades, so it
// streaks behind a moving ball. Module-owned pool, never disposed.
// ---------------------------------------------------------------------------

const TRAIL_POOL = 34;

interface TrailMote {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  baseScale: number;
  baseOpacity: number;
}

function glowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.CanvasTexture(canvas);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,244,214,0.55)');
  grd.addColorStop(1, 'rgba(255,236,190,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class ValeCupBallTrail {
  readonly group = new THREE.Group();
  private motes: TrailMote[] = [];
  private next = 0;
  private accum = 0;

  constructor() {
    this.group.name = 'vale-cup-ball-trail';
    const tex = glowTexture();
    for (let i = 0; i < TRAIL_POOL; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: 0xfff0cc,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.motes.push({ sprite, life: 0, maxLife: 0.32, baseScale: 0.4, baseOpacity: 0.4 });
    }
  }

  /** Drop a glow mote at the ball, sized/brightened by speed. Below ~2.5 yd/s
   *  (a settled or gently-nudged ball) it leaves no trail. */
  emit(x: number, y: number, z: number, speed: number, dt: number): void {
    this.accum += dt;
    if (this.accum < 0.014 || speed < 2) return;
    this.accum = 0;
    // 0 at a slow dribble, 1 at a hard kick (ball max speed is ~28 yd/s).
    const t = Math.max(0, Math.min(1, (speed - 3) / 20));
    const m = this.motes[this.next];
    this.next = (this.next + 1) % TRAIL_POOL;
    m.sprite.visible = true;
    m.sprite.position.set(x, y, z);
    m.baseScale = BALL_RADIUS * (1.9 + t * 3.0); // thin dribble -> fat comet
    m.baseOpacity = 0.3 + t * 0.55;
    m.maxLife = 0.3 + t * 0.24; // faster kicks streak a little longer
    m.life = m.maxLife;
    m.sprite.scale.setScalar(m.baseScale);
    (m.sprite.material as THREE.SpriteMaterial).opacity = m.baseOpacity;
  }

  update(dt: number): void {
    for (const m of this.motes) {
      if (m.life <= 0) continue;
      m.life -= dt;
      if (m.life <= 0) {
        m.sprite.visible = false;
        (m.sprite.material as THREE.SpriteMaterial).opacity = 0;
        continue;
      }
      const f = m.life / m.maxLife; // 1 -> 0
      (m.sprite.material as THREE.SpriteMaterial).opacity = m.baseOpacity * f;
      m.sprite.scale.setScalar(m.baseScale * (0.35 + 0.65 * f)); // taper to the tail
    }
  }
}
