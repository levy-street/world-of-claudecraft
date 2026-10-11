// The trash engine's usable bodies (G3, sim/mob/trash_kit/encounter_use.ts):
// a living body whose template kit carries `usable` (the Soul Brazier's
// Topple Brazier) shows the local player, once within USE_HINT_RANGE, a
// floating USE glyph over it (a boot mid-kick in a mint badge: an
// opportunity, never a threat colour) and a soft dashed ring on the floor at
// the use's reach, which lights up once they stand inside it. While any
// player channels the use (their castingAbility starts with
// KIT_USE_CAST_PREFIX and castTargetId is the body) an effort arc fills round
// the body over the bar and dust and sparks shake off it; on completion
// (spellfx 'nova', ability = the use's cast id, player -> body) it is struck
// over away from the user: a burst of dust and the hazard's colour. A
// dungeon's own layer adds the body's fall (gravewyrm_sanctum_fx's toppled
// brazier).
//
// The glyph and the reach ring are ACTIONABLE (every tier); the effort's dust
// and sparks are cosmetic. Built once under the host's root before its gated
// attach; no light; no per-frame allocation.

import * as THREE from 'three';
import { type Entity, isKitUseCast, type KitUseDef, type SimEvent } from '../../sim/types';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { billboardMaterial, useGlyphTexture } from './engine_glyphs';
import { rgbOf, SCHOOL_TINT, USE_HINT_RANGE, type UseHint, useHint } from './trash_engine_fx_core';
import type { TrashEngineHost } from './trash_engine_host';

const SLOTS = 6;

type KitUseSchool = keyof typeof SCHOOL_TINT;

/** The school a use's beats are tinted in (a topple's spill, else its own). */
function useSchool(def: KitUseDef): KitUseSchool {
  return def.effect.kind === 'topple' ? def.effect.hazard.school : def.effect.school;
}
const MINT = 0x9dffcf;

