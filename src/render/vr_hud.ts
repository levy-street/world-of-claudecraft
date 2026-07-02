// Minimal in-world HUD for immersive WebXR sessions. The DOM HUD is not visible
// in headset, so a small canvas-textured panel parented to the user camera shows
// health and the player's power bar while presenting.
import * as THREE from 'three';
import type { ResourceType } from '../sim/types';

export interface VrHudStats {
  name: string;
  hp: number;
  maxHp: number;
  resource: number;
  maxResource: number;
  resourceKind: ResourceType | 'none';
  dead: boolean;
}

const PANEL_W = 512;
const PANEL_H = 192;
const HP_COLOR = '#c43b3b';
const MANA_COLOR = '#3b6fc4';
const RAGE_COLOR = '#c47a2b';
const ENERGY_COLOR = '#d4b82a';
const BG_COLOR = 'rgba(8, 8, 14, 0.72)';
const BORDER_COLOR = '#8a7a55';

export class VrHud {
  private readonly root = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastKey = '';
  private visible = false;

  constructor(camera: THREE.Camera) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = PANEL_W;
    this.canvas.height = PANEL_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('VrHud: 2d context unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.21), mat);
    mesh.position.set(0, 0.08, -0.72);
    mesh.renderOrder = 999;
    this.root.add(mesh);
    this.root.visible = false;
    camera.add(this.root);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.root.visible = on;
    if (!on) this.lastKey = '';
  }

  update(stats: VrHudStats): void {
    if (!this.visible) return;
    const key = [
      stats.name,
      stats.dead,
      stats.hp,
      stats.maxHp,
      stats.resource,
      stats.maxResource,
      stats.resourceKind,
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.paint(stats);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    this.texture.dispose();
    (this.root.children[0] as THREE.Mesh).geometry.dispose();
    ((this.root.children[0] as THREE.Mesh).material as THREE.Material).dispose();
  }

  private paint(stats: VrHudStats): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, PANEL_W, PANEL_H);
    ctx.fillStyle = BG_COLOR;
    roundRect(ctx, 8, 8, PANEL_W - 16, PANEL_H - 16, 14);
    ctx.fill();
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#f0ead8';
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const title = stats.dead ? `${stats.name} (dead)` : stats.name;
    ctx.fillText(title, 28, 22);

    drawBar(ctx, 28, 78, PANEL_W - 56, 28, stats.hp / Math.max(1, stats.maxHp), HP_COLOR);
    if (stats.resourceKind !== 'none') {
      const color =
        stats.resourceKind === 'rage'
          ? RAGE_COLOR
          : stats.resourceKind === 'energy'
            ? ENERGY_COLOR
            : MANA_COLOR;
      drawBar(
        ctx,
        28,
        122,
        PANEL_W - 56,
        22,
        stats.resource / Math.max(1, stats.maxResource),
        color,
      );
    }
  }
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  fill: string,
): void {
  const clamped = Math.max(0, Math.min(1, frac));
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (clamped > 0) {
    ctx.fillStyle = fill;
    roundRect(ctx, x, y, Math.max(h, w * clamped), h, h / 2);
    ctx.fill();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
