// @vitest-environment happy-dom
//
// The monument's projections and lantern light, under a DOM so the projected
// name actually rasterizes. This is the half the Node-environment town suites
// cannot reach: buildRealmBuilderMonumentFx returns an empty group without a
// document (a deliberate guard, asserted below), so without this file the
// hologram would ship with no coverage at all.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gfxInternalsForTest, sharedUniforms } from '../src/render/gfx';
import {
  buildRealmBuilderMonumentBody,
  buildRealmBuilderMonumentFx,
  buildRealmBuilderMonumentPickBody,
  MONUMENT_IMPOSTOR_URL,
  realmBuilderMonumentFxInternalsForTest,
  realmBuilderMonumentPreloadInternalsForTest,
} from '../src/render/realm_builder_monument_fx';
import {
  MONUMENT_EFFECTS_RANGE,
  MONUMENT_IMPOSTOR_RANGE,
  type MonumentPlacement,
} from '../src/render/realm_builder_monument_fx_core';
import { currentRealmBuilder } from '../src/sim/content/realm_builders';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';

const restores: Array<() => void> = [];

/**
 * happy-dom mints canvas elements but has no 2D rasterizer, so stand one in.
 * measureText returns a plausible advance width per character, which is all the
 * name texture's shrink-to-fit loop reads: the point here is the LAYOUT
 * decisions the painter makes, not the glyphs a real rasterizer would draw.
 */
function stubCanvas2d(): void {
  const proto = (globalThis as unknown as { HTMLCanvasElement: { prototype: HTMLCanvasElement } })
    .HTMLCanvasElement.prototype;
  const previous = Object.getOwnPropertyDescriptor(proto, 'getContext');
  Object.defineProperty(proto, 'getContext', {
    configurable: true,
    value(this: HTMLCanvasElement, kind: string): unknown {
      if (kind !== '2d') return null;
      let font = '700 160px serif';
      return {
        get font(): string {
          return font;
        },
        set font(value: string) {
          font = value;
        },
        textAlign: 'center',
        textBaseline: 'middle',
        fillStyle: '#ffffff',
        shadowColor: '',
        shadowBlur: 0,
        clearRect: () => undefined,
        fillText: () => undefined,
        measureText: (text: string) => {
          const size = Number.parseFloat(font.replace(/^\D*/, '')) || 160;
          return { width: text.length * size * 0.5 } as TextMetrics;
        },
      };
    },
  });
  restores.push(() => {
    if (previous) Object.defineProperty(proto, 'getContext', previous);
    else Reflect.deleteProperty(proto, 'getContext');
  });
}

beforeEach(() => {
  stubCanvas2d();
});

afterEach(() => {
  while (restores.length) restores.pop()?.();
});

function livePlacement(): MonumentPlacement {
  const monument = EASTBROOK_LAYOUT.civic.monument;
  return {
    x: monument.position.x,
    z: monument.position.z,
    groundY: 0,
    rotation: monument.rotation,
    nativeWidth: monument.nativeDimensions.width,
    nativeHeight: monument.nativeDimensions.height,
    nativeDepth: monument.nativeDimensions.depth,
  };
}

function useTier(effectsTier: 'low' | 'medium' | 'high'): void {
  restores.push(gfxInternalsForTest.overrideSettings({ effectsTier }));
}

function named(group: THREE.Object3D, suffix: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  group.traverse((child) => {
    if (child.name.endsWith(suffix) && child !== group) out.push(child);
  });
  return out;
}

