import type { TerrainBrushAlphaId } from './types';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hash01(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, frequency: number, salt: number): number {
  const fx = x * frequency;
  const fy = y * frequency;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash01(x0, y0, salt);
  const b = hash01(x0 + 1, y0, salt);
  const c = hash01(x0, y0 + 1, salt);
  const d = hash01(x0 + 1, y0 + 1, salt);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fractalNoise(x: number, y: number, salt: number): number {
  return (
    valueNoise(x, y, 0.09, salt) * 0.55 +
    valueNoise(x, y, 0.21, salt + 1) * 0.3 +
    valueNoise(x, y, 0.47, salt + 2) * 0.15
  );
}

/** Deterministic built-in terrain mask at brush-space coordinates [-1, 1]. */
export function terrainBrushAlpha(alpha: TerrainBrushAlphaId, u: number, v: number): number {
  const px = (value: number): number => ((value + 1) * 64) / 2;
  if (alpha === 'noise') {
    const noise = fractalNoise(px(u), px(v), 11);
    const center = 1 - Math.min(1, Math.hypot(u, v));
    return clamp01(noise * 0.75 + center * 0.45);
  }
  if (alpha === 'splatter') {
    let best = 0;
    for (let i = 0; i < 26; i++) {
      const bx = hash01(i, 3, 71) * 1.7 - 0.85;
      const by = hash01(i, 7, 71) * 1.7 - 0.85;
      const radius = 0.05 + hash01(i, 11, 71) * 0.22;
      const distance = Math.hypot(u - bx, v - by);
      if (distance < radius) best = Math.max(best, 1 - (distance / radius) ** 2);
    }
    return best;
  }
  if (alpha === 'streaks') {
    const band = valueNoise(px(u) * 0.15, px(v) * 1.4, 1, 29);
    const grain = valueNoise(px(u), px(v), 0.5, 31);
    const streak = band * 0.75 + grain * 0.35;
    return clamp01(streak * streak * 1.4);
  }
  if (alpha === 'dots') {
    const grid = 5.5;
    const cellX = Math.floor(((u + 1) * grid) / 2);
    const cellY = Math.floor(((v + 1) * grid) / 2);
    const jitterX = (hash01(cellX, cellY, 41) - 0.5) * 0.5;
    const jitterY = (hash01(cellY, cellX, 43) - 0.5) * 0.5;
    const localX = (((u + 1) * grid) / 2 - cellX - 0.5 - jitterX) * 2;
    const localY = (((v + 1) * grid) / 2 - cellY - 0.5 - jitterY) * 2;
    const distance = Math.hypot(localX, localY);
    const radius = 0.45 + hash01(cellX, cellY, 47) * 0.4;
    return distance < radius ? 1 - (distance / radius) ** 2 : 0;
  }

  const grid = 4;
  const fx = ((u + 1) * grid) / 2;
  const fy = ((v + 1) * grid) / 2;
  const cellX = Math.floor(fx);
  const cellY = Math.floor(fy);
  let nearest = 9;
  let second = 9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const sampleX = cellX + ox + hash01(cellX + ox, cellY + oy, 53) - 0.5;
      const sampleY = cellY + oy + hash01(cellY + oy, cellX + ox, 59) - 0.5;
      const distance = Math.hypot(fx - sampleX, fy - sampleY);
      if (distance < nearest) {
        second = nearest;
        nearest = distance;
      } else if (distance < second) {
        second = distance;
      }
    }
  }
  return clamp01((second - nearest) / 0.14);
}

/** Radial falloff with a solid hardness core, optionally shaped by an alpha. */
export function terrainBrushWeight(
  distanceRatio: number,
  hardness = 0,
  alpha?: { id: TerrainBrushAlphaId; u: number; v: number },
): number {
  if (distanceRatio >= 1) return 0;
  const hard = clamp01(hardness);
  let radial = 1;
  if (hard < 1 && distanceRatio > hard) {
    const t = (distanceRatio - hard) / (1 - hard);
    radial = 1 - t * t * (3 - 2 * t);
  }
  return radial * (alpha ? terrainBrushAlpha(alpha.id, alpha.u, alpha.v) : 1);
}
