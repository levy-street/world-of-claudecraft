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

export function withMeleeContact<T extends object>(fake: T): T {
  const r = fake as unknown as ContactFakeParts;
  Object.assign(fake, {
    contactQueue: new ContactQueue(),
    lastSyncStart: 0,
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