describe('Realm Builder monument effects', () => {
  it('draws one name and one beam per honour plate, plus one halo sheet', () => {
    useTier('high');
    const fx = buildRealmBuilderMonumentFx(livePlacement());
    restores.push(() => fx.dispose());

    expect(named(fx.group, 'Name')).toHaveLength(2);
    expect(named(fx.group, 'Beam')).toHaveLength(2);
    // Four lanterns, ONE draw: the halos are four screen-aligned quads in a
    // single indexed mesh, not four sprites.
    const halos = named(fx.group, 'Halos');
    expect(halos).toHaveLength(1);
    const haloGeometry = (halos[0] as THREE.Mesh).geometry;
    expect(haloGeometry.getAttribute('position').count).toBe(16);
    expect(haloGeometry.getIndex()?.count).toBe(24);
    // Distinct phases, or all four lanterns flicker on the same beat.
    const phases = new Set<number>();
    const phaseAttribute = haloGeometry.getAttribute('aPhase');
    for (let index = 0; index < phaseAttribute.count; index++) {
      phases.add(Number(phaseAttribute.getX(index).toFixed(4)));
    }
    expect(phases.size).toBe(4);
  });

  it('aims each beam from its plate at the name it feeds', () => {
    useTier('high');
    const placement = livePlacement();
    const fx = buildRealmBuilderMonumentFx(placement);
    restores.push(() => fx.dispose());

    const beams = named(fx.group, 'Beam');
    const names = named(fx.group, 'Name');
    for (const beam of beams) {
      // The cylinder is built along +Y and swung onto the plate-to-panel axis,
      // so its own axis in world space must point at a panel, not straight up.
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(beam.quaternion);
      expect(axis.y).toBeGreaterThan(0.9);
      expect(Math.hypot(axis.x, axis.z)).toBeGreaterThan(0.2);
      const nearest = names
        .map((panel) => panel.position.distanceTo(beam.position))
        .sort((a, b) => a - b)[0];
      // Seated at the midpoint, so it reaches its panel from half its length,
      // which scales with the statue like every other hologram figure.
      expect(nearest).toBeLessThan(EASTBROOK_LAYOUT.civic.monument.height * 0.2);
    }
    // Opposite sides of the plinth: a player circling always meets one.
    expect(names[0].position.distanceTo(names[1].position)).toBeGreaterThan(
      EASTBROOK_LAYOUT.civic.monument.radius,
    );
  });

  it('sheds embers on the static effects tier, never on the frame rate', () => {
    useTier('low');
    const low = buildRealmBuilderMonumentFx(livePlacement());
    restores.push(() => low.dispose());
    expect(named(low.group, 'Embers')).toHaveLength(0);
    // The light itself stays: a tier knob shaves richness, it does not put out
    // the lanterns.
    expect(named(low.group, 'Halos')).toHaveLength(1);
    expect(named(low.group, 'Name')).toHaveLength(2);

    // Pop back to the canvas stub only: draining every restore would take the
    // 2D context down with the tier override.
    low.dispose();
    restores.pop();
    restores.pop()?.();
    useTier('medium');
    const medium = buildRealmBuilderMonumentFx(livePlacement());
    restores.push(() => medium.dispose());
    const embers = named(medium.group, 'Embers');
    expect(embers).toHaveLength(1);
    expect(embers[0]).toBeInstanceOf(THREE.Points);
    // Nine motes per lantern, seeded across all four so no two share a phase.
    expect((embers[0] as THREE.Points).geometry.getAttribute('position').count).toBe(36);
  });

  it('rides the shared clock and updates by writing one uniform', () => {
    useTier('high');
    const fx = buildRealmBuilderMonumentFx(livePlacement());
    restores.push(() => fx.dispose());

    const materials: THREE.ShaderMaterial[] = [];
    fx.group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
        materials.push(child.material as THREE.ShaderMaterial);
      }
    });
    expect(materials.length).toBeGreaterThan(0);
    for (const material of materials) {
      // One clock for the whole renderer: a private time uniform would drift
      // against every other shader in the scene.
      expect(material.uniforms.uTime).toBe(sharedUniforms.uTime);
      expect(material.uniforms.uReducedMotion.value).toBe(0);
      // Additive light must never write depth or occlude what is behind it.
      expect(material.depthWrite).toBe(false);
      expect(material.blending).toBe(THREE.AdditiveBlending);
    }

    // A name panel is front-facing only: double-siding it renders the front
    // plate's text mirrored from behind, crossing the back plate's own text as
    // you walk around the plinth. The beam is the opposite case, an open cone
    // you see the inside of.
    for (const panel of named(fx.group, 'Name')) {
      expect(((panel as THREE.Mesh).material as THREE.Material).side).toBe(THREE.FrontSide);
    }
    for (const beam of named(fx.group, 'Beam')) {
      expect(((beam as THREE.Mesh).material as THREE.Material).side).toBe(THREE.DoubleSide);
    }

    const reducedMotionUniforms = materials.map((material) => material.uniforms.uReducedMotion);
    fx.update(true);
    for (const uniform of reducedMotionUniforms) expect(uniform.value).toBe(1);
    fx.update(false);
    for (const uniform of reducedMotionUniforms) expect(uniform.value).toBe(0);
    // Identity is stable: update() must not re-create uniform objects, or the
    // already-compiled programs stop seeing the writes.
    fx.update(true);
    for (const [index, material] of materials.entries()) {
      expect(material.uniforms.uReducedMotion).toBe(reducedMotionUniforms[index]);
    }
    expect(fx.update.toString()).not.toMatch(/\bnew\s+/);
  });

  it('rasterizes the honouree name and shrinks a long one to fit', () => {
    const short = realbuilderTexture('Wren');
    const long = realbuilderTexture('Bartholomew Quillingsworth-Featherstonehaugh III');
    // Same canvas either way: the fit loop drops the font size, never the box,
    // so a long name stays inside the panel instead of clipping at its edge.
    expect(short.image.width).toBe(long.image.width);
    expect(short.image.height).toBe(long.image.height);
    expect(short.colorSpace).toBe(THREE.SRGBColorSpace);
    // Mipmaps: the panel is read from across a square as often as up close.
    expect(short.generateMipmaps).toBe(true);
    short.dispose();
    long.dispose();
  });

  it('returns an inert group without a document instead of throwing at world build', () => {
    useTier('high');
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'document');
    restores.push(() => {
      if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    });

    const fx = buildRealmBuilderMonumentFx(livePlacement());
    expect(fx.group.children).toEqual([]);
    expect(() => fx.update(true)).not.toThrow();
    expect(() => fx.dispose()).not.toThrow();
  });

  it('projects the live honouree by default', () => {
    useTier('high');
    const fx = buildRealmBuilderMonumentFx(livePlacement());
    restores.push(() => fx.dispose());
    // The default argument is the roll itself, so announcing a new honouree in
    // content/realm_builders.ts is the whole change.
    expect(currentRealmBuilder().name.length).toBeGreaterThan(0);
    expect(named(fx.group, 'Name')).toHaveLength(2);
  });
});

