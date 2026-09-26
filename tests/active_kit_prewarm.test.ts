import { readdirSync, readFileSync } from 'node:fs';
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
import * as contact from '../src/render/ability_vfx/contact_assets';
import { CONTACT_SHEETS, type ContactSheet } from '../src/render/ability_vfx/contact_assets';
import { CrestPrewarm } from '../src/render/ability_vfx/crest_prewarm';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import * as assets from '../src/render/ability_vfx/production_assets';
import { BAKED_URLS, type BakedKind } from '../src/render/ability_vfx/production_assets';
import { SignatureCrests } from '../src/render/ability_vfx/signature_crests';
import { SolidImpactFragments } from '../src/render/ability_vfx/solid_impact_fragments';
import { WarriorFuryStates } from '../src/render/ability_vfx/warrior_fury_states';
import { WarriorGuardPlates } from '../src/render/ability_vfx/warrior_guard_plates';
import { WarriorPowerForms } from '../src/render/ability_vfx/warrior_power_forms';
import { WarriorSpiritHammers } from '../src/render/ability_vfx/warrior_spirit_hammers';
import { setArrivalCover } from '../src/render/arrival_cover';
import { createBackgroundGpuQueue, GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { createGpuPrepAdmission } from '../src/render/gpu_prep_admission';
import { createGpuPrepBudget } from '../src/render/gpu_prep_budget_core';
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
  const smoke = new THREE.Texture();
  const shockwave = new THREE.Texture();
  const shoutDust = new THREE.Texture();
  const baked: Record<BakedKind, THREE.Texture> = {
    smoke,
    shout_dust: shoutDust,
    warrior_power: power,
    warrior_fervor: fervor,
    harvest_impact: harvest,
    warrior_bite: bite,
    warrior_shear: shear,
    warrior_crush: crush,
    shockwave,
  };
  vi.spyOn(assets, 'bakedTexture').mockImplementation((kind) => baked[kind] ?? null);
  const contacts: Record<ContactSheet, THREE.Texture> = {
    contact_cut: new THREE.Texture(),
    contact_crush: new THREE.Texture(),
    contact_pierce: new THREE.Texture(),
  };
  vi.spyOn(contact, 'contactTexture').mockImplementation((kind) => contacts[kind] ?? null);
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
    smoke,
    shockwave,
    shoutDust,
    baked,
    contacts,
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
      for (const sheet of [smoke, shockwave, shoutDust, ...Object.values(contacts)])
        sheet.dispose();
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
    expect(f.entry.progress()).toEqual({ done: 0, planned: 123, trimmed: true });
    // A dropped/skipped manifest never ran entry.run(), but kept registration.
    resumeActiveAbilityKit(f.scene);
    await ensureActiveAbilityKit(f.scene);
    expect(f.queue.run).toHaveBeenCalledTimes(123);
    for (const call of f.queue.run.mock.calls as unknown[][]) {
      expect(call[1]).toBe(GPU_WORK_PRIORITY.BOOT_DEBT);
      expect(call[3]).toEqual({ releaseTail: String(call[2]).startsWith('crest-compile:') });
    }
    expect(f.upload).toHaveBeenCalledTimes(15);
    // The sheets a cast draws with a fallback (contacts) or a skip (smoke,
    // dust) upload first, so their degraded window after the load is shortest.
    expect(f.upload).toHaveBeenNthCalledWith(1, f.contacts.contact_cut);
    expect(f.upload).toHaveBeenNthCalledWith(2, f.contacts.contact_crush);
    expect(f.upload).toHaveBeenNthCalledWith(3, f.contacts.contact_pierce);
    expect(f.upload).toHaveBeenNthCalledWith(4, f.smoke);
    expect(f.upload).toHaveBeenNthCalledWith(5, f.shoutDust);
    expect(f.upload).toHaveBeenNthCalledWith(6, f.blood);
    expect(f.upload).toHaveBeenNthCalledWith(7, f.steel);
    expect(f.upload).toHaveBeenNthCalledWith(8, f.texture);
    expect(f.upload).toHaveBeenNthCalledWith(9, f.rock);
    expect(f.upload).toHaveBeenNthCalledWith(10, f.power);
    expect(f.upload).toHaveBeenNthCalledWith(11, f.fervor);
    expect(f.upload).toHaveBeenNthCalledWith(12, f.harvest);
    expect(f.upload).toHaveBeenNthCalledWith(13, f.bite);
    expect(f.upload).toHaveBeenNthCalledWith(14, f.shear);
    expect(f.upload).toHaveBeenNthCalledWith(15, f.crush);
    expect(f.upload).not.toHaveBeenCalledWith(f.shockwave);
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
    expect(f.queue.run).toHaveBeenCalledTimes(123);
    expect(f.entry.progress().trimmed).toBe(false);
  } finally {
    f.close();
  }
});

