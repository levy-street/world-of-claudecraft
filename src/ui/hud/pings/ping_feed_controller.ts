// What the group's pings do on this client beyond the world icon (the
// renderer draws that, render/party_pings.ts): each NEW ping in view plays
// its kind's sound once and writes its chat callout once (ping_chat_line.ts:
// the kind's badge, the sender, the callout in the kind's colour, the unit's
// name in its reaction colour; settings.partyPingsChat can drop it), and every live
// ping in view sits on the minimap as its badge (pulled in to the rim when
// it lies past it). Every decision is in ping_feed_core.ts.
//
// With pings turned off (settings.partyPings) nothing here shows or sounds,
// and the pings that arrive meanwhile are marked seen, so turning the option
// back on never replays a backlog.
//
// Driven from the HUD's fast band (~10 Hz), like the minimap it decorates;
// its per-tick writes go through the shared PainterHost writers.

import type { PartyPing } from '../../../sim/social/party_pings';
import type { Entity } from '../../../sim/types';
import type { PainterHostWriters } from '../../painter_host';
import { pingIconUrl } from '../../ping_icons';
import { pingChatLineNodes } from './ping_chat_line';
import { pingChatLineModel, pingTargetReaction } from './ping_chat_line_core';
import {
  PING_SOUNDS,
  pingInView,
  pingMinimapPoint,
  pingTargetName,
  takeNewPings,
} from './ping_feed_core';

/** The minimap canvas's size and the rim a mark is pulled in to (canvas px). */
const MINIMAP_PX = 162;
const MINIMAP_RIM_PX = 70;
export interface PingFeedWorld {
  partyPings(): readonly PartyPing[];
  readonly player: { pos: { x: number; z: number } };
  readonly entities: ReadonlyMap<number, Entity>;
}

export interface PingFeedDeps {
  doc: Document;
  writers: PainterHostWriters;
  world: () => PingFeedWorld;
  /** settings.partyPings. */
  enabled: () => boolean;
  /** settings.partyPingsChat: whether a ping writes its chat line (default on). */
  chatEnabled?: () => boolean;
  /** Write one chat line: its body nodes, and the same line as plain text. */
  log: (nodes: readonly Node[], plain: string) => void;
  /** Whether the viewer can attack `e` (the unit name's reaction colour). */
  attackable?: (e: Entity) => boolean;
  /** Open the chat player menu for a player name in the line. */
  openPlayerMenu?: (name: string, anchor: HTMLElement, x?: number, y?: number) => void;
  /** Play a sampled UI cue. */
  sound: (key: string, rate: number, gain: number) => void;
  /** The minimap's pixels per yard right now (base scale times zoom). */
  minimapScale: () => number;
  /** The minimap disc the marks overlay (#minimap-disc). */
  minimapHost: () => HTMLElement | null;
}

export class PingFeedController {
  private readonly seen = new Set<number>();
  private layer: HTMLDivElement | null = null;
  private readonly marks: { el: HTMLDivElement; img: HTMLImageElement; kind: number }[] = [];
  private shown = 0;

  constructor(private readonly deps: PingFeedDeps) {}

  /** One fast-band tick. */
  frame(): void {
    const world = this.deps.world();
    const pings = world.partyPings();
    if (pings.length === 0 && this.seen.size === 0 && this.shown === 0) return;
    const fresh = takeNewPings(this.seen, pings);
    if (!this.deps.enabled()) {
      this.paintMinimap([], world);
      return;
    }
    const at = world.player.pos;
    for (const ping of fresh) {
      // Already live when this client (re)joined: drawn, never announced again.
      if (ping.known || !pingInView(ping, at)) continue;
      const sound = PING_SOUNDS[ping.kind];
      if (sound) this.deps.sound(sound.key, sound.rate, sound.gain);
      if (this.deps.chatEnabled && !this.deps.chatEnabled()) continue;
      this.writeLine(ping, world);
    }
    this.paintMinimap(pings, world);
  }

  private writeLine(ping: PartyPing, world: PingFeedWorld): void {
    let target: { name: string; reaction: ReturnType<typeof pingTargetReaction> } | null = null;
    if (ping.target !== null) {
      const live = world.entities.get(ping.target);
      const attackable = this.deps.attackable;
      const reaction = pingTargetReaction(
        ping.targetKind,
        live && attackable ? { attackable: attackable(live), hostile: live.hostile } : null,
      );
      target = { name: pingTargetName(ping, live), reaction };
    }
    const model = pingChatLineModel(ping, target);
    const nodes = pingChatLineNodes(this.deps.doc, model, {
      openPlayerMenu: this.deps.openPlayerMenu,
      targetIsPlayer: ping.targetKind === 'player',
    });
    this.deps.log(nodes, model.plain);
  }

  private paintMinimap(pings: readonly PartyPing[], world: PingFeedWorld): void {
    const at = world.player.pos;
    let n = 0;
    if (pings.length > 0) {
      const layer = this.ensureLayer();
      if (layer) {
        const scale = this.deps.minimapScale();
        for (const ping of pings) {
          if (!pingInView(ping, at)) continue;
          const live = ping.target === null ? undefined : world.entities.get(ping.target);
          const pos = live ? live.pos : ping;
          const p = pingMinimapPoint(pos, at, scale, MINIMAP_PX, MINIMAP_RIM_PX);
          const mark = this.mark(layer, n++);
          if (mark.kind !== ping.kind) {
            mark.kind = ping.kind;
            mark.img.src = pingIconUrl(ping.kind, 32);
          }
          const w = this.deps.writers;
          w.setTransform(mark.el, `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`);
          w.toggleClass(mark.el, 'is-edge', p.edge);
          w.setDisplay(mark.el, 'block');
        }
      }
    }
    for (let i = n; i < this.shown; i++) this.deps.writers.setDisplay(this.marks[i].el, 'none');
    this.shown = n;
  }

  private ensureLayer(): HTMLDivElement | null {
    if (this.layer) return this.layer;
    const host = this.deps.minimapHost();
    if (!host) return null;
    const layer = this.deps.doc.createElement('div');
    layer.className = 'ping-minimap-layer';
    layer.setAttribute('aria-hidden', 'true');
    host.appendChild(layer);
    this.layer = layer;
    return layer;
  }

  private mark(layer: HTMLDivElement, i: number) {
    const have = this.marks[i];
    if (have) return have;
    const el = this.deps.doc.createElement('div');
    el.className = 'ping-minimap-mark';
    el.style.display = 'none';
    const img = this.deps.doc.createElement('img');
    img.alt = '';
    img.draggable = false;
    el.appendChild(img);
    layer.appendChild(el);
    const made = { el, img, kind: -1 };
    this.marks.push(made);
    return made;
  }
}
