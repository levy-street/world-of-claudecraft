// The Knotted Gale (encounters/smith_heart/breath_heart.ts), a part of BreathFightFx,
// on EVERY tier (the raid acts on all of it): the ball, a Storm Orb wound in a knot of
// wind, growing and more violent to its end, on a floor ring that shrinks as its timer;
// the two portals told apart at a glance (teal A, violet B, a funnel of wind each, the
// letter on the floor) with a link of light between them; each marked player's letter
// over their head and the filling ring of the portal to come; the carrier with the ball
// over them and a ring pressed into the floor. The throw arcs off into the void; the
// burst is a flash, a wall of storm across the Cornice and a shake. Cosmetic particles
// thin on the low tier; the shake honours reduced motion through the host.
//
// Built in the constructor under the host's root (its one gated attach): fixed pools,
// no light, no per-frame allocation. The plan's numbers: breath_heart_fx_core.ts.

import * as THREE from 'three';
import {
  BREATH_AURAS,
  BREATH_CUES,
  knotOf,
  BREATH_TUNING as T,
} from '../../sim/encounters/smith_heart/breath_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  BURST_SECONDS,
  burstLook,
  HEART_COLORS as C,
  HEART_FLOOR,
  type HeartObjectKind,
  heartObjectKind,
  KNOT_CARRY_Y,
  KNOT_FLOAT_Y,
  knotLook,
  liveFuse,
  markFill,
  HEART_POOLS as P,
  portalLink,
  THROW_ARC,
  throwHeading,
  throwOffset,
} from './breath_heart_fx_core';
import {
  BURST_FRAG,
  FACING_FRAG,
  FACING_VERT,
  HEART_RING_FRAG,
  HEART_UV_VERT,
  PORTAL_DISC_FRAG,
  PORTAL_FUNNEL_FRAG,
  PORTAL_LINK_FRAG,
} from './breath_heart_glsl';
import { KIT_UV_VERT, ORB_CORE_FRAG, ORB_FRAG } from './final_kit_glsl';

/** What BreathFightFx lends this part (a type-only seam). */
export interface BreathHeartHost {
  readonly root: THREE.Group;
  readonly particles: EngineParticles;
  readonly uTime: { value: number };
  readonly density: number;
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  groundY(x: number, z: number): number;
  shakeNear(x: number, z: number, amount: number, reach?: number): void;
}

const color = (hex: number) => new THREE.Color(hex);

/** A block letter as a flat shape in x/y, a yard or so tall: A or B. */
function letterShape(which: 'A' | 'B'): THREE.Shape {
  const s = new THREE.Shape();
  if (which === 'A') {
    s.moveTo(-0.55, -0.7);
    s.lineTo(-0.15, 0.7);
    s.lineTo(0.15, 0.7);
    s.lineTo(0.55, -0.7);
    s.lineTo(0.27, -0.7);
    s.lineTo(0.18, -0.36);
    s.lineTo(-0.18, -0.36);
    s.lineTo(-0.27, -0.7);
    s.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-0.11, -0.12);
    hole.lineTo(0.11, -0.12);
    hole.lineTo(0, 0.32);
    hole.closePath();
    s.holes.push(hole);
    return s;
  }
  s.moveTo(-0.45, -0.7);
  s.lineTo(0.25, -0.7);
  s.lineTo(0.48, -0.5);
  s.lineTo(0.48, -0.16);
  s.lineTo(0.32, 0);
  s.lineTo(0.44, 0.14);
  s.lineTo(0.44, 0.5);
  s.lineTo(0.22, 0.7);
  s.lineTo(-0.45, 0.7);
  s.closePath();
  for (const [lo, hi] of [
    [-0.48, -0.14],
    [0.14, 0.46],
  ]) {
    const hole = new THREE.Path();
    hole.moveTo(-0.18, lo);
    hole.lineTo(0.18, lo);
    hole.lineTo(0.18, hi);
    hole.lineTo(-0.18, hi);
    hole.closePath();
    s.holes.push(hole);
  }
  return s;
}

interface KnotSlot {
  shell: THREE.Mesh;
  core: THREE.Mesh;
  wind: THREE.Mesh;
  ring: THREE.Mesh;
  load: THREE.Mesh;
  crackle: { value: number };
  ringColor: THREE.Color;
  ringAlpha: { value: number };
  id: number;
  template: string;
  changedAt: number;
  turn: number;
}