it('uploads every sheet the Warrior kit draws before a geometry unit runs', async () => {
  // The kit's presentation draws the three contact sheets (flipbooks.ts) and
  // the generic smoke and dust layers (baked_impact_layers.ts) as well as its
  // signature sheets. They all land with the kit's demand load, after the boot
  // warm-up ran, so a sheet the recipe does not upload is uploaded by the
  // first cast that draws it, in a live frame. The loaded shockwave sheet is
  // drawn only by the boot-window prewarmSpawn, never by a cast.
  const f = fixture();
  try {
    await ensureActiveAbilityKit(f.scene);
    const uploaded = new Set(f.upload.mock.calls.map(([texture]) => texture));
    for (const kind of Object.keys(BAKED_URLS) as BakedKind[])
      expect(uploaded.has(assets.bakedTexture(kind)), kind).toBe(kind !== 'shockwave');
    for (const kind of CONTACT_SHEETS)
      expect(uploaded.has(contact.contactTexture(kind)), kind).toBe(true);
    for (const texture of [f.blood, f.steel, f.texture, f.rock])
      expect(uploaded.has(texture)).toBe(true);
    const labels = (f.queue.run.mock.calls as unknown[][]).map((call) => String(call[2]));
    const uploads = labels.filter((label) => label.startsWith('upload-big:'));
    expect(uploads).toHaveLength(f.upload.mock.calls.length);
    expect(labels.slice(0, uploads.length)).toEqual(uploads);
  } finally {
    f.close();
  }
});

it('leaves out only the shockwave sheet, which no cast draws', () => {
  // The recipe skips the loaded shockwave sheet because its one drawer is the
  // boot-window prewarmSpawn, behind the curtain. A cast that starts drawing
  // it must move it into the recipe, or its first draw uploads it live.
  const root = new URL('../src/render/', import.meta.url);
  const drawers: string[] = [];
  for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(new URL(file, root), 'utf8');
    for (const match of source.matchAll(/(?:bakedAt|spawn)\??\.?\(\s*'shockwave'/g))
      drawers.push(`${file}:${source.slice(0, match.index).split('\n').length}`);
  }
  expect(drawers).toHaveLength(1);
  expect(drawers[0]).toMatch(/^ability_vfx\/fx\.ts:/);
  const fx = readFileSync(new URL('ability_vfx/fx.ts', root), 'utf8');
  const spawn = fx.slice(fx.indexOf('  prewarmSpawn('), fx.indexOf('  prewarmSpawn(') + 600);
  expect(spawn).toContain("this.bakedAt('shockwave'");
});

it.each(CONTACT_SHEETS)('keeps the kit cold when the %s sheet is missing', async (kind) => {
  const f = fixture();
  try {
    vi.spyOn(contact, 'contactTexture').mockImplementation((sheet) =>
      sheet === kind ? null : f.contacts[sheet],
    );
    await expect(ensureActiveAbilityKit(f.scene)).rejects.toThrow('was not loaded');
    expect(f.host.draw).not.toHaveBeenCalled();
    expect(f.prep.ready('blood_cut')).toBe(false);
  } finally {
    f.close();
  }
});

it.each(['smoke', 'shout_dust'] as const)(
  'keeps the kit cold when the %s sheet is missing',
  async (kind) => {
    const f = fixture();
    try {
      vi.spyOn(assets, 'bakedTexture').mockImplementation((sheet) =>
        sheet === kind ? null : f.baked[sheet],
      );
      await expect(ensureActiveAbilityKit(f.scene)).rejects.toThrow('was not loaded');
      expect(f.host.draw).not.toHaveBeenCalled();
      expect(f.prep.ready('blood_cut')).toBe(false);
    } finally {
      f.close();
    }
  },
);

it('keeps synchronous declarations through every production Warrior preparation wrapper', () => {
  const f = fixture();
  const guards = new WarriorGuardPlates(f.scene);
  const powerForms = new WarriorPowerForms(f.scene);
  const spiritHammers = new WarriorSpiritHammers(f.scene);
  const textures = new Proxy({}, { get: () => f.texture }) as AbilityVfxTextures;
  const furyStates = new WarriorFuryStates(f.scene, () => null, textures);
  const baked = new BakedImpactLayers(f.scene);
  const fragments = new SolidImpactFragments(f.scene);
  const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
  Object.assign(fx, {
    // The real crest wrapper (its kit bind) over the fixture's preparation.
    crests: { preparation: f.prep, units: SignatureCrests.prototype.units },
    guards,
    powerForms,
    spiritHammers,
    furyStates,
    baked,
    fragments,
  });
  try {
    const units = fx.authoredPrewarmUnits(f.host, ACTIVE_WARRIOR_CRESTS);
    expect(units).toHaveLength(ACTIVE_WARRIOR_CRESTS.length * 4 + 1 + 4 + 16 + 3 + 12 + 30 + 12);
    expect(units[0].id).toBe('crest-bind-kit');
    expect(units.filter((unit) => unit.id.includes('compile'))).toHaveLength(49);
    for (const unit of units)
      expect(unit.synchronous === true, unit.id).toBe(!unit.id.includes('compile'));
  } finally {
    fragments.dispose();
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
    expect(f.upload).toHaveBeenCalledTimes(15);
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
    // The 15 texture uploads are earlier, synchronous units in the same
    // recipe array and every one of them already ran (and was marked done)
    // before the loop ever reached the first crest geometry unit whose
    // compile rejected: paid work, already spent by the time this failed.
    expect(f.upload).toHaveBeenCalledTimes(15);
    expect(f.prep.ready('blood_cut')).toBe(false);
    expect(f.host.draw).not.toHaveBeenCalled();
    await ensureActiveAbilityKit(f.scene);
    // The retry's recipe filters out every id already in state.done, so it
    // replays only the unpaid geometry work; the texture upload count must
    // stay at 15, the proof that the paid uploads were not repeated.
    expect(f.upload).toHaveBeenCalledTimes(15);
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
    expect(f.upload).toHaveBeenCalledTimes(15);
    expect(f.host.draw).toHaveBeenCalledTimes(27);
    for (const kind of ACTIVE_WARRIOR_CRESTS) expect(f.prep.ready(kind)).toBe(true);
    expect(f.prep.ready('fire')).toBe(false);
  } finally {
    f.close();
  }
});

