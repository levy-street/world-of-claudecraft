// The Knotted Gale (encounters/smith_heart/breath_heart.ts), a part of BreathFightFx,
// on EVERY tier (the raid acts on all of it): the ball, a Storm Orb wound in a knot of
// wind, growing and more violent to its end, on a floor ring that shrinks as its timer;
// the portals told apart at a glance (teal A, violet B, a funnel of wind each, the
// letter on the floor) with a link of light between them; phase 2's second pair a
// family of its own (spring-green C, rose D: three arms turning the other way inside
// a doubled rim, the funnel's bands the other way, a dark plum letter, and a braid of
// two twisting strands for a link, riding above the first pair's beam); each marked
// player's letter
// over their head and the filling ring of the portal to come; the carrier with the ball
// over them and a ring pressed into the floor. The throw arcs off into the void; the
// burst is a flash, a wall of storm across the Cornice and a shake. Cosmetic particles
// thin on the low tier; the shake honours reduced motion through the host.
//
// Built in the constructor under the host's root (its one gated attach): fixed pools,
// no light, no per-frame allocation. The plan's numbers: breath_heart_fx_core.ts.

import * as THREE from 'three';
import type { BreathKnotHeard } from '../../game/smith_heart_breath_audio';
import {
  BREATH_CUES,
  knotOf,
  BREATH_TUNING as T,
} from '../../sim/encounters/smith_heart/breath_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  BURST_SECONDS,
  burstLook,
  HEART_COLORS as C,
  FLIGHT_LOOK,
  FLIGHT_TRAIL,
  flightGhost,
  flightScale,
  HEART_FLOOR,
  HEART_SIDES,
  type HeartObjectKind,
  type HeartPortalSide,
  heartObjectKind,
  KNOT_CARRY_Y,
  KNOT_FLOAT_Y,
  knotLook,
  LINK_R,
  LINK_Y,
  liveFuse,
  markFill,
  markSideOf,
  HEART_POOLS as P,
  portalLink,
  portalSideLook,
  portalSideOfKind,
  throwHeading,
  throwOffset,
} from './breath_heart_fx_core';
import {
  BURST_FRAG,
  FACING_FRAG,
  FACING_VERT,
  FLOOR_FACING_VERT,
  FLOOR_LETTER_FRAG,
  HEART_RING_FRAG,
  HEART_UV_VERT,
  PORTAL_DISC_FRAG,
  PORTAL_FUNNEL_FRAG,
  PORTAL_LINK_FRAG,
  PORTAL_LINK_VERT,
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

/** A ring arc's outline (an ellipse about cx, cy from a0 to a1 radians). */
function arc(
  path: THREE.Path,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  steps: number,
  first: boolean,
): void {
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (first && i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
}

/** A block letter as a flat shape in x/y, a yard or so tall: A, B, C or D. */
function letterShape(which: HeartPortalSide): THREE.Shape {
  const s = new THREE.Shape();
  if (which === 'C') {
    // A thick open ring, its mouth to the right.
    const open = (50 * Math.PI) / 180;
    arc(s, 0.05, 0, 0.55, 0.7, open, Math.PI * 2 - open, 20, true);
    arc(s, 0.05, 0, 0.29, 0.44, Math.PI * 2 - open, open, 20, false);
    s.closePath();
    return s;
  }
  if (which === 'D') {
    s.moveTo(-0.45, -0.7);
    arc(s, -0.05, 0, 0.53, 0.7, -Math.PI / 2, Math.PI / 2, 18, false);
    s.lineTo(-0.45, 0.7);
    s.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-0.18, 0.44);
    hole.lineTo(-0.18, -0.44);
    arc(hole, -0.05, 0, 0.27, 0.44, -Math.PI / 2, Math.PI / 2, 14, false);
    hole.closePath();
    s.holes.push(hole);
    return s;
  }
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
  letter: Record<HeartPortalSide, THREE.Mesh>;
  fill: { value: number };
  ringColor: THREE.Color;
  id: number;
  which: HeartPortalSide;
}

interface LinkSlot {
  mesh: THREE.Mesh;
  len: { value: number };
}

interface FlightSlot {
  /** The ball itself: the Storm Orb's shell, its core, its knot of wind. */
  shell: THREE.Mesh;
  core: THREE.Mesh;
  wind: THREE.Mesh;
  /** The dark storm halo behind it (normal blending: it reads on a pale sky). */
  halo: THREE.Mesh;
  /** The wake, back along its own arc. */
  ghosts: THREE.Mesh[];
  turn: number;
  bornAt: number;
  live: boolean;
  x: number;
  y: number;
  z: number;
  /** Its heading out of the Cornice (written at launch, read every frame). */
  heading: { x: number; z: number };
}

export class BreathHeartFx {
  private readonly knots: KnotSlot[] = [];
  /** The Knotted Gale the fight's sound hears this frame (the most urgent),
   *  or null (game/smith_heart_breath_audio.ts). */
  heard: BreathKnotHeard | null = null;
  private readonly heardKnot: BreathKnotHeard = { x: 0, y: 0, z: 0, held: false, fuse: 0 };
  /** One slot per side, in side order (A, B, C, D). */
  private readonly portals: PortalSlot[] = [];
  private readonly marks: MarkSlot[] = [];
  private readonly flights: FlightSlot[] = [];
  /** One link per pair: A to B, C to D. */
  private readonly links: LinkSlot[] = [];
  private readonly burstWall: THREE.Mesh;
  private readonly burstFlash: THREE.Mesh;
  private readonly burstAlpha = { value: 0 };
  private burstBorn = -99;
  private readonly offset = { x: 0, y: 0, z: 0 };
  private readonly ghostAt = { x: 0, y: 0, z: 0 };
  // The scan's finds (rewritten at the host's scan pace).
  private seenKnots = 0;
  private seenMarks = 0;
  private readonly seenPortal = HEART_SIDES.map(() => false);

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
    // Each side's letter: upright over a marked player, flat in its mouth (the
    // mouth's shader lays it on the floor, turned to the camera).
    const letters = {} as Record<HeartPortalSide, THREE.ShapeGeometry>;
    for (const side of HEART_SIDES) {
      letters[side] = new THREE.ShapeGeometry(letterShape(side));
      h.geometries.push(letters[side]);
    }
    const orb = new THREE.SphereGeometry(1, 28, 20);
    const orbCore = new THREE.SphereGeometry(0.55, 16, 12);
    const knot = new THREE.TorusKnotGeometry(1.25, 0.05, 140, 6, 2, 3);
    const funnel = new THREE.CylinderGeometry(1.5, 0.75, 1, 28, 1, true);
    funnel.translate(0, 0.5, 0);
    const wall = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
    wall.translate(0, 0.5, 0);
    h.geometries.push(floorQuad);
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
              uTime: h.uTime,
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
            {
              uColor: { value: color(C.load) },
              uAlpha: { value: 0.9 },
              uFill: { value: 0.75 },
              uTime: h.uTime,
            },
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

    for (const tag of HEART_SIDES) {
      const look = portalSideLook(tag);
      const side = { hex: look.color, floor: letters[tag], tag };
      const open = { value: 0 };
      const u = {
        uTime: h.uTime,
        uOpen: open,
        uColor: { value: color(side.hex) },
        uArms: { value: look.arms },
        uSpin: { value: look.spin },
        uRing2: { value: look.ring2 },
      };
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
          // A dark ink in the pair's own cast: deep sea for A and B, deep plum
          // for C and D, so the letter stays crisp on its bright mouth; turned
          // to the camera on the floor so it never reads upside down.
          shader(
            `smithHeartPortalLetter${side.tag}`,
            { uColor: { value: color(look.pair === 0 ? 0x06202a : 0x2a0620) } },
            FLOOR_FACING_VERT,
            FLOOR_LETTER_FRAG,
            {
              blending: THREE.NormalBlending,
              depthWrite: false,
              toneMapped: false,
              side: THREE.DoubleSide,
            },
          ),
          HEART_FLOOR.letter,
        ),
        open,
        id: -1,
        bornAt: 0,
      });
      h.materials.push(this.portals[this.portals.length - 1].letter.material as THREE.Material);
    }

    const faces = {} as Record<HeartPortalSide, THREE.ShaderMaterial>;
    for (const side of HEART_SIDES)
      faces[side] = shader(
        `smithHeartMarkLetter${side}`,
        { uColor: { value: color(portalSideLook(side).color) }, uTime: h.uTime },
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
            { uColor: { value: ringColor }, uAlpha: { value: 1 }, uFill: fill, uTime: h.uTime },
            HEART_UV_VERT,
            HEART_RING_FRAG,
          ),
          HEART_FLOOR.mark,
        ),
        letter: {
          A: mk('smithHeartMarkLetterA', letters.A, faces.A),
          B: mk('smithHeartMarkLetterB', letters.B, faces.B),
          C: mk('smithHeartMarkLetterC', letters.C, faces.C),
          D: mk('smithHeartMarkLetterD', letters.D, faces.D),
        },
        fill,
        ringColor,
        id: -1,
        which: 'A',
      });
    }

    // One link per pair: A's teal to B's violet in a soft beam; C's green to D's
    // rose in a braid of two twisting strands, riding higher.
    // A tube of light along z (PORTAL_LINK_VERT), round from every side.
    const linkGeo = new THREE.CylinderGeometry(1, 1, 1, 18, 24, true).rotateX(Math.PI / 2);
    h.geometries.push(linkGeo);
    for (let pair = 0; pair < P.links; pair++) {
      const from = portalSideLook(HEART_SIDES[pair * 2]).color;
      const to = portalSideLook(HEART_SIDES[pair * 2 + 1]).color;
      const len = { value: 1 };
      this.links.push({
        mesh: mk(
          `smithHeartPortalLink${pair + 1}`,
          linkGeo,
          shader(
            `smithHeartPortalLink${pair + 1}`,
            {
              uTime: h.uTime,
              uA: { value: color(from) },
              uB: { value: color(to) },
              uBraid: { value: pair },
              uLen: len,
            },
            PORTAL_LINK_VERT,
            PORTAL_LINK_FRAG,
            { side: THREE.DoubleSide },
          ),
        ),
        len,
      });
    }

    // The throw flies as the ball the raid carried, at full crackle, cut out of the
    // Cornice's pale sky by a dark halo and trailing a wake of teal (normal blending:
    // a mid teal reads darker than the sky and lighter than the rock).
    const flightU = { uTime: h.uTime, uCrackle: { value: 1 }, uStorm: { value: color(C.storm) } };
    const flightShell = shader('smithHeartKnotFlightShell', flightU, KIT_UV_VERT, ORB_FRAG);
    const flightCore = shader('smithHeartKnotFlightCore', flightU, KIT_UV_VERT, ORB_CORE_FRAG);
    const flightHalo = new THREE.MeshBasicMaterial({
      name: 'smithHeartKnotFlightHalo',
      color: 0x161c3c,
      transparent: true,
      opacity: 0.62,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });
    h.materials.push(flightHalo);
    const ghostMats: THREE.MeshBasicMaterial[] = [];
    for (let g = 0; g < FLIGHT_TRAIL.ghosts; g++) {
      const m = new THREE.MeshBasicMaterial({
        name: 'smithHeartKnotFlightWake',
        color: 0x1fae9c,
        transparent: true,
        opacity: flightGhost(g).alpha,
        depthWrite: false,
        toneMapped: false,
      });
      h.materials.push(m);
      ghostMats.push(m);
    }
    for (let i = 0; i < P.flights; i++) {
      this.flights.push({
        shell: mk('smithHeartKnotFlight', orb, flightShell),
        core: mk('smithHeartKnotFlightCore', orbCore, flightCore),
        wind: mk('smithHeartKnotFlightWind', knot, knotWind),
        halo: mk('smithHeartKnotFlightHalo', orb, flightHalo),
        ghosts: ghostMats.map((m) => mk('smithHeartKnotFlightWake', orbCore, m)),
        turn: 0,
        bornAt: -99,
        live: false,
        x: 0,
        y: 0,
        z: 0,
        heading: { x: 0, z: 1 },
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
    this.seenPortal.fill(false);
  }

  /** A fight object the scan found; false when it is none of this mechanic's. */
  takeObject(e: Entity): boolean {
    const kind: HeartObjectKind | null = heartObjectKind(e.templateId);
    if (!kind) return false;
    if (kind === 'knot') {
      if (this.seenKnots < this.knots.length) this.knots[this.seenKnots++].id = e.id;
      return true;
    }
    const side = portalSideOfKind(kind);
    if (!side) return true;
    const i = portalSideLook(side).slot;
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
    const which = markSideOf(auraId);
    if (!which || this.seenMarks >= this.marks.length) return;
    const m = this.marks[this.seenMarks++];
    m.id = e.id;
    m.which = which;
    m.ringColor.setHex(portalSideLook(which).color);
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
      for (const side of HEART_SIDES) m.letter[side].visible = false;
    }
    for (const l of this.links) l.mesh.visible = false;
    this.burstWall.visible = false;
    this.burstFlash.visible = false;
    for (const f of this.flights) this.hideFlight(f);
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
      if (ev.ability === BREATH_CUES.portalOpen || ev.ability === BREATH_CUES.portalOpenPair2) {
        const tint = ev.ability === BREATH_CUES.portalOpen ? TINT.a : TINT.c;
        this.puff(ev.x, y + 0.5, ev.z, 26, 7, tint, T.heartPortalR);
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
    if (
      ev.type === 'spellfx' &&
      (ev.ability === BREATH_CUES.portalHop || ev.ability === BREATH_CUES.portalHopPair2)
    ) {
      const p = world.entities.get(ev.targetId);
      if (p) {
        const tint = ev.ability === BREATH_CUES.portalHop ? TINT.b : TINT.d;
        this.puff(fxAnchor(p).x, fxAnchor(p).y + 1, fxAnchor(p).z, 30, 8, tint, 1.5);
        h.shakeNear(fxAnchor(p).x, fxAnchor(p).z, 0.2, 18);
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
    f.heading.x = heading.x;
    f.heading.z = heading.z;
  }

  private hideFlight(f: FlightSlot): void {
    f.shell.visible = false;
    f.core.visible = false;
    f.wind.visible = false;
    f.halo.visible = false;
    for (const g of f.ghosts) g.visible = false;
  }

  // ---- the frame --------------------------------------------------------------------------

  update(world: IWorld, dt: number): void {
    const h = this.h;
    const now = h.uTime.value;
    this.heard = null;
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
      const fuse = liveFuse(of.fuse, now - k.changedAt);
      const look = knotLook(fuse, of.full);
      const held = of.state === 'held';
      const eAt = fxAnchor(e);
      const floor = h.groundY(eAt.x, eAt.z);
      // The ball the sound hears: the one nearest its burst.
      if (!this.heard || fuse < this.heard.fuse) {
        const a = this.heardKnot;
        a.x = eAt.x;
        a.y = floor;
        a.z = eAt.z;
        a.held = held;
        a.fuse = fuse;
        this.heard = a;
      }
      const y = floor + (held ? KNOT_CARRY_Y : KNOT_FLOAT_Y) + 0.15 * Math.sin(now * 3);
      const r = look.radius * (1 + 0.14 * look.throb * Math.sin(now * 14));
      k.crackle.value = look.crackle;
      k.turn += look.spin * dt;
      k.shell.position.set(eAt.x, y, eAt.z);
      k.shell.scale.setScalar(r);
      k.core.position.copy(k.shell.position);
      k.core.scale.setScalar(r);
      k.wind.position.copy(k.shell.position);
      k.wind.scale.setScalar(r);
      k.wind.rotation.set(k.turn * 0.7, k.turn, k.turn * 0.4);
      k.shell.visible = true;
      k.core.visible = true;
      k.wind.visible = true;
      k.ring.position.set(eAt.x, floor + 0.1, eAt.z);
      k.ring.scale.set(look.ringR, 1, look.ringR);
      k.ring.visible = true;
      k.ringColor.setHex(C.storm).lerp(_danger, look.danger);
      k.ringAlpha.value = 0.75 + 0.25 * look.throb * Math.sin(now * 14);
      k.load.visible = held;
      if (held) {
        k.load.position.set(eAt.x, floor + 0.12, eAt.z);
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
      const eAt = fxAnchor(e);
      const floor = h.groundY(eAt.x, eAt.z);
      const open = Math.min(1, (now - p.bornAt) / 0.5);
      p.open.value = open;
      p.disc.position.set(eAt.x, floor + 0.08, eAt.z);
      p.disc.scale.set(r * open, 1, r * open);
      p.funnel.position.set(eAt.x, floor + 0.05, eAt.z);
      p.funnel.scale.set(r * open, 6.5 * open, r * open);
      p.letter.position.set(eAt.x, floor + 0.1, eAt.z);
      p.letter.scale.setScalar(r * 0.55 * open);
    }
    // The links of light within each pair: A to B a long flat beam at waist
    // height, C to D a braid riding above it. Never one across the pairs.
    for (let pair = 0; pair < this.links.length; pair++) {
      const link = this.links[pair];
      const pa = this.portals[pair * 2];
      const pb = this.portals[pair * 2 + 1];
      const a = pa.id >= 0 ? world.entities.get(pa.id) : undefined;
      const b = pb.id >= 0 ? world.entities.get(pb.id) : undefined;
      link.mesh.visible = !!a && !!b;
      if (!a || !b) continue;
      const l = portalLink(a.pos.x, a.pos.z, b.pos.x, b.pos.z);
      link.mesh.position.set(l.mx, Math.max(a.pos.y, b.pos.y) + LINK_Y[pair], l.mz);
      link.mesh.rotation.set(0, l.yaw, 0);
      link.mesh.scale.set(LINK_R[pair], LINK_R[pair], Math.max(0.01, l.len));
      link.len.value = l.len;
    }
    // Each marked player: the letter over them, the coming portal filling underfoot.
    for (const m of this.marks) {
      const e = m.id >= 0 ? world.entities.get(m.id) : undefined;
      const aura = e?.auras.find((x) => markSideOf(x.id) === m.which);
      const show = !!e && !!aura && !e.dead;
      m.ring.visible = show;
      for (const side of HEART_SIDES) m.letter[side].visible = show && m.which === side;
      if (!e || !aura || !show) continue;
      m.fill.value = markFill(aura.remaining, aura.duration);
      const eAt = fxAnchor(e);
      const floor = h.groundY(eAt.x, eAt.z);
      m.ring.position.set(eAt.x, floor + 0.11, eAt.z);
      m.ring.scale.set(T.heartPortalR, 1, T.heartPortalR);
      const letter = m.letter[m.which];
      letter.position.set(eAt.x, eAt.y + 3.6 + 0.12 * Math.sin(now * 4), eAt.z);
      letter.scale.setScalar(1.15);
    }
    // A throw going off into the void, trailing storm.
    for (const f of this.flights) {
      if (!f.live) {
        this.hideFlight(f);
        continue;
      }
      const t = now - f.bornAt;
      const heading = f.heading;
      if (!throwOffset(t, heading, this.offset)) {
        f.live = false;
        this.hideFlight(f);
        continue;
      }
      const r = flightScale(t);
      f.turn += FLIGHT_LOOK.spin * dt;
      f.shell.position.set(f.x + this.offset.x, f.y + this.offset.y, f.z + this.offset.z);
      f.shell.scale.setScalar(r);
      f.core.position.copy(f.shell.position);
      f.core.scale.setScalar(r);
      f.wind.position.copy(f.shell.position);
      f.wind.scale.setScalar(r);
      f.wind.rotation.set(f.turn * 0.7, f.turn, f.turn * 0.4);
      f.halo.position.copy(f.shell.position);
      f.halo.scale.setScalar(r * FLIGHT_LOOK.halo);
      f.shell.visible = true;
      f.core.visible = true;
      f.wind.visible = true;
      f.halo.visible = true;
      for (let g = 0; g < f.ghosts.length; g++) {
        const ghost = f.ghosts[g];
        const look = flightGhost(g);
        if (!throwOffset(t - look.lag, heading, this.ghostAt)) {
          ghost.visible = false;
          continue;
        }
        ghost.position.set(f.x + this.ghostAt.x, f.y + this.ghostAt.y, f.z + this.ghostAt.z);
        ghost.scale.setScalar(r * look.scale * 1.8);
        ghost.visible = true;
      }
      if (Math.floor(t * 30) !== Math.floor((t - dt) * 30))
        this.puff(f.shell.position.x, f.shell.position.y, f.shell.position.z, 2, 1.5, TINT.a, 0.6);
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
  c: [0.66, 1, 0.24],
  d: [1, 0.35, 0.69],
  storm: [0.56, 0.7, 1],
  load: [1, 0.82, 0.48],
} as const;
