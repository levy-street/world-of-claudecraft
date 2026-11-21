// The boss card on the raid atlas MINIMAP (DOM). Touch has no hover, so a tap
// on a boss medallion of the round minimap opens the same parchment card the
// M-map shows (raid_atlas_boss_card.ts) beside the minimap; a tap on the same
// medallion, anywhere else on the minimap, or anywhere off it closes it.
//
// The card lives next to #minimap-wrap (a sibling under the same HUD parent,
// absolutely placed), so it takes the HUD's stacking without a global layer.
// Geometry is read ONCE per tap (the minimap's rect, the parent's, the
// viewport); each later minimap paint only re-places it on its medallion as
// the player moves (the minimap does not move on screen), refreshes its
// content keyed on the boss's state, and closes it if the medallion left the
// disc. No per-frame layout read, no repeating driver.

import { RaidAtlasBossCard } from './raid_atlas_boss_card';
import { raidAtlasMinimapCardPlacement } from './raid_atlas_boss_core';
import type { RaidAtlasBossMark } from './raid_atlas_view';

/** What the card needs from a tap: the minimap canvas and the tapped point. */
export interface RaidAtlasMinimapTap {
  canvas: HTMLCanvasElement;
  clientX: number;
  clientY: number;
}

interface TapGeometry {
  /** The minimap's client rect and its CSS px size (the painter's square). */
  disc: { left: number; top: number; right: number; bottom: number };
  scale: number;
  /** The card parent's client origin. */
  originX: number;
  originY: number;
  viewport: { w: number; h: number };
}

export class RaidAtlasMinimapCard {
  private card: RaidAtlasBossCard | null = null;
  private openId: string | null = null;
  private geometry: TapGeometry | null = null;
  private canvas: HTMLCanvasElement | null = null;

  isOpen(): boolean {
    return this.openId !== null;
  }

  /** A tap on the minimap of CSS side `size`; `hit` finds the medallion
   *  under a minimap point. Returns true when the tap was spent here (opening
   *  or closing a card). The minimap's rect is read here, once per tap. */
  tap(
    tap: RaidAtlasMinimapTap,
    size: number,
    hit: (
      x: number,
      y: number,
    ) => { mark: RaidAtlasBossMark; spot: { sx: number; sy: number } } | null,
  ): boolean {
    const rect = tap.canvas.getBoundingClientRect();
    const k = rect.width > 0 ? size / rect.width : 0;
    const found = k > 0 ? hit((tap.clientX - rect.left) * k, (tap.clientY - rect.top) * k) : null;
    if (!found) {
      if (this.openId === null) return false;
      this.close();
      return true;
    }
    const { mark, spot } = found;
    if (this.openId === mark.boss.id) {
      this.close();
      return true;
    }
    const card = this.ensureCard(tap.canvas);
    if (!card) return false;
    const parent = card.el.parentElement?.getBoundingClientRect();
    this.canvas = tap.canvas;
    this.geometry = {
      disc: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      scale: rect.width > 0 ? rect.width / size : 1,
      originX: parent?.left ?? 0,
      originY: parent?.top ?? 0,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
    this.openId = mark.boss.id;
    card.setOpen(true);
    card.fill(mark);
    this.place(spot);
    document.addEventListener('pointerdown', this.outsidePress, true);
    return true;
  }

  /** Each atlas minimap paint: keep the card on its medallion and its state. */
  follow(
    marks: readonly RaidAtlasBossMark[],
    spotOf: (id: string) => { sx: number; sy: number } | null,
  ): void {
    if (this.openId === null || !this.card) return;
    const mark = marks.find((m) => m.boss.id === this.openId);
    const spot = spotOf(this.openId);
    if (!mark || !spot) {
      this.close();
      return;
    }
    this.card.fill(mark);
    this.place(spot);
  }

  close(): void {
    if (this.openId === null) return;
    this.openId = null;
    this.card?.setOpen(false);
    document.removeEventListener('pointerdown', this.outsidePress, true);
  }

  /** A press off the minimap closes the card (one on the minimap is its own tap). */
  private readonly outsidePress = (ev: Event): void => {
    const target = ev.target as Node | null;
    if (target && this.canvas?.contains(target)) return;
    this.close();
  };

  private ensureCard(canvas: HTMLCanvasElement): RaidAtlasBossCard | null {
    if (this.card) return this.card;
    const wrap = canvas.closest<HTMLElement>('#minimap-wrap') ?? canvas.parentElement;
    const parent = wrap?.parentElement;
    if (!parent) return null;
    this.card = new RaidAtlasBossCard(parent, 'raid-atlas-boss-card is-minimap');
    return this.card;
  }

  private place(spot: { sx: number; sy: number }): void {
    const g = this.geometry;
    const card = this.card;
    if (!g || !card) return;
    const pin = { x: g.disc.left + spot.sx * g.scale, y: g.disc.top + spot.sy * g.scale };
    const at = raidAtlasMinimapCardPlacement(pin, g.disc, card.size(), g.viewport);
    card.place(at.left - g.originX, at.top - g.originY);
  }
}
