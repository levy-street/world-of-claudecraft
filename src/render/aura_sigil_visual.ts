import * as THREE from 'three';

// World-space presentation for the persistent self-buff "modes" the sim already
// treats as mutually exclusive: paladin auras, warrior stances and shouts, hunter
// aspects. The sim owns which one is active (exclusiveGroup, src/sim/combat/
// exclusive_aura.ts); this module only follows the mirrored aura and draws the
// ground rune plus the two flanking crescents under whoever CAST it.
//
// Nothing here touches the sim: no new aura kind, no wire field, no IWorld member.
// A sigil appears when an entity carries one of the SIGIL_AURA_IDS and is itself
// the source of it, so a party member buffed by someone else's Steadfast Aura or
// Iron Bellow does NOT sprout a second circle — matching the genre convention that
// the ring marks the caster, not everyone standing in it.

const REFERENCE_CHARACTER_HEIGHT = 1.8;
const REVEAL_SECONDS = 0.3;
const FADE_SECONDS = 0.24;

/** The subset of Aura['school'] this module paints. */
export type AuraSigilSchool =
  | 'physical'
  | 'fire'
  | 'frost'
  | 'arcane'
  | 'shadow'
  | 'holy'
  | 'nature';

/**
 * Ability ids whose aura marks its caster with a sigil.
 *
 * This is the render-side mirror of the sim's exclusive self-buff groups
 * (`paladin_aura`, `warrior_stance`, `warrior_shout`, `aspect`). It is a literal
 * set rather than a lookup so this module stays free of any value import from
 * src/sim (tests/architecture.test.ts enforces type-only sim imports here);
 * tests/aura_sigil.test.ts reads classes.ts and fails if the two ever drift.
 */
export const SIGIL_AURA_IDS: ReadonlySet<string> = new Set([
  // exclusiveGroup: 'paladin_aura'
  'devotion_aura',
  'retribution_aura',
  // exclusiveGroup: 'warrior_stance'
  'battle_stance',
  'defensive_stance',
  'berserker_stance',
  // exclusiveGroup: 'warrior_shout'
  'battle_shout',
  // exclusiveGroup: 'aspect'
  'aspect_of_the_hawk',
  'aspect_of_the_monkey',
  'aspect_of_the_cheetah',
]);

export interface AuraSigilState {
  /** Ability id of the aura driving the sigil. */
  id: string;
  school: AuraSigilSchool;
}

interface SigilPalette {
  /** The flat ground disc. */
  rune: number;
  /** The two flanking arcs. */
  crescent: number;
}

// One palette per magic school, so an aura added to any existing exclusive group
// is coloured correctly without touching this file.
const PALETTES: Record<AuraSigilSchool, SigilPalette> = {
  holy: { rune: 0xffe9a8, crescent: 0xfff6d6 },
  physical: { rune: 0xffb066, crescent: 0xffd9b0 },
  nature: { rune: 0x86e07a, crescent: 0xd2f5c8 },
  fire: { rune: 0xff7a3c, crescent: 0xffc48a },
  frost: { rune: 0x6fd4ff, crescent: 0xc9f0ff },
  arcane: { rune: 0xc08cff, crescent: 0xe6d3ff },
  shadow: { rune: 0x9a6bd6, crescent: 0xd8bff2 },
};

// Shared across every sigil in the scene: geometry is identical for all of them
// and only the materials differ, so a raid of paladins costs one allocation each.
const RUNE_GEOMETRY = new THREE.RingGeometry(0.58, 0.92, 48);
const RUNE_EDGE_GEOMETRY = new THREE.RingGeometry(0.96, 1, 48);
// A quarter-arc of a circle centred on the character; two of them, mirrored,
// read as the pair of crescents flanking the body.
const CRESCENT_GEOMETRY = new THREE.TorusGeometry(0.62, 0.028, 6, 40, Math.PI * 0.5);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

function isSigilSchool(school: string): school is AuraSigilSchool {
  return school in PALETTES;
}

/**
 * The sigil an entity should be showing, or null.
 *
 * `out` is a caller-owned scratch object: passing one keeps a steady frame free
 * of allocation (the reused-reference proxy in tests/util/alloc_probe.ts).
 */
export function auraSigilStateForAuras(
  entityId: number,
  auras: ReadonlyArray<{ id: string; school: string; sourceId: number }>,
  out?: AuraSigilState,
): AuraSigilState | null {
  for (let i = 0; i < auras.length; i++) {
    const aura = auras[i];
    if (aura.sourceId !== entityId) continue;
    if (!SIGIL_AURA_IDS.has(aura.id)) continue;
    if (!isSigilSchool(aura.school)) continue;
    if (out) {
      out.id = aura.id;
      out.school = aura.school;
      return out;
    }
    return { id: aura.id, school: aura.school };
  }
  return null;
}

/**
 * Persistent ground sigil for one entity. Built lazily on the first sigil aura,
 * restyled in place when the active aura changes school, and faded out (not torn
 * down) when the aura drops, so re-casting inside the fade window is seamless.
 */
export class AuraSigilVisual {
  readonly group = new THREE.Group();

