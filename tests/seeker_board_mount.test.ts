import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import type { AnimState } from '../src/render/characters/anim_state';
import { desiredBaseState } from '../src/render/characters/anim_state';
import { VISUALS } from '../src/render/characters/manifest';
import { MOUNT_VISUAL_SPECS, mountRidePose, riderPoseFlags } from '../src/render/mount_visuals';
import { BASE_ITEMS } from '../src/sim/content/items';
import { MOUNTS } from '../src/sim/content/mounts';

// The Solana Seeker board: the promotional mount for Seeker Genesis Token
// holders (issue #3628). These pin the parts that fail SILENTLY rather than
// loudly: a ClipMap naming a clip the GLB does not carry freezes the mount on
// its bind pose, a missing engine take leaves it mute, and a pose flag read by
// the wrong consumer streams cast VFX off every rider in view.
const ROOT = join(__dirname, '..');
const GLB = 'public/models/mounts/seeker_board.glb';

function glbJson(rel: string): { animations?: { name?: string }[]; nodes?: { name?: string }[] } {
  const b = readFileSync(join(ROOT, rel));
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}

/** A resting AnimState, so each case below varies exactly one thing. */
const anim = (over: Partial<AnimState> = {}): AnimState => ({
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
  ...over,
});

describe('Seeker board asset', () => {
  it('ships the model, optimised', () => {
    expect(existsSync(join(ROOT, GLB)), GLB).toBe(true);
    const bytes = statSync(join(ROOT, GLB)).size;
    expect(bytes).toBeGreaterThan(1000);
    // Upper bound as a DRIFT SIGNAL, not a style preference: the bake resamples,
    // prunes, and drops channels that never leave the bone's rest value (13,920
    // keys across 240 channels down to about 2,000 across 169). A re-export that
    // skips the optimiser lands back near a megabyte and fails here instead of
    // passing quietly.
    expect(bytes).toBeLessThan(900_000);
  });

  it('carries every clip MOUNT_SEEKER names', () => {
    const names = (glbJson(GLB).animations ?? []).map((a) => a.name);
    // Idle, Walk and Jump are authored on the source model; Run and Death are
    // baked by scripts/bake_seeker_gaits.mjs, because ClipMap requires both and
    // the source ships neither.
    for (const clip of ['Idle', 'Walk', 'Run', 'Death', 'Jump']) {
      expect(names, clip).toContain(clip);
    }
  });

  it('keeps the rider anchor the visual spec is measured against', () => {
    // mount_visuals seats the rider at hover + Seat * normScale. If the rig ever
    // loses these bones the seat number silently becomes a guess.
    const nodes = (glbJson(GLB).nodes ?? []).map((n) => n.name);
    expect(nodes).toContain('Seat');
    expect(nodes).toContain('Hover');
  });
});

