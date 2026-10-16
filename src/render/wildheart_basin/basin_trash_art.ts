// The Wildheart trash hunt's painted art (basin_trash_fx.ts): the quarry
// sigil a Vineclaw Stalker's marking spear leaves over its quarry's head (a
// bone plate daubed with a raptor's three-talon print, feathers hanging off
// it) and the red-painted troll skull crowning a Sunbone Dread Totem, its eye
// sockets burning. Painted once on canvases in their own colours (the sprites
// draw them white), with a dark outline so they read over sky and jungle.
//
// Both are ACTIONABLE (who the raptors hunt, which totem frightens):
// basin_trash_fx.ts draws them on every tier; this module only paints.

import * as THREE from 'three';

const OUTLINE = 'rgba(22,10,6,0.92)';

function canvas(size: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return { c, ctx: c.getContext('2d') };
}

function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The quarry sigil: a notched bone plate, a war-paint raptor's three-talon
 *  print raked across it, two feathers on cords under it, a hot glow behind.
 *  256 px. */
export function quarrySigilTexture(): THREE.CanvasTexture {
  const size = 256;
  const { c, ctx } = canvas(size);
  if (ctx) {
    const m = size / 2;
    const glow = ctx.createRadialGradient(m, m - 6, 12, m, m - 6, m - 2);
    glow.addColorStop(0, 'rgba(255,150,60,0.75)');
    glow.addColorStop(0.5, 'rgba(255,110,40,0.28)');
    glow.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // The feathers on their cords, hanging under the plate.
    for (const side of [-1, 1]) {
      const x = m + side * 34;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, 168);
      ctx.lineTo(x + side * 6, 200);
      ctx.stroke();
      for (const pass of [0, 1]) {
        ctx.fillStyle = pass === 0 ? OUTLINE : side < 0 ? '#d8442a' : '#f2d27a';
        const g = pass === 0 ? 4 : 0;
        ctx.beginPath();
        ctx.moveTo(x + side * 6, 196 - g);
        ctx.quadraticCurveTo(x + side * 22 + side * g, 222, x + side * 10, 248 + g);
        ctx.quadraticCurveTo(x - side * 6 - side * g, 222, x + side * 6, 196 - g);
        ctx.fill();
      }
    }
    // The bone plate: a rough disc with notches bitten into its rim.
    const plate = (grow: number) => {
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        const notch = k % 6 === 0 ? 9 : k % 3 === 0 ? 3 : 0;
        const r = 82 + grow - notch + Math.sin(a * 5) * 2;
        const x = m + Math.cos(a) * r;
        const y = m - 8 + Math.sin(a) * r * 0.94;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    ctx.fillStyle = OUTLINE;
    plate(7);
    ctx.fill();
    const bone = ctx.createRadialGradient(m - 20, m - 34, 8, m, m - 8, 90);
    bone.addColorStop(0, '#fff6e2');
    bone.addColorStop(0.7, '#e6d2a8');
    bone.addColorStop(1, '#b89a6a');
    ctx.fillStyle = bone;
    plate(0);
    ctx.fill();
    // Cracks in the bone.
    ctx.strokeStyle = 'rgba(110,80,46,0.7)';
    ctx.lineWidth = 2;
    for (const [x0, y0, x1, y1] of [
      [m - 70, m - 30, m - 44, m - 18],
      [m + 52, m + 40, m + 70, m + 18],
      [m - 10, m + 66, m + 6, m + 50],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    // The raptor's print: three talons fanning up from a pad, daubed in
    // war paint over the bone.
    const print = (fill: string, grow: number) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(m, m + 30, 22 + grow, 17 + grow, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let k = -1; k <= 1; k++) {
        const a = -Math.PI / 2 + k * 0.62;
        const bx = m + Math.cos(a) * 20;
        const by = m + 22 + Math.sin(a) * 20;
        const tx = m + Math.cos(a) * 92;
        const ty = m + 22 + Math.sin(a) * 92;
        const nx = -Math.sin(a);
        const ny = Math.cos(a);
        const w = 13 + grow;
        ctx.beginPath();
        ctx.moveTo(bx + nx * w, by + ny * w);
        ctx.quadraticCurveTo(
          (bx + tx) / 2 + nx * (w + 8),
          (by + ty) / 2 + ny * (w + 8),
          tx + Math.cos(a) * grow,
          ty + Math.sin(a) * grow,
        );
        ctx.quadraticCurveTo(
          (bx + tx) / 2 - nx * (w - 6),
          (by + ty) / 2 - ny * (w - 6),
          bx - nx * w,
          by - ny * w,
        );
        ctx.closePath();
        ctx.fill();
      }
    };
    print(OUTLINE, 5);
    print('#ff5a1c', 0);
    // A hot stroke down each talon (the paint still wet).
    ctx.strokeStyle = 'rgba(255,214,140,0.85)';
    ctx.lineWidth = 3;
    for (let k = -1; k <= 1; k++) {
      const a = -Math.PI / 2 + k * 0.62;
      ctx.beginPath();
      ctx.moveTo(m + Math.cos(a) * 30, m + 22 + Math.sin(a) * 30);
      ctx.lineTo(m + Math.cos(a) * 74, m + 22 + Math.sin(a) * 74);
      ctx.stroke();
    }
  }
  return finish(c);
}

/** The dread skull: a tusked troll skull in old bone, red paint slashed
 *  across the brow and down the cheeks, its eye sockets burning red. 256 px. */
export function dreadSkullTexture(): THREE.CanvasTexture {
  const size = 256;
  const { c, ctx } = canvas(size);
  if (ctx) {
    const m = size / 2;
    const glow = ctx.createRadialGradient(m, m, 16, m, m, m - 2);
    glow.addColorStop(0, 'rgba(255,40,50,0.5)');
    glow.addColorStop(0.55, 'rgba(200,20,30,0.18)');
    glow.addColorStop(1, 'rgba(160,0,20,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // The tusks, curling up from the jaw.
    const tusk = (side: number, fill: string, grow: number) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(m + side * (30 - grow), 186);
      ctx.quadraticCurveTo(m + side * (78 + grow), 196 + grow, m + side * (86 + grow), 128 - grow);
      ctx.quadraticCurveTo(m + side * 64, 172, m + side * (40 + grow), 166 - grow);
      ctx.closePath();
      ctx.fill();
    };
    for (const side of [-1, 1]) tusk(side, OUTLINE, 5);
    // The cranium and the long troll snout.
    const skull = (grow: number) => {
      ctx.beginPath();
      ctx.moveTo(m, 30 - grow);
      ctx.bezierCurveTo(m + 78 + grow, 30 - grow, m + 84 + grow, 104, m + 58 + grow, 138);
      ctx.bezierCurveTo(m + 46 + grow, 158, m + 40 + grow, 196 + grow, m + 14, 206 + grow);
      ctx.lineTo(m - 14, 206 + grow);
      ctx.bezierCurveTo(m - 40 - grow, 196 + grow, m - 46 - grow, 158, m - 58 - grow, 138);
      ctx.bezierCurveTo(m - 84 - grow, 104, m - 78 - grow, 30 - grow, m, 30 - grow);
      ctx.closePath();
    };
    ctx.fillStyle = OUTLINE;
    skull(6);
    ctx.fill();
    const bone = ctx.createRadialGradient(m - 18, 70, 10, m, 110, 110);
    bone.addColorStop(0, '#e8d8b4');
    bone.addColorStop(0.6, '#b9a07a');
    bone.addColorStop(1, '#6f5a3e');
    ctx.fillStyle = bone;
    skull(0);
    ctx.fill();
    for (const side of [-1, 1]) tusk(side, '#efe4c8', 0);
    // The red paint: a band across the brow and three streaks down each cheek.
    ctx.fillStyle = 'rgba(196,22,30,0.92)';
    ctx.beginPath();
    ctx.moveTo(m - 66, 72);
    ctx.quadraticCurveTo(m, 52, m + 66, 72);
    ctx.lineTo(m + 62, 88);
    ctx.quadraticCurveTo(m, 70, m - 62, 88);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(196,22,30,0.92)';
    ctx.lineWidth = 6;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const x = m + side * (34 + k * 9);
        ctx.beginPath();
        ctx.moveTo(x, 136);
        ctx.lineTo(x - side * 4, 168 + k * 6);
        ctx.stroke();
      }
    }
    // The sockets: black hollows with a red fire in each.
    for (const side of [-1, 1]) {
      const x = m + side * 30;
      const y = 108;
      ctx.fillStyle = '#0c0405';
      ctx.beginPath();
      ctx.ellipse(x, y, 22, 17, side * -0.25, 0, Math.PI * 2);
      ctx.fill();
      const eye = ctx.createRadialGradient(x, y, 1, x, y, 18);
      eye.addColorStop(0, 'rgba(255,240,200,1)');
      eye.addColorStop(0.3, 'rgba(255,60,50,1)');
      eye.addColorStop(1, 'rgba(160,0,10,0)');
      ctx.fillStyle = eye;
      ctx.beginPath();
      ctx.ellipse(x, y, 18, 14, side * -0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    // The nose pit and the teeth along the jaw.
    ctx.fillStyle = '#0c0405';
    ctx.beginPath();
    ctx.moveTo(m, 132);
    ctx.lineTo(m - 9, 152);
    ctx.lineTo(m + 9, 152);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#efe4c8';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    for (let k = -3; k <= 3; k++) {
      const x = m + k * 8;
      ctx.beginPath();
      ctx.rect(x - 3.5, 178, 7, 16 - Math.abs(k) * 1.5);
      ctx.fill();
      ctx.stroke();
    }
  }
  return finish(c);
}