describe('Realm Builder monument pick volume', () => {
  it('is an invisible cylinder on the collider, so the click costs no draw', () => {
    const monument = EASTBROOK_LAYOUT.civic.monument;
    const built = buildRealmBuilderMonumentPickBody();
    expect(built.height).toBe(monument.height);

    const meshes: THREE.Mesh[] = [];
    built.group.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });
    expect(meshes).toHaveLength(1);
    const proxy = meshes[0];
    // Invisible, not transparent: three's raycaster ignores `visible`, so this
    // takes the click while contributing nothing to the frame. It must also
    // stay out of the shadow pass, or an invisible cylinder casts a very
    // visible shadow across the square.
    expect(proxy.visible).toBe(false);
    expect(proxy.castShadow).toBe(false);
    expect(proxy.receiveShadow).toBe(false);

    proxy.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(proxy, true);
    // Spans the whole statue from the ground up, and matches the collider a
    // player is already stopped by: everything you can walk into, you can click.
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(monument.height, 5);
    expect(box.max.x).toBeCloseTo(monument.radius, 5);
    expect(box.max.z).toBeCloseTo(monument.radius, 5);
  });

  it('is what renderer.ts routes the monument to, ahead of the generic loot arm', () => {
    const source = readFileSync(path.join(__dirname, '..', 'src/render/renderer.ts'), 'utf8');
    // The LITERAL, like the noticeboard arm beside it: importing the constant
    // pushed this condition past 80 columns, and the wrap broke both this scan
    // and the file's monolith ceiling. realm_builder_monument.test.ts pins the
    // literal to REALM_BUILDER_MONUMENT_TEMPLATE_ID so they cannot drift.
    const monumentArm = source.indexOf(
      "e.kind === 'object' && e.templateId === 'realm_builder_monument'",
    );
    const genericArm = source.indexOf("} else if (e.kind === 'object') {");
    expect(monumentArm).toBeGreaterThan(-1);
    expect(genericArm).toBeGreaterThan(-1);
    // Order is the whole point: the generic arm matches every object, so a
    // monument arm placed after it never runs and the statue goes back to
    // standing a quest-pickup prop and a loot sparkle inside its own plinth.
    expect(monumentArm).toBeLessThan(genericArm);
    expect(source).toContain('buildRealmBuilderMonumentPickBody()');
  });
});

