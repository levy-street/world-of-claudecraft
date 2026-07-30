import * as THREE from 'three';

const REFERENCE_CHARACTER_HEIGHT = 1.8;
const REVEAL_SECONDS = 0.22;
const BREAK_SECONDS = 0.28;
const MOTE_COUNT = 12;

export type MageBarrierTheme = 'frost' | 'fire' | 'temporal';

export interface MageBarrierState {
  theme: MageBarrierTheme;
  value: number;
  remaining?: number;
}

interface BarrierPalette {
  shell: number;
  rune: number;
  mote: number;
}

// Fire and Temporal are intentionally ready at the renderer seam. Their aura ids
// can opt in later without duplicating geometry, animation, or lifecycle code.
const PALETTES: Record<MageBarrierTheme, BarrierPalette> = {
  frost: { shell: 0x64cfff, rune: 0xc9f3ff, mote: 0xe9fbff },
  fire: { shell: 0xff6b32, rune: 0xffd08a, mote: 0xfff0c2 },
  temporal: { shell: 0x9f6cff, rune: 0x67e8f9, mote: 0xe9d5ff },
};

const SHELL_GEOMETRY = new THREE.SphereGeometry(0.98, 24, 16);
const RUNE_GEOMETRY = new THREE.TorusGeometry(0.9, 0.025, 5, 48);
const MOTE_GEOMETRY = new THREE.OctahedronGeometry(0.055, 0);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function mageBarrierStateForAuras(
  auras: ReadonlyArray<{
    id: string;
    kind: string;
    value: number;
    remaining?: number;
    school?: string;
  }>,
): MageBarrierState | null {
  for (const aura of auras) {
    const state = mageBarrierStateForAura(aura);
    if (state) return state;
  }
  return null;
}

export function mageBarrierStateForAura(
  aura: {
    id: string;
    kind: string;
    value: number;
    remaining?: number;
    school?: string;
  },
  out?: MageBarrierState,
): MageBarrierState | null {
  if (aura.kind !== 'absorb' || aura.value <= 0) return null;
  const theme: MageBarrierTheme | null =
    aura.id === 'ice_barrier'
      ? 'frost'
      : aura.id === 'blazing_barrier'
        ? 'fire'
        : aura.id === 'temporal_barrier'
          ? 'temporal'
          : aura.id === 'mass_barrier'
            ? aura.school === 'arcane'
              ? 'temporal'
              : aura.school === 'fire'
                ? 'fire'
                : 'frost'
            : null;
  if (!theme) return null;
  if (out) {
    out.theme = theme;
    out.value = aura.value;
    if (aura.remaining === undefined) delete out.remaining;
    else out.remaining = aura.remaining;
    return out;
  }
  return aura.remaining === undefined
    ? { theme, value: aura.value }
    : { theme, value: aura.value, remaining: aura.remaining };
}

/**
 * Persistent presentation for a personal mage barrier. The simulation owns the
 * absorb amount and lifetime; this class only follows the mirrored aura state.
 */
export class MageBarrierVisual {
  readonly group = new THREE.Group();
  activatedThisFrame = false;
  brokeThisFrame = false;

  private readonly shellMaterial: THREE.MeshBasicMaterial;
  private readonly runeMaterial: THREE.MeshBasicMaterial;
  private readonly moteMaterial: THREE.MeshBasicMaterial;
  private readonly runeBands = new THREE.Group();
  private readonly motes: THREE.InstancedMesh;
  private readonly moteDummy = new THREE.Object3D();
  private active = false;
  private breaking = false;
  private disposed = false;
  private reveal = 0;
  private breakElapsed = 0;
  private elapsed = 0;
  private peakValue = 1;
  private lastRemaining: number | null = null;