interface PortalSlot {
  disc: THREE.Mesh;
  funnel: THREE.Mesh;
  letter: THREE.Mesh;
  open: { value: number };
  id: number;
  bornAt: number;
}

interface MarkSlot {
  ring: THREE.Mesh;
  letter: { A: THREE.Mesh; B: THREE.Mesh };
  fill: { value: number };
  ringColor: THREE.Color;
  id: number;
  which: 'A' | 'B';
}

interface FlightSlot {
  mesh: THREE.Mesh;
  bornAt: number;
  live: boolean;
  x: number;
  y: number;
  z: number;
  hx: number;
  hz: number;
}

const KIND_INDEX: Readonly<Record<'portalA' | 'portalB', number>> = { portalA: 0, portalB: 1 };

export class BreathHeartFx {
  private readonly knots: KnotSlot[] = [];
  private readonly portals: PortalSlot[] = [];
  private readonly marks: MarkSlot[] = [];
  private readonly flights: FlightSlot[] = [];
  private readonly link: THREE.Mesh;
  private readonly burstWall: THREE.Mesh;
  private readonly burstFlash: THREE.Mesh;
  private readonly burstAlpha = { value: 0 };
  private burstBorn = -99;
  private readonly offset = { x: 0, y: 0, z: 0 };
  // The scan's finds (rewritten at the host's scan pace).
  private seenKnots = 0;
  private seenMarks = 0;
  private readonly seenPortal = [false, false];

