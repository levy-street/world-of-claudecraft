import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  activeKitPrewarmEntry,
  cancelActiveAbilityKit,
  ensureActiveAbilityKit,
} from '../src/render/ability_vfx/active_kit_prewarm';
import * as contact from '../src/render/ability_vfx/contact_assets';
import { EDICT_SHAPE, FinalEdict } from '../src/render/ability_vfx/final_edict';
import { AbilityVfx, type AbilityVfxDamageEvent } from '../src/render/ability_vfx/painter';
import { collectAbilityVfxCompileTargets } from '../src/render/ability_vfx/prewarm';
import * as assets from '../src/render/ability_vfx/production_assets';
import {
  EDICT_STAMP_DURATION,
  EDICT_TRAIL,
  EDICT_WAVE,
  EDICT_WAVE_EDGE_SEGMENTS,
  EDICT_WAVE_SHOCK_SEGMENTS,
  EDICT_WAVE_SPOKES,
  type EdictPart,
  type EdictSpark,
  edictAlpha,
  edictSlashWindow,
  edictWaveArrival,
  FINAL_EDICT_ABSORB_VERTICES,
  FINAL_EDICT_AFTER,
  FINAL_EDICT_CAPACITY,
  FINAL_EDICT_CLIP_CONTACT,
  FINAL_EDICT_LAND,
  FINAL_EDICT_SLASH_SEGMENTS,
  FINAL_EDICT_SPARKS,
  FINAL_EDICT_STAMP_VERTICES,
  FINAL_EDICT_VERTICES_PER_CAST,
  FINAL_EDICT_WAVE_DURATION,
  FINAL_EDICT_WAVE_VERTICES,
  FinalEdictContacts,
  finalEdictOutcome,
  sampleEdictSpark,
} from '../src/render/final_edict_core';

function fixture(camera?: THREE.Camera, groundY?: (x: number, z: number) => number) {
  const scene = new THREE.Scene();
  const positions = new Map([
    [1, new THREE.Vector3(0, 1, 0)],
    [2, new THREE.Vector3(0, 1, 2)],
  ]);
  // Positions are body points one yard up; fraction 0 is the feet.
  let feetLift = 0;
  const anchor = vi.fn((id: number, frac: number, out?: THREE.Vector3) => {
    const point = positions.get(id);
    if (!point) return null;
    if (!out) throw new Error('Anchor requires caller-owned storage');
    out.copy(point);
    if (frac === 0) out.y += feetLift - 1;
    return out;
  });
  const standOn = (height: number) => {
    feetLift = height;
  };
  const effect = new FinalEdict(scene, anchor, camera, groundY);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const host = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn((_group: THREE.Group, _child: THREE.Object3D) => {}),
  };
  const prepare = async () => {
    for (const unit of effect.preparation.units(host)) await unit.run();
  };
  return { scene, positions, anchor, effect, host, prepare, standOn };
}

const PARTS: EdictPart[] = ['weapon', 'slash', 'flare', 'ring', 'seal', 'spark'];
const SHAPES = EDICT_SHAPE;
/** Vertex layout once landed: the weapon, the chop, flare, seal, sparks. */
const WEAPON_START = 0;
const SLASH_START = 6;
const FLARE_START = SLASH_START + FINAL_EDICT_SLASH_SEGMENTS * 6;
const SEAL_START = FLARE_START + 6;
/** Seconds after the strike resolves to `since` after the blow lands. */
const landed = (since: number) => FINAL_EDICT_LAND + since;
function spark(): EdictSpark {
  return { forward: 0, up: 0, side: 0, vForward: 0, vUp: 0, vSide: 0, alpha: 0 };
}

