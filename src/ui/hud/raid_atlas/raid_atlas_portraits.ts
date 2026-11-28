// The raid atlas's boss portraits, loaded once per session: each bust
// (raid_atlas_boss_core.ts raidAtlasPortraitUrl) as an image, plus a stone-grey
// copy made once, on a defeated boss's first paint, in the palette's dead tone.
// The grey is composited ('saturation' then 'destination-in', which every
// browser's 2D canvas supports), never a per-paint canvas filter (Safari has none).
//
// `version` moves on every load, so a painter's cache key notices a face that
// arrived after its last paint. Until a face lands the medallion draws its
// crest, so a slow or blocked image never leaves a hole on the map.

import { raidAtlasPortraitUrl } from './raid_atlas_boss_core';

/** A loaded bust: full colour, and stone grey (in the given palette tone, made
 *  once and kept) for a defeated boss. */
export interface RaidAtlasFace {
  color: CanvasImageSource;
  grey(tone: string): CanvasImageSource;
}

/** What a painter reads: a face if it has landed, and the load counter. */
export interface RaidAtlasFaceSource {
  face(mobId: string): RaidAtlasFace | null;
  readonly version: number;
}

function greyCopy(img: HTMLImageElement, tone: string): CanvasImageSource {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext('2d');
  if (!g) return img;
  g.drawImage(img, 0, 0);
  // Keep the luminance, drop the hue: a stone statue of the boss.
  g.globalCompositeOperation = 'saturation';
  g.fillStyle = tone;
  g.fillRect(0, 0, canvas.width, canvas.height);
  // Restore the bust's own alpha (the fill covered the transparent margin).
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  return canvas;
}

export class RaidAtlasPortraits implements RaidAtlasFaceSource {
  private readonly faces = new Map<string, RaidAtlasFace | null>();
  version = 0;

  /** `onLoad` runs after each face lands (repaint the map and the minimap). */
  constructor(private readonly onLoad: () => void) {}

  face(mobId: string): RaidAtlasFace | null {
    const known = this.faces.get(mobId);
    if (known !== undefined) return known;
    this.faces.set(mobId, null);
    if (typeof Image === 'undefined') return null;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      let grey: CanvasImageSource | null = null;
      this.faces.set(mobId, {
        color: img,
        grey: (tone) => {
          grey ??= greyCopy(img, tone);
          return grey;
        },
      });
      this.version++;
      this.onLoad();
    };
    // A missing bust leaves the crest medallion in its place.
    img.onerror = () => undefined;
    img.src = raidAtlasPortraitUrl(mobId);
    return null;
  }
}
