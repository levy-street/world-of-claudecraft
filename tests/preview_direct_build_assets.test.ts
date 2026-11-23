// The launcher's character creator used to stand empty for minutes on a first visit: its
// stage was only built once charactersReady() resolved, which on a desktop is every creature
// body and every item weapon in the game (a few hundred files), and even then the body's own
// files queued behind that whole set as equal demands. Now (src/render/characters/assets.ts):
// the boot set rides the loader's BACKGROUND class, and a stage waits per body for exactly
// the files that body draws (directBuildAssetsResident: its base and animation libraries plus
// the weapons its build hangs), each asked for as a DEMAND, which moves it ahead of the boot
// set (the loader's own ordering is pinned by tests/render_asset_load_priority.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';

type Call = { url: string; priority: string };

/** A recording loader whose loads land only when the test says so, and a fresh character
 *  assets module over it, on the default (desktop) profile. */
async function desktopLauncher() {
  vi.resetModules();
  const calls: Call[] = [];
  const pending = new Map<
    string,
    { promise: Promise<unknown>; land: () => void; fail: () => void }
  >();
  const entry = (url: string) => {
    let e = pending.get(url);
    if (!e) {
      let land = () => {};
      let fail = () => {};
      const promise = new Promise((resolve, reject) => {
        land = () => resolve({ scene: { traverse() {} }, animations: [] });
        // the real loader forgets a rejected load, so the next ask is a fresh fetch
        fail = () => {
          pending.delete(url);
          reject(new Error(`offline: ${url}`));
        };
      });
      e = { promise, land, fail };
      pending.set(url, e);
    }
    return e;
  };
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string, opts?: { priority?: string }) => {
      calls.push({ url, priority: opts?.priority ?? 'demand' });
      return entry(url).promise;
    }),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  const assets = await import('../src/render/characters/assets');
  const manifest = await import('../src/render/characters/manifest');
  const { CLASSES } = await import('../src/sim/data');
  const land = async (url: string) => {
    entry(url).land();
    // let the asset module's then() run
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const fail = async (url: string) => {
    entry(url).fail();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { calls, assets, manifest, CLASSES, land, fail };
}

const isCreature = (url: string): boolean =>
  url.includes('models/creatures/') ||
  url.includes('models/chars/enemies/') ||
  url.includes('models/buddies/');

afterEach(() => {
  vi.doUnmock('../src/render/assets/loader');
  vi.resetModules();
});

describe('the character boot set on the launcher', () => {
  it('rides the background class, so nothing a stage waits on queues behind it', async () => {
    const { calls } = await desktopLauncher();
    // the desktop boot set: every creature and every item weapon, a few hundred files
    expect(calls.length).toBeGreaterThan(150);
    expect(calls.some((c) => isCreature(c.url))).toBe(true);
    expect(calls.some((c) => c.url.includes('models/weapons/'))).toBe(true);
    for (const call of calls) expect(call.priority, call.url).toBe('background');
  });
});

describe('directBuildAssetsResident (a stage built directly waits for its own files only)', () => {
  it('asks for the body files and the starter weapons as demands, and holds the build until they land', async () => {
    const { calls, assets, manifest, CLASSES, land } = await desktopLauncher();
    const key = manifest.playerVisualKey('warrior', null);
    const def = manifest.VISUALS[key];
    expect(def.wocCharacter).toBeTruthy();
    const weapon = CLASSES.warrior.startWeapon;
    const offhand = CLASSES.warrior.startOffhand ?? null;
    const weaponUrl = manifest.itemWeaponModelUrl(weapon) as string;
    const offhandUrl = manifest.itemOffhandModelUrl(offhand) as string;
    expect(weaponUrl).toBeTruthy();
    expect(offhandUrl).toBeTruthy();
    const boot = calls.length;

    expect(assets.directBuildAssetsResident(key, weapon, offhand, null, true)).toBe(false);
    const asked = calls.slice(boot);
    const demanded = new Set(asked.filter((c) => c.priority === 'demand').map((c) => c.url));
    // the body's own files, fetched on demand (a WOC body is out of the boot set)
    for (const url of [def.url, ...(def.animUrls ?? [])]) expect(demanded.has(url), url).toBe(true);
    // the weapons it holds were waiting in the background boot set: asked again as demands
    expect(demanded.has(weaponUrl)).toBe(true);
    expect(demanded.has(offhandUrl)).toBe(true);
    // nothing else of the boot set was promoted: no creature, no other weapon
    for (const url of demanded) {
      expect(isCreature(url), url).toBe(false);
      if (url.includes('models/weapons/')) expect([weaponUrl, offhandUrl]).toContain(url);
    }

    // asking again (every retry) starts nothing new
    const before = calls.length;
    expect(assets.directBuildAssetsResident(key, weapon, offhand, null, true)).toBe(false);
    expect(calls.length).toBe(before);

    // the body alone is not enough: the build hangs the weapons too
    for (const url of [def.url, ...(def.animUrls ?? [])]) await land(url);
    expect(assets.directBuildAssetsResident(key, weapon, offhand, null, true)).toBe(false);
    await land(weaponUrl);
    expect(assets.directBuildAssetsResident(key, weapon, offhand, null, true)).toBe(false);
    await land(offhandUrl);
    expect(assets.directBuildAssetsResident(key, weapon, offhand, null, true)).toBe(true);
  });

  it('a bare-handed build waits for no weapon at all', async () => {
    const { calls, assets, manifest, land } = await desktopLauncher();
    const key = manifest.playerVisualKey('warrior', null);
    const def = manifest.VISUALS[key];
    const boot = calls.length;
    expect(assets.directBuildAssetsResident(key, null, null, null, true)).toBe(false);
    expect(calls.slice(boot).some((c) => c.url.includes('models/weapons/'))).toBe(false);
    for (const url of [def.url, ...(def.animUrls ?? [])]) await land(url);
    expect(assets.directBuildAssetsResident(key, null, null, null, true)).toBe(true);
  });

  it('follows a weapon layout override (the Combat Mech holding a class layout)', async () => {
    const { calls, assets, manifest, CLASSES } = await desktopLauncher();
    const weapon = CLASSES.warrior.startWeapon;
    const offhand = CLASSES.warrior.startOffhand ?? null;
    const offhandUrl = manifest.itemOffhandModelUrl(offhand) as string;
    const override = manifest.mechHeldWeaponOverride('warrior');
    expect(override?.offhandSlot).toBeDefined();
    const demandedBy = (ask: () => void): Set<string> => {
      const before = calls.length;
      ask();
      return new Set(
        calls
          .slice(before)
          .filter((c) => c.priority === 'demand')
          .map((c) => c.url),
      );
    };
    // the mech's own layout has one mainhand slot and no offhand: no shield is asked for
    const own = demandedBy(() =>
      assets.directBuildAssetsResident('player_mech', weapon, offhand, null, true),
    );
    expect(own.has(offhandUrl)).toBe(false);
    // the warrior's layout on the mech: its build hangs the shield, so the wait asks for it
    const adopted = demandedBy(() =>
      assets.directBuildAssetsResident('player_mech', weapon, offhand, override, true),
    );
    expect(adopted.has(offhandUrl)).toBe(true);
  });

  it('asks again, after the cooldown, for a held weapon whose fetch failed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const { calls, assets, manifest, CLASSES, fail } = await desktopLauncher();
      const key = manifest.playerVisualKey('warrior', null);
      const weapon = CLASSES.warrior.startWeapon;
      const weaponUrl = manifest.itemWeaponModelUrl(weapon) as string;
      expect(assets.directBuildAssetsResident(key, weapon, null, null, true)).toBe(false);
      await fail(weaponUrl);
      const before = calls.length;
      // the stage asks every frame meanwhile: nothing goes back on the wire before the cooldown
      expect(assets.directBuildAssetsResident(key, weapon, null, null, true)).toBe(false);
      vi.advanceTimersByTime(7000);
      expect(calls.slice(before).some((c) => c.url === weaponUrl)).toBe(false);
      vi.advanceTimersByTime(1500);
      expect(calls.slice(before)).toContainEqual({ url: weaponUrl, priority: 'demand' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unknown key is never resident', async () => {
    const { assets } = await desktopLauncher();
    expect(assets.directBuildAssetsResident('no_such_body', null, null)).toBe(false);
  });
});