describe('Final Edict confirmed contact', () => {
  it.each([
    ['hit', 20, 0, 'damage'],
    ['block', 5, 8, 'damage'],
    ['hit', 0, 30, 'absorb'],
    ['block', 0, 15, 'absorb'],
    ['hit', 0, 0, 'none'],
    ['miss', 0, 0, 'none'],
    ['dodge', 0, 0, 'none'],
    ['parry', 0, 0, 'none'],
    ['evade', 0, 0, 'none'],
  ])('classifies %s amount %s absorbed %s', (kind, amount, absorbed, expected) => {
    expect(finalEdictOutcome(String(kind), Number(amount), Number(absorbed))).toBe(expected);
  });

  it('pairs stable-id success and legacy-label avoidance without duplicating the companion', () => {
    const finalEdictContact = vi.fn();
    const receiveHit = vi.fn();
    const painter = Object.assign(Object.create(AbilityVfx.prototype), {
      deps: { fx: { finalEdictContact }, receiveHit },
      edictContacts: new FinalEdictContacts(),
    }) as AbilityVfx;
    const ev: AbilityVfxDamageEvent = {
      abilityId: 'final_edict',
      ability: 'Final Edict',
      sourceId: 1,
      targetId: 2,
      kind: 'hit',
      amount: 20,
      school: 'physical',
      crit: true,
    };
    const cue = () =>
      painter.handleSpellfx({ sourceId: 1, targetId: 2, school: 'holy', fx: 'paladinFinalEdict' });
    expect(painter.onDamage(ev)).toBe(true);
    expect(finalEdictContact).not.toHaveBeenCalled();
    // An untagged weapon echo between damage and companion cannot replace it.
    painter.onDamage({ ...ev, abilityId: undefined, targetId: 3 });
    cue();
    expect(finalEdictContact).toHaveBeenLastCalledWith(1, 2, 'damage', true, expect.any(Function));
    // The victim flinches only as the blow visibly lands.
    expect(receiveHit).not.toHaveBeenCalled();
    ((finalEdictContact.mock.lastCall as unknown[])[4] as () => void)();
    expect(receiveHit).toHaveBeenCalledExactlyOnceWith(2);
    painter.onDamage({ ...ev, amount: 0, absorbed: 40 });
    cue();
    expect(finalEdictContact).toHaveBeenLastCalledWith(1, 2, 'absorb', true, undefined);
    painter.onDamage({ ...ev, abilityId: undefined, amount: 0, kind: 'parry' });
    cue();
    expect(finalEdictContact).toHaveBeenLastCalledWith(1, 2, 'none', true, undefined);
    expect(cue()).toBe(true);
    expect(finalEdictContact).toHaveBeenCalledTimes(3);
    expect(receiveHit).toHaveBeenCalledTimes(1);
  });

  it('cannot turn Ascension area damage or stale/mismatched outcomes into another base strike', () => {
    const contacts = new FinalEdictContacts();
    contacts.record(1, 2, 'damage', false);
    expect(contacts.take(1, 2)?.outcome).toBe('damage');
    contacts.area(1, true);
    contacts.record(1, 2, 'damage', true);
    contacts.record(1, 3, 'damage', true);
    contacts.area(1, false);
    expect(contacts.take(1, 2)).toBeNull();
    contacts.record(1, 2, 'damage', false);
    expect(contacts.take(1, 3)).toBeNull();
    expect(contacts.take(1, 2)).toBeNull();
    contacts.record(1, 2, 'damage', false);
    contacts.clear();
    expect(contacts.take(1, 2)).toBeNull();
  });

  it("draws Ascension's explosion at its true reach and seals every enemy it strikes", () => {
    const finalEdictContact = vi.fn();
    const finalEdictVerdict = vi.fn();
    const finalEdictAreaHit = vi.fn();
    const painter = Object.assign(Object.create(AbilityVfx.prototype), {
      deps: { fx: { finalEdictContact, finalEdictVerdict, finalEdictAreaHit } },
      edictContacts: new FinalEdictContacts(),
    }) as AbilityVfx;
    const hit = (targetId: number, amount = 30): AbilityVfxDamageEvent => ({
      abilityId: 'final_edict',
      ability: 'Final Edict',
      sourceId: 1,
      targetId,
      kind: 'hit',
      amount,
      school: 'holy',
      crit: false,
    });
    const cue = (fx: string, range?: number) =>
      painter.handleSpellfx({
        sourceId: 1,
        targetId: 1,
        school: 'holy',
        fx,
        ability: 'final_edict',
        ...(range === undefined ? {} : { range }),
      });
    // The strike, then the explosion bracketed by its nova and impact cues.
    painter.onDamage(hit(2));
    painter.handleSpellfx({ sourceId: 1, targetId: 2, school: 'holy', fx: 'paladinFinalEdict' });
    expect(cue('nova', 6)).toBe(true);
    expect(finalEdictVerdict).toHaveBeenCalledExactlyOnceWith(1, 6);
    expect(painter.onDamage(hit(2))).toBe(true);
    expect(painter.onDamage(hit(3))).toBe(true);
    expect(painter.onDamage({ ...hit(4, 0), kind: 'dodge' })).toBe(true);
    expect(finalEdictAreaHit.mock.calls).toEqual([
      [1, 2, 'damage'],
      [1, 3, 'damage'],
      [1, 4, 'none'],
    ]);
    // The explosion is the Ascension cue: no generic burst follows it.
    expect(cue('paladinAscensionImpact')).toBe(true);
    expect(finalEdictContact).toHaveBeenCalledOnce();
    // After the bracket, hits are strikes again.
    painter.onDamage(hit(5));
    expect(finalEdictAreaHit).toHaveBeenCalledTimes(3);
  });

  it('prepares a newly requested class even when another class preparation is in flight', async () => {
    const f = fixture();
    const texture = new THREE.Texture();
    vi.spyOn(assets, 'warriorBloodTexture').mockReturnValue(texture);
    vi.spyOn(assets, 'warriorSteelTexture').mockReturnValue(texture);
    vi.spyOn(assets, 'warriorPressureTexture').mockReturnValue(texture);
    vi.spyOn(assets, 'warriorRockTexture').mockReturnValue(texture);
    vi.spyOn(assets, 'bakedTexture').mockReturnValue(texture);
    // The release's Warrior recipe uploads the contact sheets too.
    vi.spyOn(contact, 'contactTexture').mockReturnValue(texture);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const queue = {
      run: vi.fn(async (run: () => unknown) => {
        await pending;
        return run();
      }),
    };
    const geometry = vi.fn((_kinds, kit) =>
      kit === 'paladin' ? f.effect.preparation.units(f.host) : [],
    );
    activeKitPrewarmEntry(f.scene, 'warrior', {
      queue: queue as never,
      geometry,
      texture: vi.fn(),
    });
    const first = ensureActiveAbilityKit(f.scene, 'warrior');
    const second = ensureActiveAbilityKit(f.scene, 'paladin');
    expect(f.effect.preparation.ready('final_edict')).toBe(false);
    finish();
    await Promise.all([first, second]);
    expect(f.effect.preparation.ready('final_edict')).toBe(true);
    expect(f.host.draw).toHaveBeenCalledTimes(1);
    expect(geometry).toHaveBeenCalledWith([], 'paladin');
    cancelActiveAbilityKit(f.scene);
    f.effect.dispose();
    texture.dispose();
    vi.restoreAllMocks();
  });

  it('prepares the live buffers through the active Paladin kit and rejects cold casts', async () => {
    const f = fixture();
    expect(f.effect.spawn(1, 2, 'damage', false)).toBe(false);
    expect(collectAbilityVfxCompileTargets(f.scene).map((t) => t.object)).toContain(f.effect.mesh);
    const queue = { run: vi.fn(async (run: () => unknown) => run()) };
    activeKitPrewarmEntry(f.scene, 'paladin', {
      queue: queue as never,
      geometry: (_kinds, kit) => {
        expect(kit).toBe('paladin');
        return f.effect.preparation.units(f.host);
      },
      texture: () => {
        throw new Error('Final Edict needs no textures');
      },
    });
    await ensureActiveAbilityKit(f.scene);
    expect(f.host.draw).toHaveBeenCalledTimes(1);
    const carrier = f.host.draw.mock.calls[0]?.[1] as unknown as THREE.Mesh;
    expect(carrier.geometry).toBe(f.effect.mesh.geometry);
    expect(carrier.material).toBe(f.effect.mesh.material);
    expect(f.effect.spawn(1, 2, 'damage', false)).toBe(true);
    await ensureActiveAbilityKit(f.scene);
    expect(f.host.draw).toHaveBeenCalledTimes(1);
    cancelActiveAbilityKit(f.scene);
    f.effect.dispose();
  });
});

