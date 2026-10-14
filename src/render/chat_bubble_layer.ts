// Floating /say and /yell speech bubbles over entity heads, keyed by speaker
// entity id, moved out of renderer.ts. Each follows its entity and fades out
// after a few seconds (longer for longer messages), or after the caller's
// explicit ttl (short reaction barks like Goad's grawlix). DOM only; the
// renderer drives update() once a frame.

import * as THREE from 'three';
import type { ChatBubbleStyle } from '../ui/chat_bubble_style';
import type { IWorld } from '../world_api';
import {
  isProjectedNameplateAnchorVisible,
  nameplateScreenTransform,
} from './nameplate_projection';
import type { EntityView } from './renderer';

export interface ChatBubble {
  el: HTMLDivElement;
  until: number;
}

/** What the bubbles read from the renderer. */
export interface ChatBubbleHost {
  sim(): IWorld;
  /** The overlay the bubble elements live in. */
  layer(): HTMLElement;
  camera(): THREE.PerspectiveCamera;
  viewport(): { width: number; height: number };
  views(): ReadonlyMap<number, EntityView>;
}

export class ChatBubbleLayer {
  /** Live bubbles by speaker entity id. */
  readonly bubbles = new Map<number, ChatBubble>();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();

  constructor(private readonly host: ChatBubbleHost) {}

  show(entityId: number, text: string, style?: boolean | ChatBubbleStyle, ttlSec?: number): void {
    // Back-compat: the older 3-arg call passes a bare `yell` boolean; the chat
    // gate passes a full descriptor (the party channel tint).
    const s: ChatBubbleStyle = typeof style === 'boolean' ? { yell: style } : (style ?? {});
    let b = this.bubbles.get(entityId);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'chat-bubble';
      this.host.layer().appendChild(el);
      b = { el, until: 0 };
      this.bubbles.set(entityId, b);
    }
    b.el.textContent = text; // textContent: chat is player input, never HTML
    b.el.classList.toggle('yell', s.yell === true);
    // Channel bubbles (party/guild/officer) tint the BORDER only; the near-white
    // background and dark text stay for legibility. Clearing to '' restores the
    // stylesheet default (and the `.yell` border) when a reused bubble switches
    // channel, so say/yell/emote stay byte-identical.
    b.el.style.borderColor = s.border ?? '';
    b.el.style.marginTop = `${s.offsetY ?? 0}px`;
    // wall-clock ttl: sim/render time can run slower than real time under
    // frame-delta clamping, which would keep bubbles up too long
    b.until = performance.now() + 1000 * (ttlSec ?? Math.min(10, 3.5 + text.length * 0.045));
  }

  update(): void {
    if (this.bubbles.size === 0) return;
    const { width: w, height: h } = this.host.viewport();
    const camera = this.host.camera();
    const views = this.host.views();
    const now = performance.now();
    for (const [id, b] of this.bubbles) {
      const e = this.host.sim().entities.get(id);
      const v = e ? views.get(id) : undefined;
      if (now >= b.until) {
        b.el.remove();
        this.bubbles.delete(id);
        continue;
      }
      if (!e || !v) {
        b.el.style.display = 'none';
        continue;
      }
      // culled rigs (beyond ENTITY_DRAW_RANGE) stop updating group.position,
      // so a yell from 80 to 100u away would hang frozen over empty terrain:
      // fall back to the live entity position when the rig isn't being drawn
      if (v.group.visible) this.tmpV.copy(v.group.position);
      else this.tmpV.set(e.pos.x, e.pos.y, e.pos.z);
      this.tmpV.y += (v.height + v.mountLift) * e.scale + 1.0;
      if (!isProjectedNameplateAnchorVisible(camera, this.tmpV, this.tmpV2)) {
        b.el.style.display = 'none';
        continue;
      }
      this.tmpV.project(camera);
      if (this.tmpV.z < -1 || this.tmpV.z > 1) {
        b.el.style.display = 'none';
        continue;
      }
      b.el.style.display = '';
      const sx = (this.tmpV.x * 0.5 + 0.5) * w;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * h;
      b.el.style.transform = nameplateScreenTransform(sx, sy);
    }
  }

  /** Teardown: drop every bubble element (each removal best-effort). */
  clear(bestEffort: (fn: () => void) => void): void {
    for (const bubble of this.bubbles.values()) bestEffort(() => bubble.el.remove());
    this.bubbles.clear();
  }
}