  constructor(private readonly h: BreathHeartHost) {
    const mk = (
      name: string,
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      rung?: number,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.visible = false;
      mesh.frustumCulled = false;
      if (rung !== undefined) mesh.renderOrder = floorVfxRenderOrder('encounter', rung);
      h.root.add(mesh);
      return mesh;
    };
    const shader = (
      name: string,
      uniforms: Record<string, THREE.IUniform>,
      vert: string,
      frag: string,
      extra: THREE.ShaderMaterialParameters = {},
    ): THREE.ShaderMaterial => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        ...extra,
      });
      h.materials.push(m);
      return m;
    };
    // Flat on the floor: x/z, uv across the whole square.
    const floorQuad = new THREE.PlaneGeometry(2, 2);
    floorQuad.rotateX(-Math.PI / 2);
    const letterA = new THREE.ShapeGeometry(letterShape('A'));
    const letterB = new THREE.ShapeGeometry(letterShape('B'));
    const floorLetterA = letterA.clone();
    floorLetterA.rotateX(-Math.PI / 2);
    const floorLetterB = letterB.clone();
    floorLetterB.rotateX(-Math.PI / 2);
    const orb = new THREE.SphereGeometry(1, 28, 20);
    const orbCore = new THREE.SphereGeometry(0.55, 16, 12);
    const knot = new THREE.TorusKnotGeometry(1.25, 0.05, 140, 6, 2, 3);
    const funnel = new THREE.CylinderGeometry(1.5, 0.75, 1, 28, 1, true);
    funnel.translate(0, 0.5, 0);
    const wall = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
    wall.translate(0, 0.5, 0);
    h.geometries.push(floorQuad, letterA, letterB, floorLetterA, floorLetterB);
    h.geometries.push(orb, orbCore, knot, funnel, wall);
    const windMat = (hex: number, name: string) => {
      const m = new THREE.MeshBasicMaterial({
        name,
        color: hex,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      h.materials.push(m);
      return m;
    };
    const knotWind = windMat(C.a, 'smithHeartKnotWind');

    for (let i = 0; i < P.knots; i++) {
      const crackle = { value: 0.3 };
      const u = { uTime: h.uTime, uCrackle: crackle, uStorm: { value: color(C.storm) } };
      const ringColor = color(C.storm);
      const ringAlpha = { value: 1 };
      this.knots.push({
        shell: mk('smithHeartKnot', orb, shader('smithHeartKnotShell', u, KIT_UV_VERT, ORB_FRAG)),
        core: mk(
          'smithHeartKnotCore',
          orbCore,
          shader('smithHeartKnotCore', u, KIT_UV_VERT, ORB_CORE_FRAG),
        ),
        wind: mk('smithHeartKnotWind', knot, knotWind),
        ring: mk(
          'smithHeartKnotRing',
          floorQuad,
          shader(
            'smithHeartKnotRing',
            {
              uColor: { value: ringColor },
              uAlpha: ringAlpha,
              uFill: { value: 0 },
            },
            HEART_UV_VERT,
            HEART_RING_FRAG,
          ),
          HEART_FLOOR.ring,
        ),
        load: mk(
          'smithHeartKnotLoad',
          floorQuad,
          shader(
            'smithHeartKnotLoad',
            { uColor: { value: color(C.load) }, uAlpha: { value: 0.9 }, uFill: { value: 0.75 } },
            HEART_UV_VERT,
            HEART_RING_FRAG,
          ),
          HEART_FLOOR.load,
        ),
        crackle,
        ringColor,
        ringAlpha,
        id: -1,
        template: '',
        changedAt: 0,
        turn: 0,
      });
    }

    const sideOf = [
      { hex: C.a, floor: floorLetterA, tag: 'A' },
      { hex: C.b, floor: floorLetterB, tag: 'B' },
    ];
    for (const side of sideOf) {
      const open = { value: 0 };
      const u = { uTime: h.uTime, uOpen: open, uColor: { value: color(side.hex) } };
      this.portals.push({
        disc: mk(
          `smithHeartPortal${side.tag}`,
          floorQuad,
          shader(`smithHeartPortal${side.tag}`, u, HEART_UV_VERT, PORTAL_DISC_FRAG),
          HEART_FLOOR.disc,
        ),
        funnel: mk(
          `smithHeartPortalFunnel${side.tag}`,
          funnel,
          shader(`smithHeartPortalFunnel${side.tag}`, u, HEART_UV_VERT, PORTAL_FUNNEL_FRAG, {
            side: THREE.DoubleSide,
          }),
        ),
        letter: mk(
          `smithHeartPortalLetter${side.tag}`,
          side.floor,
          new THREE.MeshBasicMaterial({
            name: `smithHeartPortalLetter${side.tag}`,
            color: 0x06202a,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
          }),
          HEART_FLOOR.letter,
        ),
        open,
        id: -1,
        bornAt: 0,
      });
      h.materials.push(this.portals[this.portals.length - 1].letter.material as THREE.Material);
    }

    const faceA = shader(
      'smithHeartMarkLetterA',
      { uColor: { value: color(C.a) } },
      FACING_VERT,
      FACING_FRAG,
      { blending: THREE.NormalBlending, depthTest: false, side: THREE.DoubleSide },
    );
    const faceB = shader(
      'smithHeartMarkLetterB',
      { uColor: { value: color(C.b) } },
      FACING_VERT,
      FACING_FRAG,
      { blending: THREE.NormalBlending, depthTest: false, side: THREE.DoubleSide },
    );
    for (let i = 0; i < P.marks; i++) {
      const fill = { value: 0 };
      const ringColor = color(C.a);
      this.marks.push({
        ring: mk(
          'smithHeartMarkRing',
          floorQuad,
          shader(
            'smithHeartMarkRing',
            { uColor: { value: ringColor }, uAlpha: { value: 1 }, uFill: fill },
            HEART_UV_VERT,
            HEART_RING_FRAG,
          ),
          HEART_FLOOR.mark,
        ),
        letter: {
          A: mk('smithHeartMarkLetterA', letterA, faceA),
          B: mk('smithHeartMarkLetterB', letterB, faceB),
        },
        fill,
        ringColor,
        id: -1,
        which: 'A',
      });
    }

    this.link = mk(
      'smithHeartPortalLink',
      new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2),
      shader(
        'smithHeartPortalLink',
        { uTime: h.uTime, uA: { value: color(C.a) }, uB: { value: color(C.b) } },
        HEART_UV_VERT,
        PORTAL_LINK_FRAG,
        { side: THREE.DoubleSide },
      ),
    );
    h.geometries.push(this.link.geometry);

    const flightMat = windMat(C.core, 'smithHeartKnotFlight');
    for (let i = 0; i < P.flights; i++) {
      this.flights.push({
        mesh: mk('smithHeartKnotFlight', orb, flightMat),
        bornAt: -99,
        live: false,
        x: 0,
        y: 0,
        z: 0,
        hx: 0,
        hz: 1,
      });
    }

    this.burstWall = mk(
      'smithHeartKnotBurst',
      wall,
      shader(
        'smithHeartKnotBurst',
        { uTime: h.uTime, uAlpha: this.burstAlpha, uColor: { value: color(C.storm) } },
        HEART_UV_VERT,
        BURST_FRAG,
        { side: THREE.DoubleSide },
      ),
    );
    this.burstFlash = mk('smithHeartKnotFlash', orb, windMat(C.core, 'smithHeartKnotFlash'));
  }

  // ---- the host's scan --------------------------------------------------------------------

  beginScan(): void {
    this.seenKnots = 0;
    this.seenMarks = 0;
    this.seenPortal[0] = false;
    this.seenPortal[1] = false;
  }

  /** A fight object the scan found; false when it is none of this mechanic's. */
  takeObject(e: Entity): boolean {
    const kind: HeartObjectKind | null = heartObjectKind(e.templateId);
    if (!kind) return false;
    if (kind === 'knot') {
      if (this.seenKnots < this.knots.length) this.knots[this.seenKnots++].id = e.id;
      return true;
    }
    const i = KIND_INDEX[kind];
    this.seenPortal[i] = true;
    const s = this.portals[i];
    if (s.id !== e.id) {
      s.id = e.id;
      s.bornAt = this.h.uTime.value;
    }
    return true;
  }

  /** A living player's aura the scan found. */
  takeAura(e: Entity, auraId: string): void {
    const which =
      auraId === BREATH_AURAS.portalA ? 'A' : auraId === BREATH_AURAS.portalB ? 'B' : null;
    if (!which || this.seenMarks >= this.marks.length) return;
    const m = this.marks[this.seenMarks++];
    m.id = e.id;
    m.which = which;
    m.ringColor.setHex(which === 'A' ? C.a : C.b);
  }

  endScan(): void {
    for (let i = this.seenKnots; i < this.knots.length; i++) this.knots[i].id = -1;
    for (let i = this.seenMarks; i < this.marks.length; i++) this.marks[i].id = -1;
    for (let i = 0; i < this.portals.length; i++) if (!this.seenPortal[i]) this.portals[i].id = -1;
  }

  /** Off the Cornice: nothing shows. */
  leave(): void {
    this.beginScan();
    this.endScan();
    this.hideAll();
    for (const f of this.flights) f.live = false;
    this.burstBorn = -99;
  }

  private hideAll(): void {
    for (const k of this.knots) {
      k.shell.visible = false;
      k.core.visible = false;
      k.wind.visible = false;
      k.ring.visible = false;
      k.load.visible = false;
    }
    for (const p of this.portals) {
      p.disc.visible = false;
      p.funnel.visible = false;
      p.letter.visible = false;
    }
    for (const m of this.marks) {
      m.ring.visible = false;
      m.letter.A.visible = false;
      m.letter.B.visible = false;
    }
    this.link.visible = false;
    this.burstWall.visible = false;
    this.burstFlash.visible = false;
    for (const f of this.flights) f.mesh.visible = false;
  }

  // ---- the cues ---------------------------------------------------------------------------

  /** The mechanic's moments. True when the cue was this part's. */
  handleEvent(ev: SimEvent, world: IWorld, origin: { x: number; z: number } | null): boolean {
    const h = this.h;
    if (ev.type === 'spellfxAt') {
      const y = h.groundY(ev.x, ev.z);
      if (ev.ability === BREATH_CUES.knotLand) {
        this.puff(ev.x, y + 0.4, ev.z, 24, 9, TINT.storm, 2);
        h.shakeNear(ev.x, ev.z, 0.25, 35);
        return true;
      }
      if (ev.ability === BREATH_CUES.portalOpen) {
        this.puff(ev.x, y + 0.5, ev.z, 26, 7, TINT.a, T.heartPortalR);
        h.shakeNear(ev.x, ev.z, 0.15, 25);
        return true;
      }
      if (ev.ability === BREATH_CUES.knotTake) {
        this.puff(ev.x, y + 1, ev.z, 18, 5, TINT.load, 1.5);
        return true;
      }
      if (ev.ability === BREATH_CUES.knotThrow) {
        this.launch(ev.x, y + KNOT_CARRY_Y, ev.z, origin);
        h.shakeNear(ev.x, ev.z, 0.2, 30);
        return true;
      }
      if (ev.ability === BREATH_CUES.knotBurst) {
        this.burstBorn = h.uTime.value;
        this.burstWall.position.set(ev.x, y - 1, ev.z);
        this.burstFlash.position.set(ev.x, y + 3, ev.z);
        this.puff(ev.x, y + 2, ev.z, 80, 26, TINT.storm, 8);
        h.shakeNear(ev.x, ev.z, 1.6, 120);
        return true;
      }
      return false;
    }
    if (ev.type === 'spellfx' && ev.ability === BREATH_CUES.portalHop) {
      const p = world.entities.get(ev.targetId);
      if (p) {
        this.puff(p.pos.x, p.pos.y + 1, p.pos.z, 30, 8, TINT.b, 1.5);
        h.shakeNear(p.pos.x, p.pos.z, 0.2, 18);
      }
      return true;
    }
    return false;
  }

  private puff(
    x: number,
    y: number,
    z: number,
    n: number,
    speed: number,
    tint: readonly [number, number, number],
    radius: number,
  ): void {
    this.h.particles.puff(x, y, z, Math.max(4, Math.round(n * this.h.density)), {
      speed,
      up: speed * 0.45,
      life: 0.9,
      size: [0.55, 0.08],
      color: tint,
      alpha: 1,
      pool: 'glow',
      radius,
      drag: 0.9,
    });
  }

  private launch(x: number, y: number, z: number, origin: { x: number; z: number } | null): void {
    const f = this.flights.find((o) => !o.live) ?? this.flights[0];
    const heading = throwHeading(x - (origin?.x ?? 0), z - (origin?.z ?? 0));
    f.live = true;
    f.bornAt = this.h.uTime.value;
    f.x = x;
    f.y = y;
    f.z = z;
    f.hx = heading.x;
    f.hz = heading.z;
  }

  // ---- the frame --------------------------------------------------------------------------

  update(world: IWorld, dt: number): void {
    const h = this.h;
    const now = h.uTime.value;
    for (const k of this.knots) {
      const e = k.id >= 0 ? world.entities.get(k.id) : undefined;
      const of = e ? knotOf(e.templateId) : null;
      if (!e || !of) {
        k.shell.visible = false;
        k.core.visible = false;
        k.wind.visible = false;
        k.ring.visible = false;
        k.load.visible = false;
        continue;
      }
      if (k.template !== e.templateId) {
        k.template = e.templateId;
        k.changedAt = now;
      }
      const look = knotLook(liveFuse(of.fuse, now - k.changedAt));
      const held = of.state === 'held';
      const floor = h.groundY(e.pos.x, e.pos.z);
      const y = floor + (held ? KNOT_CARRY_Y : KNOT_FLOAT_Y) + 0.15 * Math.sin(now * 3);
      const r = look.radius * (1 + 0.14 * look.throb * Math.sin(now * 14));
      k.crackle.value = look.crackle;
      k.turn += look.spin * dt;
      k.shell.position.set(e.pos.x, y, e.pos.z);
      k.shell.scale.setScalar(r);
      k.core.position.copy(k.shell.position);
      k.core.scale.setScalar(r);
      k.wind.position.copy(k.shell.position);
      k.wind.scale.setScalar(r);
      k.wind.rotation.set(k.turn * 0.7, k.turn, k.turn * 0.4);
      k.shell.visible = true;
      k.core.visible = true;
      k.wind.visible = true;
      k.ring.position.set(e.pos.x, floor + 0.1, e.pos.z);
      k.ring.scale.set(look.ringR, 1, look.ringR);
      k.ring.visible = true;
      k.ringColor.setHex(C.storm).lerp(_danger, look.danger);
      k.ringAlpha.value = 0.75 + 0.25 * look.throb * Math.sin(now * 14);
      k.load.visible = held;
      if (held) {
        k.load.position.set(e.pos.x, floor + 0.12, e.pos.z);
        k.load.scale.set(1.5, 1, 1.5);
      }
    }
    // The portals, each opening with a little swell.
    for (const p of this.portals) {
      const e = p.id >= 0 ? world.entities.get(p.id) : undefined;
      p.disc.visible = !!e;
      p.funnel.visible = !!e;
      p.letter.visible = !!e;
      if (!e) continue;
      const r = e.scale > 0 ? e.scale : T.heartPortalR;
      const floor = h.groundY(e.pos.x, e.pos.z);
      const open = Math.min(1, (now - p.bornAt) / 0.5);
      p.open.value = open;
      p.disc.position.set(e.pos.x, floor + 0.08, e.pos.z);
      p.disc.scale.set(r * open, 1, r * open);
      p.funnel.position.set(e.pos.x, floor + 0.05, e.pos.z);
      p.funnel.scale.set(r * open, 6.5 * open, r * open);
      p.letter.position.set(e.pos.x, floor + 0.1, e.pos.z);
      p.letter.scale.setScalar(r * 0.55 * open);
    }
    // The link of light, A to B, a long flat beam at waist height.
    const a = this.portals[0].id >= 0 ? world.entities.get(this.portals[0].id) : undefined;
    const b = this.portals[1].id >= 0 ? world.entities.get(this.portals[1].id) : undefined;
    this.link.visible = !!a && !!b;
    if (a && b) {
      const l = portalLink(a.pos.x, a.pos.z, b.pos.x, b.pos.z);
      this.link.position.set(l.mx, Math.max(a.pos.y, b.pos.y) + 1.4, l.mz);
      this.link.rotation.set(0, l.yaw, 0);
      this.link.scale.set(1, 1.1, Math.max(0.01, l.len));
    }
    // Each marked player: the letter over them, the coming portal filling underfoot.
    for (const m of this.marks) {
      const e = m.id >= 0 ? world.entities.get(m.id) : undefined;
      const aura = e?.auras.find(
        (x) => x.id === (m.which === 'A' ? BREATH_AURAS.portalA : BREATH_AURAS.portalB),
      );
      const show = !!e && !!aura && !e.dead;
      m.ring.visible = show;
      m.letter.A.visible = show && m.which === 'A';
      m.letter.B.visible = show && m.which === 'B';
      if (!e || !aura || !show) continue;
      m.fill.value = markFill(aura.remaining, aura.duration);
      const floor = h.groundY(e.pos.x, e.pos.z);
      m.ring.position.set(e.pos.x, floor + 0.11, e.pos.z);
      m.ring.scale.set(T.heartPortalR, 1, T.heartPortalR);
      const letter = m.which === 'A' ? m.letter.A : m.letter.B;
      letter.position.set(e.pos.x, e.pos.y + 3.6 + 0.12 * Math.sin(now * 4), e.pos.z);
      letter.scale.setScalar(1.15);
    }
    // A throw going off into the void, trailing storm.
    for (const f of this.flights) {
      if (!f.live) {
        f.mesh.visible = false;
        continue;
      }
      const t = now - f.bornAt;
      if (!throwOffset(t, { x: f.hx, z: f.hz }, this.offset)) {
        f.live = false;
        f.mesh.visible = false;
        continue;
      }
      f.mesh.visible = true;
      f.mesh.position.set(f.x + this.offset.x, f.y + this.offset.y, f.z + this.offset.z);
      f.mesh.scale.setScalar(1 - (0.6 * t) / THROW_ARC.seconds);
      if (Math.floor(t * 30) !== Math.floor((t - dt) * 30))
        this.puff(f.mesh.position.x, f.mesh.position.y, f.mesh.position.z, 2, 1.5, TINT.a, 0.6);
    }
    // The burst.
    const burst = burstLook(now - this.burstBorn);
    this.burstWall.visible = burst !== null;
    this.burstFlash.visible = burst !== null && burst.flash > 0.01;
    if (burst) {
      this.burstAlpha.value = burst.alpha;
      this.burstWall.scale.set(burst.radius, 22, burst.radius);
      this.burstFlash.scale.setScalar(6 + 26 * (1 - burst.flash));
      (this.burstFlash.material as THREE.MeshBasicMaterial).opacity = burst.flash * 0.9;
    } else if (now - this.burstBorn > BURST_SECONDS) this.burstBorn = -99;
  }
}

const _danger = new THREE.Color(C.danger);

/** The particles' tints (their pool takes linear rgb). */
const TINT = {
  a: [0.28, 0.94, 0.85],
  b: [0.7, 0.47, 1],
  storm: [0.56, 0.7, 1],
  load: [1, 0.82, 0.48],
} as const;
