// The ball comet trail (Rocket League style), lifted out of the retired
// vale_cup_ball.ts when upstream v0.40 demolished the Sowfield. Nothing about
// it was ever boarball-specific — it draws a fading additive streak behind
// whatever ball you hand it — so it lives here as its own module and the
// Deepglass Tidesow is now its only caller (src/render/renderer.ts).
import * as THREE from 'three';

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

export class BallTrail {
  readonly group = new THREE.Group();
  private motes: TrailMote[] = [];
  private next = 0;
  private accum = 0;

  constructor() {
    this.group.name = 'ball-trail';
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
  emit(x: number, y: number, z: number, speed: number, dt: number, radius: number): void {
    this.accum += dt;
    if (this.accum < 0.014 || speed < 2) return;
    this.accum = 0;
    // 0 at a slow dribble, 1 at a hard kick (ball max speed is ~28 yd/s).
    const t = Math.max(0, Math.min(1, (speed - 3) / 20));
    const m = this.motes[this.next];
    this.next = (this.next + 1) % TRAIL_POOL;
    m.sprite.visible = true;
    m.sprite.position.set(x, y, z);
    m.baseScale = radius * (1.9 + t * 3.0); // thin dribble -> fat comet
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