  constructor(
    characterHeight: number,
    private theme: MageBarrierTheme,
  ) {
    this.group.name = 'mage-barrier-visual';
    this.group.visible = false;

    const palette = PALETTES[theme];
    const content = new THREE.Group();
    content.name = 'mage-barrier-content';
    const size = Math.max(0.75, Math.min(1.45, characterHeight / REFERENCE_CHARACTER_HEIGHT));
    content.scale.setScalar(size);

    this.shellMaterial = new THREE.MeshBasicMaterial({
      color: palette.shell,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const shell = new THREE.Mesh(SHELL_GEOMETRY, this.shellMaterial);
    shell.name = 'mage-barrier-shell';
    shell.position.y = 1.04;
    shell.scale.y = 1.12;
    shell.renderOrder = 10;
    content.add(shell);

    this.runeMaterial = new THREE.MeshBasicMaterial({
      color: palette.rune,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.runeBands.name = 'mage-barrier-rune-bands';
    const bandPlacements = [
      { y: 0.52, x: Math.PI / 2, z: 0 },
      { y: 1.05, x: Math.PI / 2 + 0.34, z: 0.28 },
      { y: 1.55, x: Math.PI / 2 - 0.28, z: -0.32 },
    ] as const;
    for (let i = 0; i < bandPlacements.length; i++) {
      const placement = bandPlacements[i];
      const band = new THREE.Mesh(RUNE_GEOMETRY, this.runeMaterial);
      band.name = `mage-barrier-rune-band-${i + 1}`;
      band.position.y = placement.y;
      band.rotation.set(placement.x, 0, placement.z);
      band.renderOrder = 11;
      this.runeBands.add(band);
    }
    content.add(this.runeBands);

    this.moteMaterial = new THREE.MeshBasicMaterial({
      color: palette.mote,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.InstancedMesh(MOTE_GEOMETRY, this.moteMaterial, MOTE_COUNT);
    this.motes.name = 'mage-barrier-motes';
    this.motes.renderOrder = 12;
    this.motes.frustumCulled = false;
    content.add(this.motes);

    this.group.add(content);
    this.updateMotes(0, 1);
  }

  private applyPalette(theme: MageBarrierTheme): void {
    const palette = PALETTES[theme];
    this.shellMaterial.color.setHex(palette.shell);
    this.runeMaterial.color.setHex(palette.rune);
    this.moteMaterial.color.setHex(palette.mote);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.motes.dispose();
    this.shellMaterial.dispose();
    this.runeMaterial.dispose();
    this.moteMaterial.dispose();
  }

  private updateMotes(dt: number, strength: number): void {
    this.elapsed += Math.max(0, dt);
    for (let i = 0; i < MOTE_COUNT; i++) {
      const phase = (i / MOTE_COUNT + this.elapsed * (0.14 + (i % 3) * 0.015)) % 1;
      const angle = i * 2.39996 + this.elapsed * (0.34 + (i % 2) * 0.08);
      const radius = 0.79 + Math.sin(i * 1.7 + this.elapsed * 1.4) * 0.08;
      this.moteDummy.position.set(
        Math.cos(angle) * radius,
        0.22 + phase * 1.66,
        Math.sin(angle) * radius,
      );
      const pulse = (0.58 + Math.sin(this.elapsed * 5 + i * 1.3) * 0.18) * (0.72 + strength * 0.28);
      this.moteDummy.scale.setScalar(Math.max(0.18, pulse));
      this.moteDummy.rotation.set(angle * 0.4, angle, phase * Math.PI);
      this.moteDummy.updateMatrix();
      this.motes.setMatrixAt(i, this.moteDummy.matrix);
    }
    this.motes.instanceMatrix.needsUpdate = true;
  }

  update(state: MageBarrierState | null, dt: number): void {
    this.activatedThisFrame = false;
    this.brokeThisFrame = false;
    const delta = Math.max(0, dt);

    if (state) {
      const themeChanged = state.theme !== this.theme;
      if (themeChanged) {
        this.theme = state.theme;
        this.applyPalette(state.theme);
      }
      const refreshed =
        this.active &&
        (themeChanged ||
          (state.remaining !== undefined &&
            this.lastRemaining !== null &&
            state.remaining > this.lastRemaining + 0.25));
      if (!this.active || refreshed) {
        this.active = true;
        this.breaking = false;
        this.reveal = 0;
        this.peakValue = Math.max(1, state.value);
        this.group.visible = true;
        this.activatedThisFrame = true;
      }
      this.peakValue = Math.max(this.peakValue, state.value);
      this.reveal = Math.min(1, this.reveal + delta / REVEAL_SECONDS);
      const revealScale = 0.62 + easeOutCubic(this.reveal) * 0.38;
      this.group.scale.setScalar(revealScale);

      const strength = clamp01(state.value / this.peakValue);
      this.shellMaterial.opacity = 0.11 + strength * 0.16;
      this.runeMaterial.opacity = 0.28 + strength * 0.46;
      this.moteMaterial.opacity = 0.3 + strength * 0.55;
      this.runeBands.rotation.y += delta * (0.42 + strength * 0.3);
      this.updateMotes(delta, strength);
      if (state.remaining !== undefined) this.lastRemaining = state.remaining;
      return;
    }

    if (this.active) {
      this.active = false;
      this.breaking = true;
      this.breakElapsed = 0;
      this.lastRemaining = null;
      this.brokeThisFrame = true;
    }
    if (!this.breaking) {
      this.group.visible = false;
      return;
    }

    this.breakElapsed = Math.min(BREAK_SECONDS, this.breakElapsed + delta);
    const progress = clamp01(this.breakElapsed / BREAK_SECONDS);
    const breakScale = 1 + easeOutCubic(progress) * 0.32;
    this.group.scale.setScalar(breakScale);
    const fade = 1 - progress;
    this.shellMaterial.opacity = 0.27 * fade;
    this.runeMaterial.opacity = 0.74 * fade;
    this.moteMaterial.opacity = 0.85 * fade;
    this.runeBands.rotation.y += delta * 2.4;
    this.updateMotes(delta * 2.2, fade);
    if (progress >= 1) {
      this.breaking = false;
      this.group.visible = false;
    }
  }
}

/** Lazy renderer seam: one reusable visual per entity that ever gains a mage barrier. */
export function syncMageBarrierVisual(
  visual: MageBarrierVisual | null,
  parent: THREE.Group,
  characterHeight: number,
  state: MageBarrierState | null,
  dt: number,
): MageBarrierVisual | null {
  let current = visual;
  if (state && !current) {
    current = new MageBarrierVisual(characterHeight, state.theme);
    parent.add(current.group);
  }
  current?.update(state, dt);
  return current;
}