it('spreads the kit texture uploads one per presented frame under the real queue and budget', async () => {
  // Measured on an Intel HD 530: each 2048px sheet costs about 100 ms of
  // decode plus upload, and all ten ran back to back with no frame between
  // them (one 533 to 635 ms freeze). The kit is a cosmetic upgrade gated by its
  // own readiness, so its uploads must take the per-frame budget, not the
  // actionable floor that admits them all into one frame.
  const f = fixture();
  let clock = 0;
  const budget = createGpuPrepBudget();
  const queue = createBackgroundGpuQueue({
    now: () => clock,
    admission: createGpuPrepAdmission(budget),
  });
  const uploadsPerFrame: number[] = [0];
  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  let lastFrameAt = 0;
  const frame = () => {
    clock += 16;
    budget.noteFrame(clock - lastFrameAt);
    queue.noteFrame(clock);
    lastFrameAt = clock;
    uploadsPerFrame.push(0);
  };
  try {
    activeKitPrewarmEntry(f.scene, 'warrior', {
      queue,
      geometry: () => [],
      texture: (texture) => {
        f.upload(texture);
        clock += 100;
        uploadsPerFrame[uploadsPerFrame.length - 1]++;
      },
    });
    // The kit starts after first paint: the frame clock is already running.
    frame();
    const task = ensureActiveAbilityKit(f.scene);
    for (let i = 0; i < 40 && f.upload.mock.calls.length < 15; i++) {
      await flush();
      frame();
    }
    await task;
    expect(f.upload).toHaveBeenCalledTimes(15);
    expect(Math.max(...uploadsPerFrame)).toBe(1);
    // Paced, never starved: one upload per frame, fifteen frames.
    expect(uploadsPerFrame.filter((count) => count > 0)).toHaveLength(15);
    expect(uploadsPerFrame.length).toBeLessThanOrEqual(18);
  } finally {
    await queue.shutdown();
    f.close();
  }
});

it('waits out a loading cover instead of freezing it, then paces its uploads', async () => {
  // Measured on the HD 530 for a local Warrior: under the world-entry settle
  // cover the ten uploads still ran as one 555 ms frame, because the cover
  // admits everything the camera landed among. The kit is not that; it waits
  // for the reveal like the boot debt and is paced once the frames are live.
  const f = fixture();
  let clock = 0;
  const budget = createGpuPrepBudget();
  const queue = createBackgroundGpuQueue({
    now: () => clock,
    admission: createGpuPrepAdmission(budget),
  });
  const uploadsPerFrame: number[] = [0];
  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  let lastFrameAt = 0;
  const frame = () => {
    clock += 16;
    budget.noteFrame(clock - lastFrameAt);
    queue.noteFrame(clock);
    lastFrameAt = clock;
    uploadsPerFrame.push(0);
  };
  try {
    activeKitPrewarmEntry(f.scene, 'warrior', {
      queue,
      geometry: () => [],
      texture: (texture) => {
        f.upload(texture);
        clock += 100;
        uploadsPerFrame[uploadsPerFrame.length - 1]++;
      },
    });
    setArrivalCover(true);
    frame();
    const task = ensureActiveAbilityKit(f.scene);
    for (let i = 0; i < 60; i++) {
      await flush();
      frame();
    }
    expect(f.upload).not.toHaveBeenCalled();
    setArrivalCover(false);
    for (let i = 0; i < 40 && f.upload.mock.calls.length < 15; i++) {
      await flush();
      frame();
    }
    await task;
    expect(f.upload).toHaveBeenCalledTimes(15);
    // Not ageing under the cover: no starvation burst on the first live frame.
    expect(Math.max(...uploadsPerFrame)).toBe(1);
  } finally {
    setArrivalCover(false);
    await queue.shutdown();
    f.close();
  }
});