describe('Final Edict verdict timing', () => {
  it("lands as the lunging cut connects (the attack clip's contact)", () => {
    expect(FINAL_EDICT_LAND).toBe(FINAL_EDICT_CLIP_CONTACT);
  });

  it('gathers light on the rising weapon, then lands everything at once', () => {
    // Through the raise only the weapon is lit, and it grows.
    for (const part of ['flare', 'slash', 'ring', 'seal', 'spark'] as const)
      expect(edictAlpha(part, -0.1, false)).toBe(0);
    expect(edictAlpha('weapon', -FINAL_EDICT_LAND, false)).toBeGreaterThan(0.2);
    expect(edictAlpha('weapon', -0.05, false)).toBeGreaterThan(edictAlpha('weapon', -0.3, false));
    for (const part of ['weapon', 'flare', 'slash', 'ring', 'seal'] as const)
      expect(edictAlpha(part, 0, false)).toBeGreaterThan(0.8);
    expect(edictAlpha('flare', 0, true)).toBeGreaterThan(edictAlpha('flare', 0, false));
    // The weapon's light lingers past the flare, then is gone well before the end.
    expect(edictAlpha('weapon', 0.2, false)).toBeGreaterThan(edictAlpha('flare', 0.2, false));
    expect(edictAlpha('weapon', 0.45, false)).toBe(0);
    // The seal outlasts the blade.
    expect(edictAlpha('seal', 0.4, false)).toBeGreaterThan(0.2);
    expect(edictAlpha('slash', 0.4, false)).toBe(0);
  });

  it('sweeps the chop, then consumes it from its start', () => {
    const w = { head: 0, tail: 0 };
    edictSlashWindow(0.02, false, w);
    expect(w.head).toBeGreaterThan(0);
    expect(w.head).toBeLessThan(1);
    expect(w.tail).toBe(0);
    edictSlashWindow(0.15, false, w);
    expect(w.head).toBe(1);
    expect(w.tail).toBeGreaterThan(0);
    edictSlashWindow(0.4, false, w);
    expect(w.tail).toBe(1);
    edictSlashWindow(0, true, w);
    expect(w.head).toBe(1);
  });

  it('throws sparks onward and up, falling back under gravity, calmer for reduced motion', () => {
    const s = spark(),
      calm = spark();
    for (let i = 0; i < FINAL_EDICT_SPARKS; i++) {
      sampleEdictSpark(i, 0.12, false, false, s);
      sampleEdictSpark(i, 0.12, true, false, calm);
      if (s.alpha === 0) continue;
      expect(s.forward).toBeGreaterThan(0);
      expect(s.up).toBeGreaterThan(0);
      expect(Math.hypot(calm.forward, calm.up, calm.side)).toBeLessThan(
        Math.hypot(s.forward, s.up, s.side),
      );
    }
    sampleEdictSpark(0, 0.05, false, false, s);
    const rising = s.vUp;
    sampleEdictSpark(0, 0.25, false, false, s);
    expect(s.vUp).toBeLessThan(rising);
  });

  it('retires every part by the end of the cast', () => {
    const s = spark();
    for (const part of PARTS) {
      expect(edictAlpha(part, FINAL_EDICT_AFTER, true)).toBe(0);
      if (part !== 'weapon') expect(edictAlpha(part, -0.01, false)).toBe(0);
    }
    for (let i = 0; i < FINAL_EDICT_SPARKS; i++) {
      sampleEdictSpark(i, FINAL_EDICT_AFTER, false, true, s);
      expect(s.alpha).toBe(0);
    }
  });
});