describe('Realm Builder monument distance LOD', () => {
  /** The sculpt stands in as three named meshes, exactly as the GLB ships. */
  function fakeSource(): THREE.Object3D {
    const root = new THREE.Group();
    for (const name of ['MonumentSurface', 'MonumentTools', 'MonumentFlame']) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshStandardMaterial({ name }),
      );
      mesh.name = `RB_${name}`;
      root.add(mesh);
    }
    return root;
  }

  function meshNamed(root: THREE.Object3D, suffix: string): THREE.Object3D | undefined {
    let found: THREE.Object3D | undefined;
    root.traverse((child) => {
      if (!found && child.name.endsWith(suffix) && child !== root) found = child;
    });
    return found;
  }

  it('breathes gold over the tools without touching their albedo', () => {
    useTier('high');
    const body = buildRealmBuilderMonumentBody(fakeSource(), livePlacement());

    const decorated: THREE.Material[] = [];
    body.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.Material;
      if (material.userData.realmBuilderToolPulse) decorated.push(material);
    });
    // ONLY the tools: a pulse on the surface material would light the whole
    // statue, which is the flat-yellow failure this replaced.
    expect(decorated).toHaveLength(1);
    expect(decorated[0].name).toBe('MonumentTools');
    expect(decorated[0].customProgramCacheKey()).toContain('realm-builder-tool-pulse-v1');

    // The pulse ADDS to emissive radiance; it must not have taken the albedo
    // away to do it.
    const tools = meshNamed(body.group, 'MonumentTools') as THREE.Mesh;
    expect((tools.material as THREE.MeshStandardMaterial).map).toBeDefined();
  });

  it('keeps the flame cores out of the shadow pass and everything else in it', () => {
    useTier('high');
    const body = buildRealmBuilderMonumentBody(fakeSource(), livePlacement());
    const flame = meshNamed(body.group, 'MonumentFlame') as THREE.Mesh;
    const surface = meshNamed(body.group, 'MonumentSurface') as THREE.Mesh;
    // A lit ember casting a hard shadow across the plinth is the tell that
    // gives a fake glow away.
    expect(flame.castShadow).toBe(false);
    expect(surface.castShadow).toBe(true);
  });

  it('sparkles off the tools on medium, and not at all on low', () => {
    useTier('low');
    const low = buildRealmBuilderMonumentBody(fakeSource(), livePlacement());
    expect(meshNamed(low.group, 'Sparkle')).toBeUndefined();

    restores.pop()?.();
    useTier('high');
    const high = buildRealmBuilderMonumentBody(fakeSource(), livePlacement());
    const sparkle = meshNamed(high.group, 'Sparkle') as THREE.Points;
    expect(sparkle).toBeInstanceOf(THREE.Points);
    // Sampled from the tool's own vertices, so the glints sit ON it rather
    // than in a cloud near it. One tool mesh in the stand-in, 22 glints.
    expect(sparkle.geometry.getAttribute('position').count).toBe(22);
    expect(sparkle.geometry.getAttribute('aSeed').count).toBe(22);
  });

  it('swaps the statue for its billboard, and drops the glow before that', () => {
    useTier('high');
    const texture = new THREE.Texture();
    restores.push(realmBuilderMonumentPreloadInternalsForTest.setImpostorTexture(texture));
    const placement = livePlacement();
    const body = buildRealmBuilderMonumentBody(fakeSource(), placement);
    const fx = buildRealmBuilderMonumentFx(placement);
    restores.push(() => fx.dispose());
    const impostor = meshNamed(body.group, 'Impostor') as THREE.Mesh;
    const sparkle = meshNamed(body.group, 'Sparkle') as THREE.Points;
    const statue = body.group.children.find((child) => child !== impostor && child !== sparkle);
    expect(impostor).toBeInstanceOf(THREE.Mesh);
    expect(statue).toBeDefined();

    const at = (distance: number) => {
      body.setLod(distance, placement.x, placement.z + distance);
      fx.update(false, distance);
      return {
        statue: statue?.visible,
        impostor: impostor.visible,
        sparkle: sparkle.visible,
        effects: fx.group.visible,
      };
    };

    expect(at(0)).toEqual({ statue: true, impostor: false, sparkle: true, effects: true });
    // Effects go first and the statue stays: the two never change on one frame.
    expect(at(MONUMENT_EFFECTS_RANGE)).toEqual({
      statue: true,
      impostor: false,
      sparkle: false,
      effects: false,
    });
    expect(at(MONUMENT_IMPOSTOR_RANGE)).toEqual({
      statue: false,
      impostor: true,
      sparkle: false,
      effects: false,
    });
    // And it comes back on the way in, rather than latching off.
    expect(at(0)).toEqual({ statue: true, impostor: false, sparkle: true, effects: true });
  });

  it('turns the billboard to the camera and only rewrites the cell when it changes', () => {
    useTier('high');
    restores.push(
      realmBuilderMonumentPreloadInternalsForTest.setImpostorTexture(new THREE.Texture()),
    );
    const placement = livePlacement();
    const body = buildRealmBuilderMonumentBody(fakeSource(), placement);
    const impostor = meshNamed(body.group, 'Impostor') as THREE.Mesh;
    const cell = (impostor.material as THREE.ShaderMaterial).uniforms.uCell;
    const identity = cell.value;

    const seen = new Set<string>();
    for (let index = 0; index < 8; index++) {
      const bearing = placement.rotation + (index * Math.PI) / 4;
      body.setLod(
        MONUMENT_IMPOSTOR_RANGE + 10,
        placement.x + Math.sin(bearing) * 90,
        placement.z + Math.cos(bearing) * 90,
      );
      seen.add(`${cell.value.x},${cell.value.y}`);
      // The uniform's Vector2 is written in place: replacing it would leave the
      // already-compiled program pointing at the old object.
      expect(cell.value).toBe(identity);
    }
    // A walk right round the plinth uses every baked view exactly once.
    expect(seen.size).toBe(8);

    // The billboard stands on the ground where the statue did, not floating.
    expect(impostor.position.x).toBeCloseTo(placement.x, 9);
    expect(impostor.position.z).toBeCloseTo(placement.z, 9);
    expect(impostor.position.y).toBeCloseTo(placement.groundY, 9);
    // And it never casts: a billboard's shadow is a rectangle.
    expect(impostor.castShadow).toBe(false);
  });

  it('fogs and tone-maps the billboard like the solid it stands in for', () => {
    useTier('high');
    restores.push(
      realmBuilderMonumentPreloadInternalsForTest.setImpostorTexture(new THREE.Texture()),
    );
    const body = buildRealmBuilderMonumentBody(fakeSource(), livePlacement());
    const impostor = meshNamed(body.group, 'Impostor') as THREE.Mesh;
    const material = impostor.material as THREE.ShaderMaterial;
    // A ShaderMaterial gets scene fog only when it asks, and only through the
    // fog uniforms; without both, the card stands un-fogged at the fog wall
    // while every building around it fades (foliage_impostor.ts fogs too).
    expect(material.fog).toBe(true);
    expect(material.uniforms.fogColor).toBeDefined();
    expect(material.uniforms.fogNear).toBeDefined();
    expect(material.uniforms.fogFar).toBeDefined();
    expect(material.vertexShader).toContain('#include <fog_pars_vertex>');
    expect(material.vertexShader).toContain('#include <fog_vertex>');
    // The tail MeshStandardMaterial ends with, in its order: tone-map,
    // then colourspace, then fog. Skipping any of them colour-shifts the
    // billboard against the body on the frame the two swap.
    const fragment = material.fragmentShader;
    const tone = fragment.indexOf('#include <tonemapping_fragment>');
    const colour = fragment.indexOf('#include <colorspace_fragment>');
    const fog = fragment.indexOf('#include <fog_fragment>');
    expect(tone).toBeGreaterThan(fragment.indexOf('gl_FragColor ='));
    expect(colour).toBeGreaterThan(tone);
    expect(fog).toBeGreaterThan(colour);
    // And the caller's cell offset is still the caller's own object.
    expect(material.uniforms.uCell.value).toBeInstanceOf(THREE.Vector2);
  });

  it('never swaps at all when the atlas has not loaded', () => {
    useTier('high');
    restores.push(realmBuilderMonumentPreloadInternalsForTest.setImpostorTexture(null));
    const placement = livePlacement();
    const body = buildRealmBuilderMonumentBody(fakeSource(), placement);
    expect(meshNamed(body.group, 'Impostor')).toBeUndefined();
    // Failing safe means KEEPING the real statue at every distance, not
    // hiding it with nothing in its place: drawing a prop you meant to
    // cheapen beats deleting the town's centrepiece.
    const statue = body.group.children[0];
    expect(() => body.setLod(10_000, 0, 0)).not.toThrow();
    expect(statue.visible).toBe(true);
    body.setLod(0, placement.x, placement.z);
    expect(statue.visible).toBe(true);
  });

  it('names the atlas it preloads', () => {
    expect(realmBuilderMonumentPreloadInternalsForTest.impostorUrl).toBe(MONUMENT_IMPOSTOR_URL);
    expect(MONUMENT_IMPOSTOR_URL.startsWith('/textures/')).toBe(true);
  });
});

function realbuilderTexture(name: string): THREE.CanvasTexture {
  return realmBuilderMonumentFxInternalsForTest.nameTexture(name);
}
