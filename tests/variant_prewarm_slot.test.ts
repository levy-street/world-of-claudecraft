import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildImpactSitePrewarmGroup } from '../src/render/impact_site';
import {
  createPrewarmGroupSlot,
  createVariantPrewarmSlot,
} from '../src/render/variant_prewarm_slot';

function host() {
  const scene = new THREE.Scene();
  const compiled: THREE.Group[] = [];
  return {
    scene,
    compiled,
    api: {
      scene,
      compileColorPrograms: async (group: THREE.Group) => {
        compiled.push(group);
      },
    },
  };
}

describe('createVariantPrewarmSlot', () => {
  it('stages the built group under the scene, tagged prewarm, and reports it', () => {
    const h = host();
    const twin = new THREE.Group();
    twin.add(new THREE.Mesh());
    const build = vi.fn(() => twin);
    const slot = createVariantPrewarmSlot(h.api, 'ghost-fade-variants', build);
    expect(slot.group).toBeNull();
    expect(slot.staged()).toEqual(['ghost-fade-variants', null]);
    expect(slot.detail()).toBe('objects=0');
    slot.run();
    expect(build).toHaveBeenCalledWith(h.scene);
    expect(slot.group).toBe(twin);
    expect(twin.parent).toBe(h.scene);
    expect(twin.userData.renderCategory).toBe('prewarm');
    expect(slot.staged()).toEqual(['ghost-fade-variants', twin]);
    expect(slot.detail()).toBe('objects=1');
  });

  it('exposes two resume units, stage then compile, sharing the builder', async () => {
    const h = host();
    const twin = new THREE.Group();
    const slot = createVariantPrewarmSlot(h.api, 'character-effect-variants', () => twin);
    const units = slot.resumeUnits();
    expect(units.map((u) => u.id)).toEqual([
      'character-effect-variants:group',
      'character-effect-variants:compile',
    ]);
    // The link unit REPORTS a missing artifact rather than passing quietly:
    // the resume ledger records a failed unit, and a silent success there is
    // how a slot whose re-stage threw was booked as warmed.
    await expect(units[1].run()).rejects.toThrow('character-effect-variants');
    expect(h.compiled).toEqual([]);
    await units[0].run();
    await units[1].run();
    expect(h.compiled).toEqual([twin]);
    expect(twin.parent).toBe(h.scene);
  });

  it('hides at entry and removes without disposing at cleanup', () => {
    const h = host();
    const twin = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    const dispose = vi.spyOn(material, 'dispose');
    twin.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
    const slot = createVariantPrewarmSlot(h.api, 'ghost-fade-variants', () => twin);
    slot.hide();
    slot.run();
    slot.hide();
    expect(twin.visible).toBe(false);
    slot.cleanup();
    expect(twin.parent).toBeNull();
    expect(dispose).not.toHaveBeenCalled();
    expect(slot.group).toBeNull();
    expect(slot.staged()).toEqual(['ghost-fade-variants', null]);
    slot.cleanup();
  });
});