  private readonly content = new THREE.Group();
  private readonly runeMaterial: THREE.MeshBasicMaterial;
  private readonly edgeMaterial: THREE.MeshBasicMaterial;
  private readonly crescentMaterial: THREE.MeshBasicMaterial;
  private readonly rune: THREE.Mesh;
  private readonly edge: THREE.Mesh;
  private readonly crescents = new THREE.Group();
  private readonly baseScale: number;

  private school: AuraSigilSchool;
  private disposed = false;
  private reveal = 0;
  private elapsed = 0;

  constructor(characterHeight: number, school: AuraSigilSchool) {
    this.school = school;
    this.group.name = 'aura-sigil-visual';
    this.group.visible = false;

    const palette = PALETTES[school];
    this.baseScale = Math.max(0.75, Math.min(1.45, characterHeight / REFERENCE_CHARACTER_HEIGHT));
    this.content.name = 'aura-sigil-content';
    this.content.scale.setScalar(this.baseScale);

    this.runeMaterial = new THREE.MeshBasicMaterial({
      color: palette.rune,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.rune = new THREE.Mesh(RUNE_GEOMETRY, this.runeMaterial);
    this.rune.name = 'aura-sigil-rune';
    this.rune.rotation.x = -Math.PI / 2;
    this.rune.position.y = 0.02;
    this.rune.renderOrder = 8;
    this.content.add(this.rune);

    this.edgeMaterial = new THREE.MeshBasicMaterial({
      color: palette.crescent,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.edge = new THREE.Mesh(RUNE_EDGE_GEOMETRY, this.edgeMaterial);
    this.edge.name = 'aura-sigil-rune-edge';
    this.edge.rotation.x = -Math.PI / 2;
    this.edge.position.y = 0.025;
    this.edge.renderOrder = 9;
    this.content.add(this.edge);

    this.crescentMaterial = new THREE.MeshBasicMaterial({
      color: palette.crescent,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.crescents.name = 'aura-sigil-crescents';
    this.crescents.position.y = 0.98;
    // Two arcs of the same circle, centred on +x and -x, so they frame the body.
    const rotations = [-Math.PI * 0.25, Math.PI * 0.75] as const;
    for (let i = 0; i < rotations.length; i++) {
      const arc = new THREE.Mesh(CRESCENT_GEOMETRY, this.crescentMaterial);
      arc.name = `aura-sigil-crescent-${i + 1}`;
      arc.rotation.z = rotations[i];
      arc.renderOrder = 10;
      this.crescents.add(arc);
    }
    this.content.add(this.crescents);

    this.group.add(this.content);
  }

  private applyPalette(school: AuraSigilSchool): void {
    const palette = PALETTES[school];
    this.runeMaterial.color.setHex(palette.rune);
    this.edgeMaterial.color.setHex(palette.crescent);
    this.crescentMaterial.color.setHex(palette.crescent);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runeMaterial.dispose();
    this.edgeMaterial.dispose();
    this.crescentMaterial.dispose();
    this.group.removeFromParent();
  }

  /**
   * @param state    the active sigil, or null to fade out
   * @param dt       seconds since the last frame
   * @param opacity  player's aura-sigil opacity setting (0..1)
   * @param scale    player's aura-sigil scale setting
   */
  update(
    state: AuraSigilState | null,
    dt: number,
    opacity: number,
    scale: number,
  ): void {
    if (this.disposed) return;
    const delta = Math.max(0, dt);

    if (state) {
      if (state.school !== this.school) {
        this.school = state.school;
        this.applyPalette(state.school);
      }
      this.reveal = clamp01(this.reveal + delta / REVEAL_SECONDS);
    } else {
      this.reveal = clamp01(this.reveal - delta / FADE_SECONDS);
    }

    if (this.reveal <= 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.elapsed += delta;

    const eased = easeOutCubic(this.reveal);
    const strength = eased * clamp01(opacity);
    // A slow breath keeps the sigil alive without pulling the eye off combat.
    const breath = 0.92 + 0.08 * Math.sin(this.elapsed * 1.6);

    this.runeMaterial.opacity = 0.42 * strength * breath;
    this.edgeMaterial.opacity = 0.55 * strength;
    this.crescentMaterial.opacity = 0.7 * strength * breath;

    this.content.scale.setScalar(this.baseScale * Math.max(0.1, scale) * (0.86 + 0.14 * eased));
    // The disc turns; the crescents counter-turn a little slower.
    this.rune.rotation.z = this.elapsed * 0.35;
    this.edge.rotation.z = -this.elapsed * 0.22;
    this.crescents.rotation.y = -this.elapsed * 0.18;
  }

  /** True once a faded-out sigil has nothing left to draw and can be released. */
  get finished(): boolean {
    return this.reveal <= 0;
  }
}

/**
 * Build / update / release an entity's sigil in one call, mirroring
 * syncMageBarrierVisual. Returns the visual to store back on the entity view.
 */
export function syncAuraSigilVisual(
  visual: AuraSigilVisual | null,
  parent: THREE.Group,
  characterHeight: number,
  state: AuraSigilState | null,
  dt: number,
  opacity: number,
  scale: number,
): AuraSigilVisual | null {
  let current = visual;
  if (state && !current) {
    current = new AuraSigilVisual(characterHeight, state.school);
    parent.add(current.group);
  }
  if (!current) return null;
  current.update(state, dt, opacity, scale);
  if (!state && current.finished) {
    current.dispose();
    return null;
  }
  return current;
}