describe('Seeker board wiring', () => {
  it('registers in the sim catalog at the collectible tier', () => {
    const def = MOUNTS.seeker_board;
    expect(def).toBeDefined();
    expect(def.key).toBe('seeker_board');
    // Speed is the only stat a mount grants, so a promotional mount must not
    // out-run the ladder: it sits at the epic tier with the other collectibles.
    expect(def.rarity).toBe('epic');
    expect(def.moveSpeedPct).toBe(0.8);
    // The WIKI generator reads this raw name onto a public page, and the sim may
    // not carry the brand (tests/architecture.test.ts forbids it there), so it
    // has to be a real neutral name rather than a placeholder.
    expect(def.name).toBe('Seeker Board');
  });

  it('locks the reins against every transfer rail, not just binding', () => {
    // Issue #3628: one mount per Genesis Token, permanently bound, never sold,
    // traded or transferred.
    const item = BASE_ITEMS.reins_seeker_board;
    expect(item).toBeDefined();
    expect(item.kind).toBe('mount');
    if (item.kind !== 'mount') throw new Error('not a mount item');
    expect(item.mount).toBe('seeker_board');
    expect(item.soulbound).toBe(true);
    expect(item.noDiscard).toBe(true);
    // soulbound alone does NOT close the $WOC Exchange: that category tolerates
    // bound mounts on purpose, so the cash rail needs noMarketList. Pinned here
    // as well as in tests/exchange_eligibility.test.ts because the two guard
    // different halves, the flag and the policy.
    expect(item.noMarketList).toBe(true);
    // Vendor sale is blocked today only by the soulbound arm, and the player
    // reins were un-soulbound once already; with sellValue 0 a future un-bind
    // would turn vendoring into a silent destroy.
    expect(item.noVendorSell).toBe(true);
    expect(item.sellValue).toBe(0);
  });

  it('points the visual at the board and sizes it as a height, not a length', () => {
    const def = VISUALS.mount_seeker_board;
    expect(def).toBeDefined();
    expect(def.url).toContain('seeker_board.glb');
    // normScale is def.height / the model's Y extent, and this deck is 0.19
    // tall. A height in the 2-3 range like the other mounts would scale it past
    // 20 yards long, so an unexplained bump here is a real defect.
    expect(def.height).toBeGreaterThan(0.2);
    expect(def.height).toBeLessThan(0.8);
    // A hover board resting in the dirt is not hovering, so the float has to be
    // a real positive number rather than merely present.
    expect(def.hover ?? 0).toBeGreaterThan(0.1);
    // The rig points down +X while visuals face +Z: without the quarter turn
    // the board travels sideways under its rider.
    expect(def.yaw ?? 0).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('gives the board a jump clip without handing one to every other mount', () => {
    expect(VISUALS.mount_seeker_board.clips.jump).toBe('Jump');
    // MOUNT_RIGGED is shared by reference; editing it would hand a jump clip to
    // rigs that ship none, which resolves to a frozen bind pose.
    for (const [key, def] of Object.entries(VISUALS)) {
      if (!key.startsWith('mount_') || key === 'mount_seeker_board') continue;
      expect(def.clips.jump, `${key} must not gain a jump clip`).toBeUndefined();
    }
  });
});

describe('Seeker board rider pose', () => {
  it('channels for the whole ride, standing still or at speed', () => {
    // `cast` outranks both the seated loop and locomotion, which is the ordering
    // that makes a permanent channel possible. Driven through the real state
    // machine rather than pinned as source order.
    const hold = anim({ poseHoldCast: true });
    expect(desiredBaseState(hold, true)).toBe('cast');
    expect(desiredBaseState({ ...hold, moving: true, running: true }, true)).toBe('cast');
    expect(desiredBaseState({ ...hold, sitting: true }, true)).toBe('cast');
    // Control: a mounted rider WITHOUT the hold still sits, so the assertions
    // above are about the flag rather than about the default.
    expect(desiredBaseState(anim({ sitting: true }), true)).toBe('sit');
    // Swimming still outranks the hold, so mounted swimming animates.
    expect(desiredBaseState({ ...hold, swimming: true }, true)).toBe('swimIdle');
  });

  it('holds the pose without claiming a cast is happening', () => {
    // The separation is the whole point: `casting` drives cast sparkle VFX and
    // the metamorph wing attitude, so a rider that reused it would stream arcane
    // sparkle for the entire ride.
    const flags = riderPoseFlags('seeker_board', true);
    expect(flags.holdCast).toBe(true);
    expect(flags.holdSit).toBe(false);
  });

  it('leaves every other mount, and every dismounted rider, seated', () => {
    expect(mountRidePose('seeker_board')).toBe('channel');
    expect(mountRidePose('valorsteed')).toBe('sit');
    expect(mountRidePose('')).toBe('sit');
    expect(mountRidePose('not_a_mount')).toBe('sit');
    // Dismounted: no hold of either kind, whatever the mount says.
    expect(riderPoseFlags('seeker_board', false)).toEqual({ holdCast: false, holdSit: false });
    expect(riderPoseFlags('valorsteed', true)).toEqual({ holdCast: false, holdSit: true });
  });

  it('is the only mount that asks for anything but a saddle', () => {
    const odd = Object.entries(MOUNT_VISUAL_SPECS)
      .filter(([, spec]) => spec.ridePose !== 'sit')
      .map(([key]) => key);
    expect(odd).toEqual(['seeker_board']);
  });
});

describe('Seeker board engine audio', () => {
  // mountEngine derives mount_run_<key>{_start,,_stop} and treats a mount as an
  // engine mount only when all three resolve, so a missing take degrades to
  // silence rather than to an error.
  it('ships the full windup, sustain and winddown set', () => {
    for (const suffix of ['_start', '', '_stop']) {
      const key = `mount_run_seeker_board${suffix}`;
      expect(SFX_CLIPS[key as keyof typeof SFX_CLIPS], key).toBeDefined();
    }
  });

  it('marks only the sustain take as looping, and all three as positional', () => {
    const start = SFX_CLIPS.mount_run_seeker_board_start;
    const loop = SFX_CLIPS.mount_run_seeker_board;
    const stop = SFX_CLIPS.mount_run_seeker_board_stop;
    expect(loop.loop).toBe(true);
    expect(start.loop).toBeFalsy();
    expect(stop.loop).toBeFalsy();
    for (const entry of [start, loop, stop]) expect(entry.spatial).toBe(true);
  });

  it('ships a non-empty asset for each take', () => {
    for (const suffix of ['_start', '', '_stop']) {
      const file = join(ROOT, `public/audio/sfx/mount_run_seeker_board${suffix}.mp3`);
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(2000);
    }
  });
});
