import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import {
  ACTIVE_WARRIOR_CRESTS,
  activeKitPrewarmEntry,
  cancelActiveAbilityKit,
  ensureActiveAbilityKit,
  resumeActiveAbilityKit,
} from '../src/render/ability_vfx/active_kit_prewarm';
import { CrestPrewarm } from '../src/render/ability_vfx/crest_prewarm';
import * as assets from '../src/render/ability_vfx/production_assets';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import type { PrewarmResumeUnit } from '../src/render/prewarm_resume';
import { prepareStudioAbilityKit } from '../src/vfx_studio/prepare_ability_kit';

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
  const steel = new THREE.Texture();
  vi.spyOn(assets, 'warriorSteelTexture').mockReturnValue(steel);
  const power = new THREE.Texture();
  vi.spyOn(assets, 'bakedTexture').mockImplementation((kind) =>
    kind === 'warrior_power' ? power : null,
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
    power,
    close: () => {
      cancelActiveAbilityKit(scene);
      prep.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      blood.dispose();
      steel.dispose();
      power.dispose();
      vi.restoreAllMocks();
    },
  };
}

it('registers without GPU work and resumes only the thirteen selected Warrior shapes', async () => {
  const f = fixture();
  try {
    expect(f.entry.required).toBe(false);
    expect(f.entry).not.toHaveProperty('resumeUnits');
    expect(f.entry).not.toHaveProperty('deadlineExempt');
    expect(f.queue.run).not.toHaveBeenCalled();
    expect(f.entry.progress()).toEqual({ done: 0, planned: 56, trimmed: true });
    // A dropped/skipped manifest never ran entry.run(), but kept registration.
    resumeActiveAbilityKit(f.scene);
    await ensureActiveAbilityKit(f.scene);
    expect(f.queue.run).toHaveBeenCalledTimes(56);
    for (const call of f.queue.run.mock.calls as unknown[][]) {
      expect(call[1]).toBe(GPU_WORK_PRIORITY.ACTIONABLE_VIEW);
      expect(call[3]).toEqual({ releaseTail: true });
    }
    expect(f.upload).toHaveBeenCalledTimes(4);
    expect(f.upload).toHaveBeenNthCalledWith(1, f.blood);
    expect(f.upload).toHaveBeenNthCalledWith(2, f.steel);
    expect(f.upload).toHaveBeenNthCalledWith(3, f.texture);
    expect(f.upload).toHaveBeenNthCalledWith(4, f.power);
    expect(f.host.draw).toHaveBeenCalledTimes(13);
    expect(ACTIVE_WARRIOR_CRESTS).toContain('steel_storm');
    expect(ACTIVE_WARRIOR_CRESTS).toContain('steel_reap');
    expect(ACTIVE_WARRIOR_CRESTS).toContain('iron_counter');
    expect(ACTIVE_WARRIOR_CRESTS).toContain('iron_quake');
    expect(ACTIVE_WARRIOR_CRESTS).toContain('iron_fault');
    expect(ACTIVE_WARRIOR_CRESTS).toContain('breach_wedge');
    for (const kind of ACTIVE_WARRIOR_CRESTS) expect(f.prep.ready(kind)).toBe(true);
    expect(f.prep.ready('fire')).toBe(false);
    await ensureActiveAbilityKit(f.scene);
    expect(f.queue.run).toHaveBeenCalledTimes(56);
    expect(f.entry.progress().trimmed).toBe(false);
  } finally {
    f.close();
  }
});

it('selects Warrior after another class reuses the same Studio scene', async () => {
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
    expect(f.prep.ready('blood_cut')).toBe(false);
    expect(f.host.draw).not.toHaveBeenCalled();
    await ensureActiveAbilityKit(f.scene);
    expect(f.upload).toHaveBeenCalledTimes(4);
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

it('pumps a paused take until its selected queue finishes without presenting or advancing combat', async () => {
  const f = fixture('mage');
  const pending: Array<() => void> = [];
  const sync = vi.fn(() => {
    pending.shift()?.();
  });
  try {
    f.queue.run.mockImplementation(
      (work) =>
        new Promise<void>((resolve, reject) => {
          pending.push(() => {
            void Promise.resolve(work()).then(resolve, reject);
          });
        }),
    );
    await prepareStudioAbilityKit(
      { scene: f.scene, sync },
      'warrior',
      () => true,
      async () => {
        await Promise.resolve();
      },
    );
    expect(f.prep.ready('challenge_pressure')).toBe(true);
    expect(sync).toHaveBeenCalled();
    for (const call of sync.mock.calls as unknown[][])
      expect(call).toEqual([1, 0, null, 0, null, true, false]);
  } finally {
    f.close();
  }
});

it('ends the Studio wait on configuration cancellation and reports preparation errors', async () => {
  const f = fixture();
  try {
    f.host.compile.mockRejectedValue(new Error('cannot prepare'));
    await expect(
      prepareStudioAbilityKit(
        { scene: f.scene, sync: vi.fn() },
        'warrior',
        () => true,
        async () => {
          await Promise.resolve();
        },
      ),
    ).rejects.toThrow('cannot prepare');
    const sync = vi.fn();
    await prepareStudioAbilityKit({ scene: f.scene, sync }, 'warrior', () => false);
    expect(sync).not.toHaveBeenCalled();
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

it('fails a stalled Studio preparation without announcing false readiness', async () => {
  const f = fixture();
  let now = 0;
  try {
    f.queue.run.mockImplementationOnce(() => new Promise<void>(() => {}));
    await expect(
      prepareStudioAbilityKit(
        { scene: f.scene, sync: vi.fn() },
        'warrior',
        () => true,
        async () => {
          now += 15000;
          if (now > 60000) throw new Error('unbounded wait');
        },
        () => now,
      ),
    ).rejects.toThrow('selected ability preparation timed out');
    expect(f.prep.ready('challenge_pressure')).toBe(false);
    expect(f.host.draw).not.toHaveBeenCalled();
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