describe('Final Edict prepared bounded geometry', () => {
  it('bounds overlap, uploads only live vertices, expires and reuses cleanly', async () => {
    const f = fixture();
    await f.prepare();
    for (let i = 0; i < FINAL_EDICT_CAPACITY * 3; i++) f.effect.spawn(1, 2, 'damage', i % 2 === 0);
    const geometry = f.effect.mesh.geometry;
    // Through the raise only the weapon gathers light.
    f.effect.update(0.1, false);
    expect(geometry.drawRange.count).toBe(FINAL_EDICT_CAPACITY * 6);
    f.effect.update(landed(0.08) - 0.1, false);
    expect(f.effect.mesh.visible).toBe(true);
    expect(FINAL_EDICT_VERTICES_PER_CAST).toBe(
      (3 + FINAL_EDICT_SLASH_SEGMENTS + FINAL_EDICT_SPARKS) * 6,
    );
    expect(geometry.drawRange.count).toBe(FINAL_EDICT_CAPACITY * FINAL_EDICT_VERTICES_PER_CAST);
    for (const name of [
      'position',
      'aColor',
      'aAlpha',
      'aUv',
      'aShape',
      'aGroundDistance',
      'aTime',
    ]) {
      const a = geometry.getAttribute(name) as THREE.BufferAttribute;
      expect(a.updateRanges).toEqual([{ start: 0, count: geometry.drawRange.count * a.itemSize }]);
      expect(Array.from(a.array).every(Number.isFinite)).toBe(true);
    }
    const shapes = Array.from(
      geometry.getAttribute('aShape').array.slice(0, FINAL_EDICT_VERTICES_PER_CAST),
    );
    const count = (shape: number) => shapes.filter((value) => value === shape).length;
    expect(count(SHAPES.weapon)).toBe(6);
    // One chop, as the Paladin chops once; the seal beneath the victim.
    expect(count(SHAPES.slash)).toBe(FINAL_EDICT_SLASH_SEGMENTS * 6);
    expect(count(SHAPES.flare)).toBe(6);
    expect(count(SHAPES.seal)).toBe(6);
    expect(count(SHAPES.ring)).toBe(0);
    expect(count(SHAPES.spark)).toBe(FINAL_EDICT_SPARKS * 6);
    f.effect.update(FINAL_EDICT_AFTER, false);
    expect(f.effect.mesh.visible).toBe(false);
    expect(geometry.drawRange.count).toBe(0);
    // An absorbed verdict only pings: the weapon's light, flare and shield ring.
    f.effect.spawn(1, 2, 'absorb', false);
    f.effect.update(landed(0), false);
    expect(geometry.drawRange.count).toBe(FINAL_EDICT_ABSORB_VERTICES);
    const absorbShapes = new Set(
      Array.from(geometry.getAttribute('aShape').array.slice(0, FINAL_EDICT_ABSORB_VERTICES)),
    );
    expect(absorbShapes).toEqual(new Set([SHAPES.weapon, SHAPES.flare, SHAPES.ring]));
    f.effect.clear();
    expect(f.effect.mesh.visible).toBe(false);
    expect(geometry.drawRange.count).toBe(0);
    const disposeGeometry = vi.spyOn(geometry, 'dispose');
    const disposeMaterial = vi.spyOn(f.effect.mesh.material, 'dispose');
    f.effect.dispose();
    f.effect.dispose();
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(f.scene.children).toHaveLength(0);
    expect(f.effect.spawn(1, 2, 'damage', false)).toBe(false);
  });

  it("uses additive light in several palette tones and blazes on the Paladin's weapon", async () => {
    const f = fixture();
    await f.prepare();
    expect(f.effect.mesh.material.blending).toBe(THREE.AdditiveBlending);
    f.effect.spawn(1, 2, 'damage', false);
    f.effect.update(landed(0.08), false);
    const geometry = f.effect.mesh.geometry;
    const colors = geometry.getAttribute('aColor');
    const palette = new Set<string>();
    for (let i = 0; i < geometry.drawRange.count; i++)
      palette.add(`${colors.getX(i)},${colors.getY(i)},${colors.getZ(i)}`);
    expect(palette.size).toBe(3);
    // With no weapon found, the empowered light sits on the caster, not the recipient.
    const positions = geometry.getAttribute('position');
    const alphas = geometry.getAttribute('aAlpha');
    let z = 0;
    for (let i = WEAPON_START; i < WEAPON_START + 6; i++) {
      z += positions.getZ(i) / 6;
      expect(alphas.getX(i)).toBeGreaterThan(0.5);
    }
    expect(z).toBeCloseTo(0, 5);
    f.effect.dispose();
  });

  it('blazes on the weapon itself when the caster holds one', async () => {
    const scene = new THREE.Scene();
    const anchor = vi.fn((id: number, _frac: number, out?: THREE.Vector3) =>
      out ? out.set(0, 1, id === 2 ? 2 : 0) : null,
    );
    const weapon = vi.fn(() => (out: THREE.Vector3) => {
      out.set(0.4, 1.7, 0.3);
      return true;
    });
    const effect = new FinalEdict(scene, anchor, undefined, undefined, weapon);
    const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
    const host = {
      properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
      compile: vi.fn(async () => {}),
      draw: vi.fn(),
    };
    for (const unit of effect.preparation.units(host)) await unit.run();
    effect.spawn(1, 2, 'damage', false);
    effect.update(landed(0.05), false);
    expect(weapon).toHaveBeenCalledWith(1, 0);
    const positions = effect.mesh.geometry.getAttribute('position');
    let x = 0,
      y = 0;
    for (let i = WEAPON_START; i < WEAPON_START + 6; i++) {
      x += positions.getX(i) / 6;
      y += positions.getY(i) / 6;
    }
    expect(x).toBeCloseTo(0.4, 5);
    expect(y).toBeCloseTo(1.7, 5);
    effect.dispose();
  });

  it('follows the contact until just after landing, detaches, and handles missing recipients', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.spawn(1, 2, 'damage', false);
    f.effect.update(landed(0.01), false);
    const before = f.effect.mesh.geometry.getAttribute('position').getX(FLARE_START);
    const recipient = f.positions.get(2);
    if (!recipient) throw new Error('Missing fixture target');
    recipient.x += 3;
    f.effect.update(0, false);
    expect(f.effect.mesh.geometry.getAttribute('position').getX(FLARE_START) - before).toBeCloseTo(
      3,
    );
    f.positions.delete(2);
    f.effect.update(0, false);
    expect(f.effect.mesh.visible).toBe(false);
    expect(f.effect.spawn(1, 2, 'damage', false)).toBe(false);
    expect(f.effect.spawn(1, 2, 'none', false)).toBe(false);
    f.effect.dispose();
  });

  it('fades against the supplied elevated ground plane', async () => {
    const groundY = vi.fn(() => 2.5);
    const f = fixture(new THREE.PerspectiveCamera(), groundY);
    await f.prepare();
    f.effect.spawn(1, 2, 'damage', false);
    f.effect.update(landed(0.08), false);
    const geometry = f.effect.mesh.geometry;
    const positions = geometry.getAttribute('position');
    const distances = geometry.getAttribute('aGroundDistance');
    expect(groundY).toHaveBeenCalled();
    for (let i = 0; i < geometry.drawRange.count; i++) {
      expect(distances.getX(i)).toBeCloseTo(positions.getY(i) - 2.5, 5);
    }
    f.effect.dispose();
  });

  it('leaves the released light in world space when its recipient moves', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.spawn(1, 2, 'damage', false);
    f.effect.update(landed(0.1), false);
    const attribute = f.effect.mesh.geometry.getAttribute('position');
    const before = Array.from(attribute.array);
    f.positions.set(2, new THREE.Vector3(20, 1, 20));
    f.effect.update(0, false);
    expect(Array.from(attribute.array)).toEqual(before);
    f.effect.dispose();
  });

  it('keeps the chop crescent width perpendicular to its projected tangent across camera orbits', async () => {
    const camera = new THREE.PerspectiveCamera();
    const f = fixture(camera);
    await f.prepare();
    f.effect.spawn(1, 2, 'damage', false);
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      previous = new THREE.Vector3();
    const width = new THREE.Vector3(),
      tangent = new THREE.Vector3(),
      next = new THREE.Vector3(),
      other = new THREE.Vector3();
    // Slash segment k; corners 1 and 2 share u.
    const corner = (segment: number, j: number) => SLASH_START + segment * 6 + j;
    const mid = FINAL_EDICT_SLASH_SEGMENTS / 2;
    for (const yaw of [0, 0.7, 1.5, 2.4, 3.1, 4.7]) {
      camera.position.set(Math.sin(yaw) * 15, 8, Math.cos(yaw) * 15);
      camera.lookAt(0, 1, 2);
      camera.updateMatrixWorld(true);
      f.effect.update(landed(0.02), false);
      const positions = f.effect.mesh.geometry.getAttribute('position');
      a.fromBufferAttribute(positions, corner(mid, 1)).applyMatrix4(camera.matrixWorldInverse);
      b.fromBufferAttribute(positions, corner(mid, 2)).applyMatrix4(camera.matrixWorldInverse);
      previous.fromBufferAttribute(positions, corner(mid - 1, 1));
      other.fromBufferAttribute(positions, corner(mid - 1, 2));
      previous.add(other).multiplyScalar(0.5).applyMatrix4(camera.matrixWorldInverse);
      next.fromBufferAttribute(positions, corner(mid + 1, 1));
      other.fromBufferAttribute(positions, corner(mid + 1, 2));
      next.add(other).multiplyScalar(0.5).applyMatrix4(camera.matrixWorldInverse);
      width.subVectors(b, a);
      tangent.subVectors(next, previous);
      expect(Math.hypot(width.x, width.y)).toBeGreaterThan(0.4);
      expect(Math.abs(width.z)).toBeLessThan(0.00001);
      const dot = Math.abs(width.x * tangent.x + width.y * tangent.y);
      expect(dot / (Math.hypot(width.x, width.y) * Math.hypot(tangent.x, tangent.y))).toBeLessThan(
        0.15,
      );
      f.effect.clear();
      f.effect.spawn(1, 2, 'damage', false);
    }
    f.effect.dispose();
  });

  it('releases remaining GPU resources even when preparation cleanup throws', () => {
    const f = fixture();
    const geometry = vi.spyOn(f.effect.mesh.geometry, 'dispose');
    const material = vi.spyOn(f.effect.mesh.material, 'dispose');
    const dispose = f.effect.preparation.dispose.bind(f.effect.preparation);
    vi.spyOn(f.effect.preparation, 'dispose').mockImplementation(() => {
      dispose();
      throw new Error('detach failed');
    });
    expect(() => f.effect.dispose()).toThrow('Final Edict cleanup failed');
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expect(f.scene.children).toHaveLength(0);
    f.effect.dispose();
    expect(material).toHaveBeenCalledTimes(1);
  });

  it('waits for the swing: the blade, seal and flinch arrive as the blow lands', async () => {
    const f = fixture();
    await f.prepare();
    const land = vi.fn();
    f.effect.spawn(1, 2, 'damage', false, land);
    f.effect.update(FINAL_EDICT_LAND - 0.05, false);
    const geometry = f.effect.mesh.geometry;
    expect(land).not.toHaveBeenCalled();
    expect(geometry.drawRange.count).toBe(6);
    expect(geometry.getAttribute('aShape').getX(WEAPON_START)).toBe(SHAPES.weapon);
    f.effect.update(0.06, false);
    expect(land).toHaveBeenCalledOnce();
    const alphas = geometry.getAttribute('aAlpha');
    let blade = 0;
    for (let i = SLASH_START; i < FLARE_START; i++) blade += alphas.getX(i);
    expect(blade).toBeGreaterThan(0);
    expect(geometry.getAttribute('aShape').getX(SEAL_START)).toBe(SHAPES.seal);
    expect(alphas.getX(SEAL_START)).toBeGreaterThan(0.8);
    f.effect.update(FINAL_EDICT_AFTER, false);
    expect(land).toHaveBeenCalledOnce();
    // A strike pushed out before it lands still lands its flinch; a cleared one does not.
    const early = vi.fn();
    f.effect.spawn(1, 2, 'damage', false, early);
    for (let i = 0; i < FINAL_EDICT_CAPACITY; i++) f.effect.spawn(1, 2, 'damage', false);
    expect(early).toHaveBeenCalledOnce();
    const cleared = vi.fn();
    f.effect.spawn(1, 2, 'damage', false, cleared);
    f.effect.clear();
    f.effect.update(landed(0.1), false);
    expect(cleared).not.toHaveBeenCalled();
    f.effect.dispose();
  });

  it('lays the seal on the floor beneath the victim, its sword along the blow', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.spawn(1, 2, 'damage', false);
    f.effect.update(landed(0.2), false);
    const positions = f.effect.mesh.geometry.getAttribute('position');
    const uvs = f.effect.mesh.geometry.getAttribute('aUv');
    let x = 0,
      z = 0;
    for (let i = SEAL_START; i < SEAL_START + 6; i++) {
      x += positions.getX(i) / 6;
      z += positions.getZ(i) / 6;
      // The victim's feet are at 0; the seal lies just over them.
      expect(positions.getY(i)).toBeCloseTo(0.03, 5);
    }
    expect(x).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(2, 5);
    // u runs along the blow (caster at z 0, victim at z 2).
    let uStart = 0,
      uEnd = 0;
    for (let i = SEAL_START; i < SEAL_START + 6; i++)
      if (uvs.getX(i) === 0) uStart = positions.getZ(i);
      else uEnd = positions.getZ(i);
    expect(uEnd).toBeGreaterThan(uStart);
    f.effect.dispose();
  });
});

