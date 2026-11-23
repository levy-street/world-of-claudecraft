// The three additions of Zulgar's hunt rework as one member of WildheartFx
// (basin_fx.ts): the sun glyphs and the Sunstruck window (zulgar_glyph_fx.ts),
// the Hunting Spear (zulgar_spear_fx.ts) and the Idol's Breath
// (idol_breath_fx.ts). It owns no mesh of its own: it hands each painter the
// scan, the frame and the events, and tells the coordinator how hard the stone
// jaguar's eyes and throat burn. Plan: zulgar_hunt_fx_core.ts.

import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { BasinFxHost } from './basin_fx_host';
import { IdolBreathFx } from './idol_breath_fx';
import { ZulgarGlyphFx } from './zulgar_glyph_fx';
import { ZulgarSpearFx } from './zulgar_spear_fx';

export class ZulgarHuntFx {
  private readonly glyphs: ZulgarGlyphFx;
  private readonly spears: ZulgarSpearFx;
  private readonly idol: IdolBreathFx;

  constructor(host: BasinFxHost, world: IWorld) {
    this.glyphs = new ZulgarGlyphFx(host, world);
    this.spears = new ZulgarSpearFx(host, world);
    this.idol = new IdolBreathFx(host, world);
  }

  /** The scan begins: Zulgar is forgotten until it sees him again. */
  beginScan(): void {
    this.glyphs.setZulgar(null);
    this.idol.setZulgar(null);
  }

  /** The scan saw Zulgar. */
  scanZulgar(e: Entity): void {
    this.glyphs.setZulgar(e);
    this.idol.setZulgar(e);
  }

  /** An encounter object: a sun glyph, or the idol's breath over its half. */
  scanObject(e: Entity): void {
    this.glyphs.scanObject(e);
    this.idol.scanObject(e);
  }

  /** A player: a Pinned one names their spear. */
  scanPlayer(e: Entity): void {
    this.spears.scanPlayer(e);
  }

  update(dt: number, clock: number): void {
    this.glyphs.update(dt, clock);
    this.spears.update(dt, clock);
    this.idol.update(dt, clock);
  }

  /** True when the event was one of the rework's own. */
  handleEvent(ev: Extract<SimEvent, { type: 'spellfx' }>, src: Entity): boolean {
    return (
      this.glyphs.handleEvent(ev) ||
      this.spears.handleEvent(ev, src) ||
      this.idol.handleEvent(ev, src)
    );
  }

  /** How hard the stone jaguar's eyes burn for its breath (0 asleep). */
  idolEyes(): number {
    return this.idol.eyes();
  }

  /** How hard the jade burns in its throat (0 asleep). */
  idolThroat(): number {
    return this.idol.throat();
  }

  hideAll(): void {
    this.glyphs.hideAll();
    this.spears.hideAll();
    this.idol.hideAll();
  }

  dispose(): void {
    this.glyphs.dispose();
    this.spears.dispose();
    this.idol.dispose();
  }
}
