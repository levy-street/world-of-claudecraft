import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import {
  ACTIVE_WARRIOR_CRESTS,
  activeKitPrewarmEntry,
  cancelActiveAbilityKit,
  ensureActiveAbilityKit,
  resumeActiveAbilityKit,
} from '../src/render/ability_vfx/active_kit_prewarm';
import { BakedImpactLayers } from '../src/render/ability_vfx/baked_impact_layers';
import { CrestPrewarm } from '../src/render/ability_vfx/crest_prewarm';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import * as assets from '../src/render/ability_vfx/production_assets';
import { WarriorFuryStates } from '../src/render/ability_vfx/warrior_fury_states';
import { WarriorGuardPlates } from '../src/render/ability_vfx/warrior_guard_plates';
import { WarriorPowerForms } from '../src/render/ability_vfx/warrior_power_forms';
import { WarriorSpiritHammers } from '../src/render/ability_vfx/warrior_spirit_hammers';
import { createBackgroundGpuQueue, GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import type { PrewarmResumeUnit } from '../src/render/prewarm_resume';

function fixture(cls = 'warrior') {
  const scene = new THREE.Scene();
  const geometry = new THREE.PlaneGeometry();
  const material = new THREE.MeshBasicMaterial();
  const shapes = new Map(ACTIVE_WARRIOR_CRESTS.map((kind) => [kind, geometry]));
  shapes.set('fire', geometry);
  const prep = new CrestPrewarm(scene, shapes, material);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const host = {
    properties: { get: () => ({ programs: new Map([['flat', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  const texture = new THREE.Texture();
  vi.spyOn(assets, 'warriorPressureTexture').mockReturnValue(texture);
  const blood = new THREE.Texture();
  vi.spyOn(assets, 'warriorBloodTexture').mockReturnValue(blood);
  const rock = new THREE.Texture();
  vi.spyOn(assets, 'warriorRockTexture').mockReturnValue(rock);
  const steel = new THREE.Texture();
  vi.spyOn(assets, 'warriorSteelTexture').mockReturnValue(steel);
  const power = new THREE.Texture();
  const fervor = new THREE.Texture();
  const harvest = new THREE.Texture();
  const bite = new THREE.Texture();
  const shear = new THREE.Texture();
  const crush = new THREE.Texture();
  vi.spyOn(assets, 'bakedTexture').mockImplementation((kind) =>
    kind === 'warrior_fervor'
      ? fervor
      : kind === 'warrior_power'
        ? power
        : kind === 'harvest_impact'
          ? harvest
          : kind === 'warrior_bite'
            ? bite
            : kind === 'warrior_shear'
              ? shear
              : kind === 'warrior_crush'
                ? crush
                : null,
  );
  const queue = {
    run: vi.fn(async (work: PrewarmResumeUnit['run']) => {
      await work();
    }),
  };
  const upload = vi.fn();
  const entry = activeKitPrewarmEntry(scene, cls, {
    queue: queue as unknown as Pick<
      import('../src/render/background_gpu_queue').BackgroundGpuQueue,
      'run'
    >,
    geometry: (kinds) => prep.units(host, kinds),
    texture: upload,
  });
  return {
    scene,
    prep,
    host,
    queue,
    upload,
    entry,
    texture,
    blood,
    steel,
    rock,
    power,
    fervor,
    harvest,
    bite,
    shear,
    crush,
    close: () => {
      cancelActiveAbilityKit(scene);
      prep.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      blood.dispose();
      steel.dispose();
      rock.dispose();
      power.dispose();
      fervor.dispose();
      harvest.dispose();
      bite.dispose();
      shear.dispose();
      crush.dispose();
      vi.restoreAllMocks();
    },
  };
}

it('registers without GPU work and resumes only the twenty-seven selected Warrior shapes', async () => {
  const f = fixture();
  try {
    expect(f.entry.required).toBe(false);
    expect(f.entry).not.toHaveProperty('resumeUnits');
    expect(f.entry).not.toHaveProperty('deadlineExempt');
    expect(f.queue.run).not.toHaveBeenCalled();
    expect(f.entry.progress()).toEqual({ done: 0, planned: 118, trimmed: true });
    // A dropped/skipped manifest never ran entry.run(), but kept registration.
    resumeActiveAbilityKit(f.scene);
    await ensureActiveAbilityKit(f.scene);
    expect(f.queue.run).toHaveBeenCalledTimes(118);
    for (const call of f.queue.run.mock.calls as unknown[][]) {
      expect(call[1]).toBe(GPU_WORK_PRIORITY.ACTIONABLE_VIEW);
      expect(call[3]).toEqual({ releaseTail: String(call[2]).startsWith('crest-compile:') });
    }
    expect(f.upload).toHaveBeenCalledTimes(10);
    expect(f.upload).toHaveBeenNthCalledWith(1, f.blood);
    expect(f.upload).toHaveBeenNthCalledWith(2, f.steel);
    expect(f.upload).toHaveBeenNthCalledWith(3, f.texture);
    expect(f.upload).toHaveBeenNthCalledWith(4, f.rock);
    expect(f.upload).toHaveBeenNthCalledWith(5, f.power);
    expect(f.upload).toHaveBeenNthCalledWith(6, f.fervor);
    expect(f.upload).toHaveBeenNthCalledWith(7, f.harvest);
    expect(f.upload).toHaveBeenNthCalledWith(8, f.bite);
    expect(f.upload).toHaveBeenNthCalledWith(9, f.shear);
    expect(f.upload).toHaveBeenNthCalledWith(10, f.crush);
    expect(f.crush).not.toBe(f.shear);
    expect(f.host.draw).toHaveBeenCalledTimes(27);
    // The full, ordered 27-name crest list (20 authored kinds + the 7
    // WARRIOR_PRESSURE_KINDS spread in), pinned as one literal instead of 15
    // scattered toContain checks: those covered barely half the list (missing
    // blood_cut, shield_contact, steel_cut, avatar_rupture, blood_gyre, and
    // every pressure kind) and none of them could catch a reorder or an
    // unintended addition/removal.
    expect(ACTIVE_WARRIOR_CRESTS).toEqual([
      'blood_cut',
      'harvest_cut',
      'harvest_eruption',
      'twinstrike_cut',
      'bloodletting_pull',
      'bark_pressure',
      'shield_contact',
      'steel_cut',
      'steel_chop',
      'steel_counter',
      'steel_execution',
      'steel_storm',
      'steel_reap',
      'iron_counter',
      'iron_quake',
      'iron_fault',
      'breach_wedge',
      'avatar_rupture',
      'blood_gyre',
      'leap_rupture',
      'rally_pressure',
      'dread_pressure',
      'challenge_pressure',
      'battle_pressure',
      'embolden_pressure',
      'fear_pressure',
      'piercing_pressure',
    ]);
    for (const kind of ACTIVE_WARRIOR_CRESTS) expect(f.prep.ready(kind)).toBe(true);
    expect(f.prep.ready('fire')).toBe(false);
    await ensureActiveAbilityKit(f.scene);
    expect(f.queue.run).toHaveBeenCalledTimes(118);
    expect(f.entry.progress().trimmed).toBe(false);
  } finally {
    f.close();
  }
});

it('keeps synchronous declarations through every production Warrior preparation wrapper', () => {
  const f = fixture();
  const guards = new WarriorGuardPlates(f.scene);
  const powerForms = new WarriorPowerForms(f.scene);
  const spiritHammers = new WarriorSpiritHammers(f.scene);
  const textures = new Proxy({}, { get: () => f.texture }) as AbilityVfxTextures;
  const furyStates = new WarriorFuryStates(f.scene, () => null, textures);
  const baked = new BakedImpactLayers(f.scene);
  const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
  Object.assign(fx, {
    crests: { preparation: f.prep },
    guards,
    powerForms,
    spiritHammers,
    furyStates,
    baked,
  });
  try {
    const units = fx.authoredPrewarmUnits(f.host, ACTIVE_WARRIOR_CRESTS);
    expect(units).toHaveLength(ACTIVE_WARRIOR_CRESTS.length * 4 + 4 + 16 + 3 + 12 + 30);
    expect(units.filter((unit) => unit.id.includes('compile'))).toHaveLength(46);
    for (const unit of units)
      expect(unit.synchronous === true, unit.id).toBe(!unit.id.includes('compile'));
  } finally {
    baked.dispose();
    furyStates.dispose();
    powerForms.dispose();
    spiritHammers.dispose();
    guards.dispose();
    f.close();
  }
});

it('lets synchronous Warrior uploads and real crest touches pass two released tails while compiling stays capped', async () => {
  const f = fixture();
  const queue = createBackgroundGpuQueue();
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const first = deferred(),
    second = deferred(),
    compile = deferred();
  const tails: Promise<void>[] = [];
  let task: Promise<void> | undefined;
  const flush = async () => {
    for (let i = 0; i < 100; i++) await Promise.resolve();
  };
  try {
    // These are actual producer units, with the first crest already linked.
    // Its reflection/upload work must proceed even when unrelated links fill
    // the queue. The second crest still needs an asynchronous compile.
    const units = f.prep.units(f.host, ['blood_cut', 'harvest_cut']);
    await units[0].run();
    f.host.compile.mockImplementationOnce(() => compile.promise);
    activeKitPrewarmEntry(f.scene, 'warrior', {
      queue,
      geometry: () => units.slice(1),
      texture: f.upload,
    });
    tails.push(
      queue.run(() => first.promise, GPU_WORK_PRIORITY.LIVE_VIEW, 'unrelated-one', {
        releaseTail: true,
      }),
    );
    tails.push(
      queue.run(() => second.promise, GPU_WORK_PRIORITY.LIVE_VIEW, 'unrelated-two', {
        releaseTail: true,
      }),
    );
    await flush();
    expect(queue.stats().waitingTails).toHaveLength(2);

    task = ensureActiveAbilityKit(f.scene);
    await flush();
    expect(f.upload).toHaveBeenCalledTimes(10);
    expect(f.prep.ready('blood_cut')).toBe(true);
    expect(f.host.draw).toHaveBeenCalledTimes(1);
    expect(f.host.compile).toHaveBeenCalledTimes(1);
    expect(queue.stats().waitingTails.map((tail) => tail.label)).toEqual([
      'unrelated-one',
      'unrelated-two',
    ]);
    expect(queue.stats().pending).toBe(1);

    first.resolve();
    await flush();
    expect(f.host.compile).toHaveBeenCalledTimes(2);
    expect(queue.stats().waitingTails.map((tail) => tail.label)).toEqual([
      'unrelated-two',
      'crest-compile:harvest_cut',
    ]);
    expect(f.prep.ready('harvest_cut')).toBe(false);
    compile.resolve();
    await task;
    expect(f.prep.ready('harvest_cut')).toBe(true);
    expect(f.host.draw).toHaveBeenCalledTimes(2);
  } finally {
    first.resolve();
    second.resolve();
    compile.resolve();
    await Promise.allSettled([...tails, ...(task ? [task] : [])]);
    await queue.shutdown();
    f.close();
  }
});

it('can select Warrior preparation for a spectator using another class', async () => {
  const f = fixture('mage');
  try {
    await ensureActiveAbilityKit(f.scene);
    expect(f.queue.run).not.toHaveBeenCalled();
    await ensureActiveAbilityKit(f.scene, 'warrior');
    expect(f.prep.ready('challenge_pressure')).toBe(true);
  } finally {
    f.close();
  }
});

it('surfaces a failed compile without blessing its buffers and retries only unpaid work', async () => {
  const f = fixture();
  try {
    f.host.compile.mockRejectedValueOnce(new Error('driver link failed'));
    await expect(ensureActiveAbilityKit(f.scene)).rejects.toThrow('driver link failed');
    // The 10 texture uploads are earlier, synchronous units in the same
    // recipe array and every one of them already ran (and was marked done)
    // before the loop ever reached the first crest geometry unit whose
    // compile rejected: paid work, already spent by the time this failed.
    expect(f.upload).toHaveBeenCalledTimes(10);
    expect(f.prep.ready('blood_cut')).toBe(false);
    expect(f.host.draw).not.toHaveBeenCalled();
    await ensureActiveAbilityKit(f.scene);
    // The retry's recipe filters out every id already in state.done, so it
    // replays only the unpaid geometry work; the texture upload count must
    // stay at 10, the proof that the paid uploads were not repeated.
    expect(f.upload).toHaveBeenCalledTimes(10);
    expect(f.prep.ready('blood_cut')).toBe(true);
  } finally {
    f.close();
  }
});

it('cancels a queued operation before it can upload into a retired renderer', async () => {
  const f = fixture();
  let release!: () => void;
  try {
    f.queue.run.mockImplementationOnce(
      (work) =>
        new Promise<void>((resolve) => {
          release = () => {
            void Promise.resolve(work()).then(resolve);
          };
        }),
    );
    const task = ensureActiveAbilityKit(f.scene);
    cancelActiveAbilityKit(f.scene);
    f.prep.dispose();
    release();
    await task;
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.host.compile).not.toHaveBeenCalled();
    expect(f.queue.run).toHaveBeenCalledTimes(1);
  } finally {
    f.close();
  }
});

it('waits outside the GPU queue for the shared first-paint boundary', async () => {
  const f = fixture();
  let reveal!: () => void;
  try {
    resumeActiveAbilityKit(
      f.scene,
      new Promise<void>((resolve) => {
        reveal = resolve;
      }),
    );
    await Promise.resolve();
    expect(f.queue.run).not.toHaveBeenCalled();
    reveal();
    await Promise.resolve();
    await ensureActiveAbilityKit(f.scene);
    expect(f.prep.ready('challenge_pressure')).toBe(true);
  } finally {
    f.close();
  }
});

it('does not submit a retired recipe when the first-paint boundary is finally released', async () => {
  const f = fixture();
  let reveal!: () => void;
  try {
    resumeActiveAbilityKit(
      f.scene,
      new Promise<void>((resolve) => {
        reveal = resolve;
      }),
    );
    cancelActiveAbilityKit(f.scene);
    reveal();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.queue.run).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
it('prepares remote Warriors for a Mage only after first paint, retaining fallback until upload completes', async () => {
  const f = fixture('mage');
  let reveal!: () => void;
  const firstPaint = new Promise<void>((resolve) => {
    reveal = resolve;
  });
  try {
    resumeActiveAbilityKit(f.scene, firstPaint, 'warrior');
    await Promise.resolve();
    await ensureActiveAbilityKit(f.scene);
    expect(f.queue.run).not.toHaveBeenCalled();
    expect(f.prep.ready('harvest_cut')).toBe(false);
    expect(f.prep.ready('twinstrike_cut')).toBe(false);
    reveal();
    await Promise.resolve();
    await ensureActiveAbilityKit(f.scene, 'warrior');
    expect(f.upload).toHaveBeenCalledTimes(10);
    expect(f.host.draw).toHaveBeenCalledTimes(27);
    for (const kind of ACTIVE_WARRIOR_CRESTS) expect(f.prep.ready(kind)).toBe(true);
    expect(f.prep.ready('fire')).toBe(false);
  } finally {
    f.close();
  }
});