describe("Final Edict's blade follows the weapon", () => {
  async function armed() {
    const scene = new THREE.Scene();
    const anchor = vi.fn((id: number, frac: number, out?: THREE.Vector3) => {
      if (!out) return null;
      out.set(0, frac === 0 ? 0 : 1, id === 2 ? 2 : 0);
      return out;
    });
    // The weapon tip, moved by the test through the swing.
    const tip = new THREE.Vector3(-0.8, 2.5, -0.4);
    const weapon = vi.fn(() => (out: THREE.Vector3) => {
      out.copy(tip);
      return true;
    });
    const effect = new FinalEdict(scene, anchor, undefined, undefined, weapon);
    const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
    const host = {
      properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
      compile: vi.fn(async () => {}),
      draw: vi.fn(),
    };
    for (const unit of effect.preparation.units(host)) await unit.run();
    return { effect, tip };
  }
  /** The swing's path: high over the right shoulder, down across to the left. */
  const swing = (f: number, out: THREE.Vector3) =>
    out.set(-0.8 + 1.4 * f, 2.5 - 1.3 * f * f, -0.4 + 1.8 * f);
  const end = (effect: FinalEdict, u: 0 | 1) => {
    const positions = effect.mesh.geometry.getAttribute('position');
    const uvs = effect.mesh.geometry.getAttribute('aUv');
    const at = new THREE.Vector3();
    let n = 0;
    for (let i = SLASH_START; i < FLARE_START; i++)
      if (uvs.getX(i) === u && (u === 0 ? i < SLASH_START + 6 : i >= FLARE_START - 6)) {
        at.x += positions.getX(i);
        at.y += positions.getY(i);
        at.z += positions.getZ(i);
        n++;
      }
    return at.multiplyScalar(1 / n);
  };

  it('draws the blade down the weapon’s own path as it swings, then burns it out', async () => {
    const { effect, tip } = await armed();
    effect.spawn(1, 2, 'damage', false);
    const geometry = effect.mesh.geometry;
    // Raised: only the weapon's gathering light.
    effect.update(FINAL_EDICT_LAND - EDICT_TRAIL.lead - 0.02, false);
    expect(geometry.drawRange.count).toBe(6);
    // The downswing: sampled each frame, the blade grows behind the weapon.
    const start = new THREE.Vector3();
    swing(0, start);
    const frames = 8;
    for (let k = 0; k <= frames; k++) {
      swing(k / frames, tip);
      effect.update(k === 0 ? 0.02 : (EDICT_TRAIL.lead - 0.01) / frames, false);
    }
    expect(geometry.drawRange.count).toBe(6 + FINAL_EDICT_SLASH_SEGMENTS * 6);
    expect(end(effect, 1).distanceTo(tip)).toBeLessThan(0.3);
    expect(end(effect, 0).distanceTo(start)).toBeLessThan(0.3);
    // The blow lands: the blade stays with the flare, seal and sparks.
    effect.update(0.02, false);
    expect(geometry.drawRange.count).toBe(FINAL_EDICT_VERTICES_PER_CAST);
    const alphas = geometry.getAttribute('aAlpha');
    let lit = 0;
    for (let i = SLASH_START; i < FLARE_START; i++) lit += alphas.getX(i);
    expect(lit).toBeGreaterThan(0);
    // Each part burns out once the weapon has left it.
    effect.update(EDICT_TRAIL.hold + EDICT_TRAIL.life + 0.02, false);
    lit = 0;
    for (let i = SLASH_START; i < FLARE_START; i++) lit += alphas.getX(i);
    expect(lit).toBe(0);
    effect.dispose();
  });

  it('cuts the clip’s diagonal when the weapon cannot be followed', async () => {
    const f = fixture();
    await f.prepare();
    // The caster at z 0 strikes toward z 2: their right is -x.
    f.effect.spawn(1, 2, 'damage', false);
    f.effect.update(landed(0.02), false);
    const from = end(f.effect, 0),
      to = end(f.effect, 1);
    // From high over the right shoulder to low on the left.
    expect(from.x).toBeLessThan(-0.2);
    expect(to.x).toBeGreaterThan(0.2);
    expect(from.y).toBeGreaterThan(to.y + 1);
    f.effect.dispose();
  });
});

