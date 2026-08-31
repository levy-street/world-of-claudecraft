// The pass module driven for real against a fake host. Its siblings pin source
// text; this one EXECUTES it, because the questions that matter (does a second
// attach rebuild the catalog, does a body warm twice, do six bodies serialize,
// does a shutdown stop the work) cannot be read off the source.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSoulRendLook } from '../src/render/interior_encounter_prewarm';
import {
  queueLiveSoulRendPrewarm,
  setEncounterPrewarmInterior,
  startInteriorEncounterPrewarm,
} from '../src/render/interior_encounter_prewarm_pass';

type Slot = { source: THREE.Mesh; overlay: THREE.Material };

function fakeVisual(
  name: string,
  slots = 2,
  timeline: string[] = [],
  overlayMap: THREE.Texture | null = null,
) {
  const calls = { prewarmSoulRendSlots: 0 };
  return {
    name,
    calls,
    prewarmSoulRendSlots(): Slot[] {
      calls.prewarmSoulRendSlots++;
      timeline.push(`slots:${name}`);
      return Array.from({ length: slots }, () => {
        const overlay = new THREE.MeshBasicMaterial({ map: overlayMap });
        overlay.name = name;
        return {
          source: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()),
          overlay,
        };
      });
    },
  };
}

const look = (over: Partial<LiveSoulRendLook> = {}): LiveSoulRendLook => ({
  weaponSkinId: null,
  mainhandItemId: null,
  offhandItemId: null,
  ...over,
});

function fakeHost(
  views: Array<{ id: number; kind: string; visual: unknown }> = [],
  timeline: string[] = [],
) {
  const compiled: string[] = [];
  const uploaded: THREE.Texture[] = [];
  const host = {
    shutdownStarted: false,
    views: new Map(views.map((v) => [v.id, { visual: v.visual, ...look() }])),
    sim: {
      entities: { get: (id: number) => views.find((v) => v.id === id) },
      player: { pos: { x: 103_300, y: 4, z: -1246 } },
    },
    scene: new THREE.Scene(),
    // The shared runBackgroundPrewarm only COMPILES when parallel shader
    // compile exists; without it, it deliberately leaves the debt lazy. The
    // machine this prewarm was measured on has it, so that is the path to drive.
    asyncCompileSupported: true,
    backgroundGpuWork: {
      // Yields before running, like real GPU work does: without this the whole
      // pass completes inside one microtask turn and a serialization test could
      // not tell a chained queue from three parallel ones.
      run: async <T>(work: () => T | Promise<T>) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return work();
      },
    },
    webgl: { initTexture: (texture: THREE.Texture) => uploaded.push(texture) },
    prewarmEntity: () => ({ kind: 'player', templateId: 'warrior' }),
    compilePrewarmColorPrograms: async (root: THREE.Object3D) => {
      // Name the BODY this batch belongs to, read off the overlay material the
      // fake visual stamped, so the order of whole per-body passes is visible.
      const first = root.children[0] as THREE.Mesh | undefined;
      const material = Array.isArray(first?.material) ? first?.material[0] : first?.material;
      const label = material?.name ? `compile:${material.name}` : root.name || root.type;
      compiled.push(label);
      timeline.push(label);
    },
    compileShadowPrograms: async () => {},
    renderBoundedPrewarmRoot: () => {},
    compiled,
    uploaded,
  };
  return host;
}

// The pass drains through requestIdleCallback; drive it by hand so a test never
// waits on a real idle period.
function installImmediateIdle(): () => void {
  const win = globalThis as unknown as {
    requestIdleCallback?: (cb: (deadline: unknown) => void) => number;
  };
  const had = 'requestIdleCallback' in win;
  const previous = win.requestIdleCallback;
  win.requestIdleCallback = (cb: (deadline: unknown) => void) => {
    setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 5 }), 0);
    return 1;
  };
  return () => {
    if (had) win.requestIdleCallback = previous;
    else win.requestIdleCallback = undefined;
  };
}

