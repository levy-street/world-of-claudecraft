// Shared "is the page allowed to start audio yet" latch.
//
// Chrome's autoplay policy refuses AudioContext.resume() until the page has
// seen a real user gesture, and it logs "The AudioContext was not allowed to
// start" to the console for EVERY refused call, independently of whether the
// returned promise is caught. The music stream keeper runs on a timer and
// calls resume() per revived stream, so a session that reaches the world
// before its first gesture prints that warning dozens of times and burns a
// rejected promise each time.
//
// Skipping resume() while it provably cannot succeed is exactly equivalent:
// before the first gesture the call can only fail. Contexts asked to resume
// during that window are queued and resumed on the first gesture instead,
// which is strictly earlier than the next keeper tick would have managed.
//
// Media-engagement autoplay (a context that opens already 'running') never
// reaches the queue: a non-suspended context returns immediately.

type ResumableContext = {
  state: AudioContextState | 'interrupted';
  resume?: () => Promise<void>;
};

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

export interface AudioUnlockLatch {
  /** Resume now if allowed, otherwise queue until the first user gesture. */
  resumeWhenAllowed: (ctx: ResumableContext) => void;
  /** True once a user gesture has been observed. */
  readonly unlocked: boolean;
}

export function createAudioUnlockLatch(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null,
): AudioUnlockLatch {
  let unlocked = target === null;
  const pending = new Set<ResumableContext>();

  const resume = (ctx: ResumableContext): void => {
    void ctx.resume?.().catch(() => {
      // A resume can still be refused right after a gesture (a context created
      // in the same task, a backgrounded tab). The next gesture retries.
    });
  };

  const onGesture = (): void => {
    if (unlocked) return;
    unlocked = true;
    for (const event of GESTURE_EVENTS) target?.removeEventListener(event, onGesture, true);
    for (const ctx of pending) resume(ctx);
    pending.clear();
  };

  if (target) {
    for (const event of GESTURE_EVENTS) {
      target.addEventListener(event, onGesture, { capture: true, passive: true });
    }
  }

  return {
    resumeWhenAllowed(ctx: ResumableContext): void {
      // Already running or permanently closed: nothing to resume. WebKit's
      // interrupted state remains resumable after calls, Siri, or backgrounding.
      if (ctx.state === 'running' || ctx.state === 'closed') return;
      if (!unlocked) {
        pending.add(ctx);
        return;
      }
      resume(ctx);
    },
    get unlocked(): boolean {
      return unlocked;
    },
  };
}

const sharedLatch = createAudioUnlockLatch(typeof window === 'undefined' ? null : window);

/** Process-wide latch used by the music and SFX engines. */
export function resumeWhenAllowed(ctx: ResumableContext): void {
  sharedLatch.resumeWhenAllowed(ctx);
}