const RING_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The reach ring (dashes running round) and the effort arc (filling). */
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uFill;
uniform float uLit;
uniform float uTime;
uniform float uArc;
varying vec2 vP;
void main() {
  float r = length(vP);
  float ang = atan(vP.x, vP.y) / 6.2831853 + 0.5;
  float band = smoothstep(0.86, 0.9, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float a;
  if (uArc > 0.5) {
    float swept = step(ang, uFill);
    a = band * (0.25 + 0.75 * swept);
  } else {
    float dash = step(0.45, fract(ang * 36.0 - uTime * 0.6));
    a = band * (0.35 + 0.45 * dash) * (0.6 + 0.4 * uLit);
    a += (1.0 - smoothstep(0.0, 0.9, r)) * 0.06 * uLit;
  }
  gl_FragColor = vec4(uColor * (1.0 + uLit * 0.4), a * uAlpha);
}
`;

interface UseSlot {
  bodyId: number;
  def: KitUseDef | null;
  /** A player channelling it (or -1). */
  userId: number;
  emit: number;
  glyph: THREE.Mesh;
  glyphMat: THREE.ShaderMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  arc: THREE.Mesh;
  arcMat: THREE.ShaderMaterial;
}

export class EngineUse {
  private readonly slots: UseSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly texture: THREE.Texture | null;
  private readonly hint: UseHint = { glyph: 0, ring: 0, inReach: false };

  constructor(private readonly host: TrashEngineHost) {
    this.texture = useGlyphTexture();
    const quad = new THREE.PlaneGeometry(1, 1);
    const disc = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);
    this.geometries.push(quad, disc);
    const ringMat = (name: string, arc: boolean) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uColor: { value: new THREE.Color(MINT) },
          uAlpha: { value: 0 },
          uFill: { value: 0 },
          uLit: { value: 0 },
          uTime: host.uTime,
          uArc: { value: arc ? 1 : 0 },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(m);
      return m;
    };
    for (let i = 0; i < SLOTS; i++) {
      const glyphMat = billboardMaterial('trashEngineUseGlyph', this.texture, 0, false);
      this.materials.push(glyphMat);
      const glyph = new THREE.Mesh(quad, glyphMat);
      glyph.frustumCulled = false;
      glyph.visible = false;
      glyph.renderOrder = floorVfxRenderOrder('encounter', 29);
      host.root.add(glyph);
      const rm = ringMat('trashEngineUseReach', false);
      const ring = new THREE.Mesh(disc, rm);
      ring.visible = false;
      ring.renderOrder = floorVfxRenderOrder('encounter', 11);
      host.root.add(ring);
      const am = ringMat('trashEngineUseEffort', true);
      const arc = new THREE.Mesh(disc, am);
      arc.visible = false;
      arc.renderOrder = floorVfxRenderOrder('encounter', 13);
      host.root.add(arc);
      this.slots.push({
        bodyId: -1,
        def: null,
        userId: -1,
        emit: 0,
        glyph,
        glyphMat,
        ring,
        ringMat: rm,
        arc,
        arcMat: am,
      });
    }
  }

  /** A mob seen by the scan: claim it when it is a usable body. */
  scanBody(e: Entity, use: KitUseDef): void {
    if (e.dead || e.hp <= 0) return;
    if (this.slots.some((s) => s.bodyId === e.id)) return;
    const slot = this.slots.find((s) => s.bodyId < 0);
    if (!slot) return;
    slot.bodyId = e.id;
    slot.def = use;
    slot.userId = -1;
    slot.emit = 0;
  }

  /** A player seen by the scan: is it channelling a use on a claimed body? */
  scanUser(p: Entity): void {
    if (!isKitUseCast(p.castingAbility) || p.castTargetId === null) return;
    const slot = this.slots.find((s) => s.bodyId === p.castTargetId);
    if (slot && slot.userId < 0) slot.userId = p.id;
  }

  /** A use's beat. True when drawn here. */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx' || !ev.ability) return false;
    const def = this.host.catalog.uses.get(ev.ability);
    if (!def) return false;
    if (ev.fx === 'windup') {
      // The press landed: the user plants a foot (the arc takes it from here).
      const slot = this.slots.find((s) => s.bodyId === ev.targetId);
      if (slot) slot.userId = ev.sourceId;
      return true;
    }
    this.struck(ev.sourceId, ev.targetId, def);
    return true;
  }

  /** The use completed: the body is struck over, away from its user. */
  private struck(userId: number, bodyId: number, def: KitUseDef): void {
    const h = this.host;
    const body = h.world.entities.get(bodyId);
    const user = h.world.entities.get(userId);
    if (!body) return;
    const gy = h.groundY(body.pos.x, body.pos.z);
    const bh = h.bodyHeight(body);
    let dx = 0;
    let dz = 1;
    if (user) {
      const len = Math.hypot(body.pos.x - user.pos.x, body.pos.z - user.pos.z) || 1;
      dx = (body.pos.x - user.pos.x) / len;
      dz = (body.pos.z - user.pos.z) / len;
    }
    const color = SCHOOL_TINT[useSchool(def)] ?? SCHOOL_TINT.shadow;
    h.shockRing(body.pos.x, body.pos.z, 0xf0f4f6, 3, 0.35);
    h.puff(body.pos.x, gy + 0.3, body.pos.z, 26, {
      speed: 4.5,
      up: 0.8,
      life: 1.3,
      size: [0.8, 2.4],
      color: [0.9, 0.93, 0.96],
      alpha: 0.5,
      dir: [dx, 0.25, dz],
      spread: 0.7,
      drag: 2.4,
    });
    h.puff(body.pos.x, gy + bh * 0.6, body.pos.z, 22, {
      speed: 5,
      up: 2,
      life: 0.7,
      size: [0.24, 0.05],
      color: rgbOf(color),
      alpha: 1,
      pool: 'glow',
      dir: [dx, 0.5, dz],
      spread: 0.5,
      gravity: 6,
    });
    if (!h.reducedMotion()) h.shake(0.15);
    const slot = this.slots.find((s) => s.bodyId === bodyId);
    if (slot) this.release(slot);
  }

  update(dt: number, clock: number): void {
    const h = this.host;
    const world = h.world;
    const me = world.player;
    for (const slot of this.slots) {
      if (slot.bodyId < 0 || !slot.def) continue;
      const body = world.entities.get(slot.bodyId);
      if (!body || body.dead || body.hp <= 0) {
        this.release(slot);
        continue;
      }
      const def = slot.def;
      const gy = h.groundY(body.pos.x, body.pos.z);
      const bh = h.bodyHeight(body);
      const d = me && !me.dead ? Math.hypot(me.pos.x - body.pos.x, me.pos.z - body.pos.z) : 1e9;
      const hint = useHint(d, def.range, this.hint);
      // The user's bar (anyone's, so the whole group sees it being kicked).
      const user = slot.userId >= 0 ? world.entities.get(slot.userId) : undefined;
      const channelling =
        !!user && !user.dead && user.castingAbility === def.castId && user.castTargetId === body.id;
      if (!channelling) slot.userId = -1;
      const showHint = d <= USE_HINT_RANGE && !channelling;
      slot.glyph.visible = showHint && hint.glyph > 0;
      slot.ring.visible = showHint && hint.ring > 0;
      if (slot.glyph.visible) {
        const bob = Math.sin(clock * 2.6 + body.id) * 0.12;
        slot.glyph.position.set(body.pos.x, gy + bh + 0.95 + bob, body.pos.z);
        const u = slot.glyphMat.uniforms;
        u.uSize.value = hint.inReach ? 1.35 + 0.08 * Math.sin(clock * 6) : 1.15;
        u.uAlpha.value = hint.glyph;
      }
      if (slot.ring.visible) {
        slot.ring.position.set(body.pos.x, gy + 0.08, body.pos.z);
        slot.ring.scale.set(def.range, 1, def.range);
        const u = slot.ringMat.uniforms;
        u.uAlpha.value = hint.ring * 0.85;
        u.uLit.value = hint.inReach ? 0.75 + 0.25 * Math.sin(clock * 5) : 0;
      }
      slot.arc.visible = channelling;
      if (channelling && user) {
        const fill =
          user.castTotal > 0
            ? Math.min(1, Math.max(0, 1 - user.castRemaining / user.castTotal))
            : 1;
        const r = Math.max(1.1, bh * 0.5);
        slot.arc.position.set(body.pos.x, gy + 0.1, body.pos.z);
        slot.arc.scale.set(r, 1, r);
        slot.arc.rotation.y = Math.atan2(user.pos.x - body.pos.x, user.pos.z - body.pos.z);
        slot.arcMat.uniforms.uFill.value = fill;
        slot.arcMat.uniforms.uAlpha.value = 0.95;
        // The strain: dust kicked off its foot, sparks shaken loose.
        slot.emit += dt * (10 + 30 * fill) * h.density;
        while (slot.emit >= 1) {
          slot.emit -= 1;
          h.puff(body.pos.x, gy + 0.15, body.pos.z, 1, {
            speed: 1.4,
            up: 0.5,
            life: 0.8,
            size: [0.4, 1.2],
            color: [0.9, 0.92, 0.95],
            alpha: 0.35,
            radius: bh * 0.25,
            drag: 2,
          });
          if (h.rand() < 0.5)
            h.puff(body.pos.x, gy + bh * 0.7, body.pos.z, 1, {
              speed: 1.6,
              up: 1.2,
              life: 0.5,
              size: [0.16, 0.04],
              color: rgbOf(SCHOOL_TINT[useSchool(def)] ?? SCHOOL_TINT.shadow),
              alpha: 1,
              pool: 'glow',
              radius: bh * 0.2,
              gravity: 5,
            });
        }
      }
    }
  }

  private release(slot: UseSlot): void {
    slot.bodyId = -1;
    slot.def = null;
    slot.userId = -1;
    slot.glyph.visible = false;
    slot.ring.visible = false;
    slot.arc.visible = false;
  }

  hideAll(): void {
    for (const s of this.slots) this.release(s);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.texture?.dispose();
  }
}
