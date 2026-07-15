import * as THREE from 'three';

const RECKLESS_SKULL_LIFETIME = 1;

let recklessSkullTex: THREE.CanvasTexture | null = null;

function recklessSkullTexture(): THREE.CanvasTexture {
  if (recklessSkullTex) return recklessSkullTex;
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas context unavailable for Recklessness skull');
  g.clearRect(0, 0, size, size);
  g.shadowColor = '#ff2210';
  g.shadowBlur = 14;
  g.fillStyle = '#ff2a18';
  g.beginPath();
  g.arc(size / 2, size * 0.42, size * 0.3, Math.PI * 0.98, Math.PI * 0.02);
  g.quadraticCurveTo(size * 0.8, size * 0.62, size * 0.68, size * 0.66);
  g.lineTo(size * 0.32, size * 0.66);
  g.quadraticCurveTo(size * 0.2, size * 0.62, size * 0.2, size * 0.42);
  g.closePath();
  g.fill();
  g.fillRect(size * 0.36, size * 0.68, size * 0.28, size * 0.14);
  g.shadowBlur = 0;
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(size * 0.38, size * 0.44, size * 0.085, 0, Math.PI * 2);
  g.arc(size * 0.62, size * 0.44, size * 0.085, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(size * 0.5, size * 0.5);
  g.lineTo(size * 0.455, size * 0.6);
  g.lineTo(size * 0.545, size * 0.6);
  g.closePath();
  g.fill();
  for (let i = 0; i < 3; i++) {
    g.fillRect(size * (0.415 + i * 0.075), size * 0.68, size * 0.02, size * 0.13);
  }
  g.globalCompositeOperation = 'source-over';
  recklessSkullTex = new THREE.CanvasTexture(canvas);
  recklessSkullTex.colorSpace = THREE.SRGBColorSpace;
  return recklessSkullTex;
}

export class RecklessSkullPainter {
  private readonly live: { sprite: THREE.Sprite; parent: THREE.Group; elapsed: number }[] = [];

  spawn(parent: THREE.Group, height: number): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: recklessSkullTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 1,
      }),
    );
    sprite.position.set(0, height + 1.05, 0);
    sprite.scale.setScalar(0.9);
    parent.add(sprite);
    this.live.push({ sprite, parent, elapsed: 0 });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const fx = this.live[i];
      fx.elapsed += dt;
      if (fx.elapsed >= RECKLESS_SKULL_LIFETIME) {
        fx.parent.remove(fx.sprite);
        fx.sprite.material.dispose();
        this.live.splice(i, 1);
        continue;
      }
      fx.sprite.position.y += dt * 0.45;
      const t = fx.elapsed / RECKLESS_SKULL_LIFETIME;
      fx.sprite.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    }
  }
}