describe("Final Edict's Ascension explosion", () => {
  it('races out to its true radius, then holds the reach as a ring', async () => {
    const f = fixture();
    await f.prepare();
    expect(f.effect.verdict(1, 6)).toBe(true);
    const geometry = f.effect.mesh.geometry;
    // Released with the blow, not before it.
    f.effect.update(FINAL_EDICT_LAND - 0.01, false);
    expect(geometry.drawRange.count).toBe(0);
    f.effect.update(0.01 + EDICT_WAVE.grow + 0.05, false);
    expect(geometry.drawRange.count).toBe(FINAL_EDICT_WAVE_VERTICES);
    const positions = geometry.getAttribute('position');
    const alphas = geometry.getAttribute('aAlpha');
    const edgeStart = (EDICT_WAVE_SPOKES + EDICT_WAVE_SHOCK_SEGMENTS) * 6;
    // The edge quads' centres lie on the 6 yd reach around the caster (0, 0).
    for (let k = 0; k < EDICT_WAVE_EDGE_SEGMENTS; k += 8) {
      let cx = 0,
        cz = 0;
      for (let j = 0; j < 6; j++) {
        cx += positions.getX(edgeStart + k * 6 + j) / 6;
        cz += positions.getZ(edgeStart + k * 6 + j) / 6;
      }
      expect(Math.hypot(cx, cz)).toBeCloseTo(6, 1);
      expect(alphas.getX(edgeStart + k * 6)).toBeGreaterThan(0.7);
    }
    // Still held well after the wave has passed, then gone.
    f.effect.update(EDICT_WAVE.hold - EDICT_WAVE.grow - 0.1, false);
    expect(alphas.getX(edgeStart)).toBeGreaterThan(0.6);
    f.effect.update(FINAL_EDICT_WAVE_DURATION, false);
    expect(f.effect.mesh.visible).toBe(false);
    // Another radius is honoured.
    f.effect.verdict(1, 10);
    f.effect.update(landed(EDICT_WAVE.grow + 0.05), false);
    let cx = 0,
      cz = 0;
    for (let j = 0; j < 6; j++) {
      cx += positions.getX(edgeStart + j) / 6;
      cz += positions.getZ(edgeStart + j) / 6;
    }
    expect(Math.hypot(cx, cz)).toBeCloseTo(10, 1);
    f.effect.dispose();
  });

  it('stamps the seal under each enemy struck as the shockwave reaches it', async () => {
    const f = fixture();
    await f.prepare();
    f.positions.set(3, new THREE.Vector3(5, 1, 0));
    f.effect.verdict(1, 6);
    expect(f.effect.areaHit(1, 2, 'damage')).toBe(true);
    expect(f.effect.areaHit(1, 3, 'damage')).toBe(true);
    expect(f.effect.areaHit(1, 3, 'none')).toBe(false);
    expect(edictWaveArrival(2, 6)).toBeLessThan(edictWaveArrival(5, 6));
    const geometry = f.effect.mesh.geometry;
    const shapes = geometry.getAttribute('aShape');
    const seals = () => {
      let n = 0;
      for (let i = FINAL_EDICT_WAVE_VERTICES; i < geometry.drawRange.count; i += 6)
        if (shapes.getX(i) === SHAPES.seal) n++;
      return n;
    };
    // The near enemy is reached first, the far one a moment later.
    f.effect.update(landed(edictWaveArrival(2, 6) + 0.005), false);
    expect(seals()).toBe(1);
    f.effect.update(edictWaveArrival(5, 6) - edictWaveArrival(2, 6), false);
    expect(seals()).toBe(2);
    expect(geometry.drawRange.count).toBe(
      FINAL_EDICT_WAVE_VERTICES + 2 * FINAL_EDICT_STAMP_VERTICES,
    );
    f.effect.update(EDICT_STAMP_DURATION + 0.01, false);
    expect(seals()).toBe(0);
    f.effect.dispose();
  });

  it('rejects a cold explosion so the painter can fall back', () => {
    const f = fixture();
    expect(f.effect.verdict(1, 6)).toBe(false);
    expect(f.effect.areaHit(1, 2, 'damage')).toBe(false);
    f.effect.dispose();
  });
});
