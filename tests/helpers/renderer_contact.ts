import { ContactQueue } from '../../src/render/contact_queue';

// A hand-built Renderer fake (a plain object, or Object.create(Renderer.prototype) with its
// fields set by hand) never runs the constructor, so it lacks the blade-contact fields the
// melee arm of Renderer.handleEvent reads (contact_queue.ts, melee_contact_present.ts). This
// gives it both, wired to the fake's own triggerHit / vfx / views, which is what the real
// constructor wires them to.

interface ContactFakeParts {
  views?: Map<number, unknown>;
  activeVisual?: (view: unknown) => unknown;
  triggerHit?: (id: number) => void;
  vfx?: { meleeSpark?: (id: number, crit: boolean) => void };
  sim?: { playerId?: number };
}

/**
 * The `atContact` of a renderer fake for a HUD harness with no blade to wait for: the real
 * seam's at-once arm (Renderer.atContact over ContactQueue.atContact), which runs the caller's
 * method ON the caller, with the event. The hud hands its method and itself over instead of a
 * closure per event, so a fake that calls `fn()` bare would run it detached from its object.
 */
export function contactAtOnce<E>(ev: E, fn: (this: unknown, ev: E) => void, self: unknown): void {
  fn.call(self, ev);
}

export function withMeleeContact<T extends object>(fake: T): T {
  const r = fake as unknown as ContactFakeParts;
  Object.assign(fake, {
    contactQueue: new ContactQueue(),
    meleeContactHost: {
      targetVisual: (id: number) => {
        const view = r.views?.get(id);
        return view && r.activeVisual ? r.activeVisual(view) : null;
      },
      triggerHit: (id: number) => r.triggerHit?.(id),
      meleeSpark: (id: number, crit: boolean) => r.vfx?.meleeSpark?.(id, crit),
      playerId: () => r.sim?.playerId ?? 0,
      reducedMotion: () => false,
    },
  });
  return fake;
}