describe('createPrewarmGroupSlot', () => {
  it('links through a custom link step instead of the group compile', async () => {
    const h = host();
    const linked: THREE.Group[] = [];
    const twin = new THREE.Group();
    const slot = createPrewarmGroupSlot(h.api, 'custom-link', {
      stage: () => twin,
      link: async (artifact) => {
        linked.push(artifact);
      },
    });
    const units = slot.resumeUnits();
    await units[0].run();
    await units[1].run();
    expect(linked).toEqual([twin]);
    expect(h.compiled).toEqual([]);
  });

  it('runs the per-piece units after the stage, in order, on the staged artifact', async () => {
    const h = host();
    const textures = [new THREE.Texture(), new THREE.Texture()];
    const uploaded: THREE.Texture[] = [];
    const slot = createPrewarmGroupSlot(h.api, 'weather.materials', {
      stage: () => textures as readonly THREE.Texture[],
      units: (staged) =>
        staged.map((texture, index) => ({
          id: `weather-materials:${index}`,
          run: () => {
            uploaded.push(texture);
          },
        })),
    });
    const units = slot.resumeUnits();
    expect(units.map((unit) => unit.id)).toEqual([
      'weather.materials:stage',
      'weather.materials:units',
    ]);
    // The pieces never run against an unstaged artifact, and say so.
    await expect(units[1].run()).rejects.toThrow('weather.materials');
    expect(uploaded).toEqual([]);
    await units[0].run();
    await units[1].run();
    expect(uploaded).toEqual(textures);
    // No group: nothing was attached to the scene, and none is reported.
    expect(slot.group).toBeNull();
    expect(slot.artifact).toBe(textures);
    expect(h.scene.children).toEqual([]);
  });

  it('runs the per-piece work inline at the manifest entry, staged VISIBLE', async () => {
    // The boot pass draws behind the loading screen, so the entry stages the
    // artifact as it stands and does its own piece work; only a resume hides.
    const h = host();
    const events: string[] = [];
    const slot = createPrewarmGroupSlot(h.api, 'weather.materials', {
      stage: () => {
        events.push('stage');
        return ['flake', 'streak'];
      },
      hide: () => void events.push('hide'),
      units: (maps) => maps.map((map) => ({ id: map, run: () => void events.push(map) })),
    });
    await slot.run();
    expect(events).toEqual(['stage', 'flake', 'streak']);
  });

  it('hides a group-less artifact through the custom hide, before its pieces run', async () => {
    const h = host();
    const events: string[] = [];
    const slot = createPrewarmGroupSlot(h.api, 'weather.materials', {
      stage: () => {
        events.push('stage');
        return { live: true };
      },
      hide: (artifact) => {
        artifact.live = false;
        events.push('hide');
      },
      units: () => [{ id: 'weather-materials:0', run: () => void events.push('upload') }],
      cleanup: () => void events.push('end'),
    });
    const units = slot.resumeUnits();
    await units[0].run();
    // Staged and hidden inside ONE unit: no frame can land between them.
    expect(events).toEqual(['stage', 'hide']);
    expect(slot.artifact).toEqual({ live: false });
    await units[1].run();
    slot.cleanup();
    // No group to detach: the custom hide is the only thing that can take a
    // group-less artifact out of the frame, so cleanup runs it too.
    expect(events).toEqual(['stage', 'hide', 'upload', 'hide', 'end']);
    expect(slot.artifact).toBeNull();
    slot.cleanup();
    expect(events).toEqual(['stage', 'hide', 'upload', 'hide', 'end']);
  });

  it('reports a throwing re-stage instead of warming nothing in silence', async () => {
    const h = host();
    let staged = 0;
    const slot = createPrewarmGroupSlot(h.api, 'landmarks.impact-site', {
      stage: () => {
        staged++;
        if (staged > 1) throw new Error('rebuild source gone');
        return new THREE.Group();
      },
    });
    slot.run();
    slot.cleanup();
    const units = slot.resumeUnits();
    // The stage unit throws synchronously; the resume lane catches per unit.
    expect(() => units[0].run()).toThrow('rebuild source gone');
    // The link unit must not book a success for an artifact that never landed.
    await expect(units[1].run()).rejects.toThrow('landmarks.impact-site');
    expect(h.compiled).toEqual([]);
  });

  it('re-stages after a cleanup, so a resume still reaches the artifact', async () => {
    const h = host();
    const built: THREE.Group[] = [];
    const slot = createPrewarmGroupSlot(h.api, 'landmarks.impact-site', {
      stage: () => {
        const group = new THREE.Group();
        built.push(group);
        return group;
      },
    });
    slot.run();
    slot.cleanup();
    expect(slot.artifact).toBeNull();
    const units = slot.resumeUnits();
    await units[0].run();
    await units[1].run();
    expect(built).toHaveLength(2);
    expect(slot.group).toBe(built[1]);
    expect(h.compiled).toEqual([built[1]]);
  });

  it('stages every resumed group HIDDEN, so no live frame draws it before it links', async () => {
    const h = host();
    // The real landmark artifact: a clone of the live impact site, translated
    // in front of the player. A resume runs while the world is live.
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    const visibleAtLink: boolean[] = [];
    const api = {
      scene: h.scene,
      compileColorPrograms: async (group: THREE.Group) => {
        visibleAtLink.push(group.visible);
        h.compiled.push(group);
      },
    };
    const slot = createVariantPrewarmSlot(api, 'landmarks.impact-site', () =>
      buildImpactSitePrewarmGroup(source, { x: 10, y: 2, z: 30 }),
    );
    // The boot path keeps the clone visible: it is drawn behind the loading
    // screen. Only the resume path stages it hidden.
    slot.run();
    expect(slot.group?.visible).toBe(true);
    slot.cleanup();

    const units = slot.resumeUnits();
    await units[0].run();
    const group = slot.group as THREE.Group;
    expect(group.parent).toBe(h.scene);
    expect(group.visible).toBe(false);
    expect(group.userData.renderCategory).toBe('prewarm');
    await units[1].run();
    expect(h.compiled).toEqual([group]);
    expect(visibleAtLink).toEqual([false]);
  });
});