const drain = async (): Promise<void> => {
  for (let i = 0; i < 200; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('interior encounter prewarm host contract', () => {
  it('names only members the renderer actually declares', () => {
    // The pass reaches its host through a cast, because most of what it needs is
    // private on the Renderer and no typed parameter could accept it. That cast
    // is load-bearing: a rename in renderer.ts would compile clean and break the
    // feature at runtime. This is the check that cannot exist in the type system.
    const host = readFileSync(
      new URL('../src/render/interior_encounter_prewarm_host.ts', import.meta.url),
      'utf8',
    );
    const body = host.slice(host.indexOf('export interface InteriorEncounterPrewarmHost {'));
    const members = [...body.matchAll(/^ {2}(\w+)[?:(<]/gm)].map((match) => match[1]);
    expect(members.length).toBeGreaterThanOrEqual(10);
    expect(members).toContain('compilePrewarmColorPrograms');
    expect(members).toContain('renderBoundedPrewarmRoot');

    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const missing = members.filter(
      (member) =>
        !new RegExp(
          // A field, a method, or a constructor-parameter property (`sim`).
          `^ {2,4}(?:private |public |protected |readonly )*(?:async )?${member}\\b`,
          'm',
        ).test(renderer),
    );
    expect(missing, `renderer.ts declares no such member: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('interior encounter prewarm pass (driven)', () => {
  let restoreIdle: () => void;

  beforeEach(() => {
    restoreIdle = installImmediateIdle();
  });
  afterEach(() => {
    restoreIdle();
    vi.restoreAllMocks();
  });

  it('records the attached interior itself, before its host would report one', async () => {
    // The host reports the interior from a later pass of its own frame, so a
    // body created on the attach frame would find none and never warm.
    const player = fakeVisual('player');
    const host = fakeHost([{ id: 1, kind: 'player', visual: player }]);
    startInteriorEncounterPrewarm('nythraxis', host);
    await drain();
    // Queued with no interior argument: it can only have found one because the
    // attach recorded it.
    queueLiveSoulRendPrewarm(host, player as never, look({ weaponSkinId: 'ice_fang' }), 'player');
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBeGreaterThan(0);
  });

  it('uploads the textures bound on the staged overlays before their bounded render', async () => {
    // The pass reads the staged proxies' map slots through the shared
    // material_texture_slots walk (not through the renderer host any more):
    // an overlay's map must reach webgl.initTexture, and nothing else does.
    const map = new THREE.Texture();
    const player = fakeVisual('player', 2, [], map);
    const host = fakeHost([{ id: 1, kind: 'player', visual: player }]);
    startInteriorEncounterPrewarm('nythraxis', host);
    await drain();
    queueLiveSoulRendPrewarm(host, player as never, look({ weaponSkinId: 'ice_fang' }), 'player');
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBeGreaterThan(0);
    expect(host.uploaded.length).toBeGreaterThan(0);
    expect(new Set(host.uploaded)).toEqual(new Set([map]));
  });

  it('stops warming live bodies once the host reports leaving the interior', async () => {
    const player = fakeVisual('player');
    const host = fakeHost([{ id: 1, kind: 'player', visual: player }]);
    setEncounterPrewarmInterior(host, 'nythraxis');
    setEncounterPrewarmInterior(host, null);
    queueLiveSoulRendPrewarm(host, player as never, look(), 'player');
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBe(0);
  });

  it('warms an interior once, however many times it attaches', async () => {
    const host = fakeHost();
    startInteriorEncounterPrewarm('nythraxis', host);
    await drain();
    const afterFirst = host.compiled.length;
    startInteriorEncounterPrewarm('nythraxis', host);
    await drain();
    expect(host.compiled.length).toBe(afterFirst);
  });

  it('compiles and retains Varkhul, pillars, Tempering Ray, portals, and the Assembly', async () => {
    const host = fakeHost();
    startInteriorEncounterPrewarm('ignivar_depths', host);
    await drain();
    expect(host.compiled).toContain('varkhul-encounter-prewarm-entity');
    expect(host.compiled).toContain('varkhul-assembly-prewarm');
    expect(host.compiled).toContain('varkhul-forge-beam-prewarm');
    expect(host.compiled).toContain('varkhul-tempering-ray-prewarm');
    expect(host.compiled).toContain('varkhul-forge-portal-prewarm');
    expect(host.compiled).toContain('varkhul-worldfire-prewarm');

    const afterFirst = host.compiled.length;
    startInteriorEncounterPrewarm('ignivar_depths', host);
    await drain();
    expect(host.compiled).toHaveLength(afterFirst);
  });

  it('compiles and retains the Ignivar mechanic visuals beside the Varkhul set', async () => {
    // These are otherwise built lazily during per-frame encounter sync, after
    // the view compile-gate enumeration, so first mechanic onset would link
    // their programs (the unique Judgment charred-ground shader included) in a
    // live frame. Each staged unit compiles as its own child of the pass group.
    const host = fakeHost();
    startInteriorEncounterPrewarm('ignivar_depths', host);
    await drain();
    expect(host.compiled).toContain('ignivar-encounter-prewarm-entity');
    expect(host.compiled).toContain('ignivar-rotating-rays-prewarm');
    expect(host.compiled).toContain('ignivar-forge-judgment-prewarm');

    // A second attach of the same interior rebuilds and recompiles nothing.
    const afterFirst = host.compiled.length;
    startInteriorEncounterPrewarm('ignivar_depths', host);
    await drain();
    expect(host.compiled).toHaveLength(afterFirst);
  });

  it('retries an interior whose first prewarm pass failed', async () => {
    // The interior key is claimed BEFORE the work runs, so without the failure
    // arm giving it back a pass that rejected (a compile that threw, a queue
    // rejection during a graphics rebuild) left the catalog cold for the whole
    // session and it linked at first draw instead. The injected throw stands in
    // for any of those: it fails the first pass and only the first.
    const host = fakeHost();
    let built = 0;
    host.prewarmEntity = () => {
      built++;
      return { kind: 'player', templateId: 'warrior' };
    };
    const pos = host.sim.player.pos;
    let failNext = true;
    Object.defineProperty(host.sim.player, 'pos', {
      get() {
        if (!failNext) return pos;
        failNext = false;
        throw new Error('prewarm pass failed');
      },
    });

    startInteriorEncounterPrewarm('nythraxis', host);
    await drain();
    expect(built).toBe(0);

    // The same interior attaches again and the catalog build runs this time.
    startInteriorEncounterPrewarm('nythraxis', host);
    await drain();
    expect(built).toBeGreaterThan(0);

    // ... and a pass that SUCCEEDED still claims the interior: no third build.
    const afterRetry = built;
    startInteriorEncounterPrewarm('nythraxis', host);
    await drain();
    expect(built).toBe(afterRetry);
  });

  it('retries a live body whose warm pass failed, for the same look', async () => {
    const player = fakeVisual('player');
    const host = fakeHost([{ id: 1, kind: 'player', visual: player }]);
    setEncounterPrewarmInterior(host, 'nythraxis');
    const good = host.compilePrewarmColorPrograms;
    host.compilePrewarmColorPrograms = async () => {
      throw new Error('compile rejected');
    };

    queueLiveSoulRendPrewarm(host, player as never, look(), 'player');
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBe(1);

    // Same look, and it warms again: the failed identity was un-claimed.
    host.compilePrewarmColorPrograms = good;
    queueLiveSoulRendPrewarm(host, player as never, look(), 'player');
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBe(2);
    expect(host.compiled.length).toBeGreaterThan(0);

    // ... and a look that then SUCCEEDS is still claimed only once.
    queueLiveSoulRendPrewarm(host, player as never, look(), 'player');
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBe(2);
  });

  it('ignores an interior with no spec, and a host already shutting down', async () => {
    const host = fakeHost();
    startInteriorEncounterPrewarm('crypt', host);
    await drain();
    expect(host.compiled).toEqual([]);

    const dead = fakeHost();
    dead.shutdownStarted = true;
    startInteriorEncounterPrewarm('nythraxis', dead);
    await drain();
    expect(dead.compiled).toEqual([]);
  });

  it('warms each live body once and refuses a body that is not a player', async () => {
    const player = fakeVisual('player');
    const mob = fakeVisual('mob');
    const host = fakeHost([
      { id: 1, kind: 'player', visual: player },
      { id: 2, kind: 'mob', visual: mob },
    ]);
    setEncounterPrewarmInterior(host, 'nythraxis');

    queueLiveSoulRendPrewarm(host, player as never, look(), 'player');
    queueLiveSoulRendPrewarm(host, player as never, look(), 'player');
    queueLiveSoulRendPrewarm(host, mob as never, look(), 'mob');
    await drain();

    expect(player.calls.prewarmSoulRendSlots).toBe(1);
    expect(mob.calls.prewarmSoulRendSlots).toBe(0);

    // A new worn skin is a new look, so it warms again.
    queueLiveSoulRendPrewarm(host, player as never, look({ weaponSkinId: 'ice_fang' }), 'player');
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBe(2);
  });

  it('warms the bodies already in the room at attach, each on its own kind', async () => {
    const player = fakeVisual('player');
    const mob = fakeVisual('mob');
    const host = fakeHost([
      { id: 1, kind: 'player', visual: player },
      { id: 2, kind: 'mob', visual: mob },
    ]);
    startInteriorEncounterPrewarm('nythraxis', host);
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBe(1);
    expect(mob.calls.prewarmSoulRendSlots).toBe(0);
  });

  it('warms a form rig no view owns, on the kind its caller passes', async () => {
    // A shapeshifted body takes the mark on its FORM visual (sheep, bear, cat,
    // travel, metamorph), and a form rig is never any view's `visual`: recovering
    // the kind by scanning the views map found nothing and left every one of
    // them cold, which is the whole failure this prewarm exists to remove.
    const base = fakeVisual('base');
    const form = fakeVisual('form');
    const host = fakeHost([{ id: 1, kind: 'player', visual: base }]);
    setEncounterPrewarmInterior(host, 'nythraxis');

    queueLiveSoulRendPrewarm(host, form as never, null, 'player');
    await drain();
    expect(form.calls.prewarmSoulRendSlots).toBe(1);

    // A null look never re-keys: a form rig holds nothing it can swap.
    queueLiveSoulRendPrewarm(host, form as never, null, 'player');
    await drain();
    expect(form.calls.prewarmSoulRendSlots).toBe(1);
  });

  it('re-warms a body whose held look changed, and only then', async () => {
    const player = fakeVisual('player');
    const host = fakeHost([{ id: 1, kind: 'player', visual: player }]);
    setEncounterPrewarmInterior(host, 'nythraxis');
    const held = look({ mainhandItemId: 'rusty_sword' });

    queueLiveSoulRendPrewarm(host, player as never, held, 'player');
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBe(1);

    // The same held look re-queued: a sheathe toggle re-clones the SAME
    // materials, so it composes the same program key and warms nothing new.
    queueLiveSoulRendPrewarm(host, player as never, held, 'player');
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBe(1);

    // setWeapon re-snapshots the originals with the new weapon's meshes...
    queueLiveSoulRendPrewarm(
      host,
      player as never,
      look({ mainhandItemId: 'ashbringer' }),
      'player',
    );
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBe(2);

    // ...and so does setOffhand, down the same finishWeaponAttach tail.
    const bothHands = look({ mainhandItemId: 'ashbringer', offhandItemId: 'oak_shield' });
    queueLiveSoulRendPrewarm(host, player as never, bothHands, 'player');
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBe(3);
  });

  it('refuses to queue outside an interior and while the kill switch is set', async () => {
    const player = fakeVisual('player');
    const host = fakeHost([{ id: 1, kind: 'player', visual: player }]);
    // No interior attached and none passed: nothing to warm for.
    queueLiveSoulRendPrewarm(host, player as never, look(), 'player');
    await drain();
    expect(player.calls.prewarmSoulRendSlots).toBe(0);

    setEncounterPrewarmInterior(host, 'nythraxis');
    // The pass reads the live URL (`typeof location === 'undefined' ? '' :
    // location.search`), so the kill switch needs a location to read.
    const win = globalThis as unknown as { location?: { search: string } };
    win.location = { search: '?encounterPrewarm=0' };
    try {
      queueLiveSoulRendPrewarm(host, player as never, look(), 'player');
      await drain();
      expect(player.calls.prewarmSoulRendSlots).toBe(0);
    } finally {
      win.location = undefined;
    }
  });

  it('serializes live bodies instead of letting them share one idle period', async () => {
    // The ordering IS the fix: six bodies arriving together each waited on
    // their OWN idle slot, those slots resolved in the same idle period, and the
    // program links concatenated into one long task.
    const timeline: string[] = [];
    const bodies = ['a', 'b', 'c'].map((name) => fakeVisual(name, 2, timeline));
    const host = fakeHost(
      bodies.map((visual, index) => ({ id: index, kind: 'player', visual })),
      timeline,
    );
    setEncounterPrewarmInterior(host, 'nythraxis');
    for (const visual of bodies) queueLiveSoulRendPrewarm(host, visual as never, look(), 'player');
    await drain();

    // A body's compile lands before the next body's clone pass even starts.
    // Unchained, all three slot passes run first and the compiles trail them.
    expect(timeline).toEqual([
      'slots:a',
      'compile:a',
      'slots:b',
      'compile:b',
      'slots:c',
      'compile:c',
    ]);
  });

  it('places its hidden groups where the camera is, never at the world origin', async () => {
    const player = fakeVisual('player');
    const host = fakeHost([{ id: 1, kind: 'player', visual: player }]);
    setEncounterPrewarmInterior(host, 'nythraxis');
    const added: THREE.Object3D[] = [];
    host.scene.add = ((object: THREE.Object3D) => {
      added.push(object);
      return host.scene;
    }) as typeof host.scene.add;

    queueLiveSoulRendPrewarm(host, player as never, look(), 'player');
    await drain();

    expect(added.length).toBeGreaterThan(0);
    for (const group of added) {
      // A dungeon interior sits far from the origin: a group left there is
      // frustum-culled and its bounded warm render draws nothing.
      expect(group.position.x).toBe(host.sim.player.pos.x);
      expect(group.position.z).toBe(host.sim.player.pos.z - 24);
      expect(group.visible).toBe(false);
    }
  });
});
