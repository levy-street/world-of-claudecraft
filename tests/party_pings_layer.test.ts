// @vitest-environment happy-dom
// The party pings in the world, the pooled Three layer
// (src/render/party_pings.ts): every slot built up front and hidden, a ping
// shows its icon and ring (a unit ping following its unit), the cosmetic
// glow and stem shed on the low preset while the icon and ring draw the
// same (graphics fairness), Enable Pings off draws nothing, and the prewarm
// entry stages every material.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setting = { on: true };
vi.mock('../src/ui/ping_icons', () => ({
  pingIconCanvas: () => document.createElement('canvas'),
}));
vi.mock('../src/game/party_pings_setting', () => ({
  partyPingsEnabled: () => setting.on,
}));

import { PartyPingLayer, partyPingPrewarmEntry } from '../src/render/party_pings';
import {
  PARTY_PING_HEAD_LIFT,
  PARTY_PING_POP_S,
  PARTY_PING_SLOTS,
  type PartyPingMark,
} from '../src/render/party_pings_core';
import { prewarmResumeIsDebt } from '../src/render/prewarm_policy';
import { PING_ATTACK, PING_LOOK } from '../src/sim/social/party_pings';

const mark = (id: number, over: Partial<PartyPingMark> = {}): PartyPingMark => ({
  id,
  kind: PING_LOOK,
  target: null,
  x: 10,
  y: 2,
  z: -5,
  ...over,
});

function layer(
  lowTier: boolean,
  views = new Map<number, { group: THREE.Object3D; height: number }>(),
) {
  const scene = new THREE.Scene();
  const l = new PartyPingLayer(scene, lowTier, (id) => views.get(id));
  const camera = new THREE.PerspectiveCamera(60);
  camera.position.set(0, 10, 30);
  return { scene, l, camera, views };
}

const pieces = (scene: THREE.Scene, name: string) =>
  scene.getObjectByName('party-pings')?.children.filter((c) => c.name === name) ?? [];

describe('party ping layer', () => {
  beforeEach(() => {
    setting.on = true;
  });

  it('builds every slot up front, hidden, and adds nothing later', () => {
    const { scene, l, camera } = layer(false);
    for (const n of ['party-ping-ring', 'party-ping-stem', 'party-ping-glow', 'party-ping-icon'])
      expect(pieces(scene, n)).toHaveLength(PARTY_PING_SLOTS);
    expect(scene.getObjectByName('party-pings')?.children.every((c) => !c.visible)).toBe(true);
    const before = scene.getObjectByName('party-pings')?.children.length;
    l.update([mark(1), mark(2)], camera, 0, false);
    expect(scene.getObjectByName('party-pings')?.children.length).toBe(before);
    expect(l.shown).toBe(2);
    l.update([], camera, 1, false);
    expect(l.shown).toBe(0);
    expect(scene.getObjectByName('party-pings')?.children.every((c) => !c.visible)).toBe(true);
  });

  it('a ground ping stands its icon over the point with its ring on the floor', () => {
    const { scene, l, camera } = layer(false);
    l.update([mark(1)], camera, 0, false);
    l.update([mark(1)], camera, PARTY_PING_POP_S, false);
    const icon = pieces(scene, 'party-ping-icon').find((c) => c.visible) as THREE.Sprite;
    const ring = pieces(scene, 'party-ping-ring').find((c) => c.visible) as THREE.Mesh;
    expect(icon.position.x).toBe(10);
    expect(icon.position.y).toBeGreaterThan(2 + 1.5);
    expect(ring.position.y).toBeCloseTo(2, 0);
    expect(icon.scale.x).toBeGreaterThan(0);
    expect((icon.material as THREE.SpriteMaterial).depthTest).toBe(false);
  });

  it('a unit ping follows its unit as this client draws it', () => {
    const views = new Map<number, { group: THREE.Object3D; height: number }>();
    const group = new THREE.Group();
    group.position.set(40, 1, 50);
    views.set(7, { group, height: 2 });
    const { scene, l, camera } = layer(false, views);
    l.update([mark(1, { kind: PING_ATTACK, target: 7 })], camera, 0, false);
    const icon = pieces(scene, 'party-ping-icon').find((c) => c.visible) as THREE.Sprite;
    expect(icon.position.x).toBe(40);
    // Over the head, and lifted clear of the unit's nameplate.
    expect(icon.position.y).toBeGreaterThan(1 + 2 + PARTY_PING_HEAD_LIFT);
    group.position.set(44, 1, 52);
    l.update([mark(1, { kind: PING_ATTACK, target: 7 })], camera, 0.5, false);
    expect(icon.position.x).toBe(44);
    // A unit ping draws no stem through its unit.
    expect(pieces(scene, 'party-ping-stem').some((c) => c.visible)).toBe(false);
  });

  it('the low preset sheds only the glow and stem; the icon and ring draw the same', () => {
    const hi = layer(false);
    const lo = layer(true);
    for (const t of [0, 1]) {
      hi.l.update([mark(1)], hi.camera, t, false);
      lo.l.update([mark(1)], lo.camera, t, false);
    }
    const shown = (s: THREE.Scene, n: string) => pieces(s, n).filter((c) => c.visible);
    expect(shown(lo.scene, 'party-ping-glow')).toHaveLength(0);
    expect(shown(lo.scene, 'party-ping-stem')).toHaveLength(0);
    expect(shown(hi.scene, 'party-ping-glow')).toHaveLength(1);
    const hiIcon = shown(hi.scene, 'party-ping-icon')[0] as THREE.Sprite;
    const loIcon = shown(lo.scene, 'party-ping-icon')[0] as THREE.Sprite;
    expect(loIcon.scale.x).toBe(hiIcon.scale.x);
    expect(loIcon.position.y).toBe(hiIcon.position.y);
    expect(shown(lo.scene, 'party-ping-ring')).toHaveLength(1);
  });

  it('with Enable Pings off nothing draws', () => {
    setting.on = false;
    const { l, camera } = layer(false);
    l.update([mark(1)], camera, 0, false);
    expect(l.shown).toBe(0);
  });

  it('the prewarm entry uploads the icons and glow and links a staged twin', async () => {
    const { l } = layer(false);
    const textures: THREE.Texture[] = [];
    const roots: THREE.Object3D[] = [];
    const entry = partyPingPrewarmEntry(l, {
      prewarmTexture: (t) => textures.push(t),
      compileColor: async (r) => {
        roots.push(r);
      },
    });
    expect(entry.id).toBe('vfx.party-pings');
    await entry.run();
    expect(textures).toHaveLength(6);
    expect(roots).toHaveLength(1);
    expect(roots[0].children.every((c) => c.visible)).toBe(true);
    expect(roots[0].children).toHaveLength(PARTY_PING_SLOTS * 4);
    expect(entry.resumeUnits()).toHaveLength(6);
    expect(entry.resumeProgramUnits()).toHaveLength(1);
    // A dropped entry's program links resume as debt, never as cosmetic work.
    expect(prewarmResumeIsDebt(`programs.${entry.id}`)).toBe(true);
    // The renderer builds it, prewarms it beside the world markers and disposes it.
    const renderer = readFileSync(`${process.cwd()}/src/render/renderer.ts`, 'utf8');
    expect(renderer).toContain('partyPingPrewarmEntry(this.pings, overlayPrewarmHost),');
    expect(renderer).toContain('bestEffort(() => this.pings.dispose());');
    expect(renderer).toContain('this.pings.update(this.sim.partyPings(),');
    l.dispose();
    expect(l.isDisposed).toBe(true);
    expect(entry.resumeUnits()).toHaveLength(0);
  });
});
