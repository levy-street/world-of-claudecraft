import { describe, expect, it } from 'vitest';
import { createLandingThemeAudio, type ThemeAudioContextLike } from '../src/game/landing_theme';

interface FakeContextOptions {
  resume?: () => Promise<void>;
  wireThrows?: boolean;
}

function makeFakeContext(opts: FakeContextOptions = {}) {
  const connected: unknown[] = [];
  const wired: HTMLAudioElement[] = [];
  const ctx: ThemeAudioContextLike = {
    destination: { id: 'destination' },
    resume: opts.resume ?? (() => Promise.resolve()),
    createMediaElementSource(el: HTMLAudioElement) {
      if (opts.wireThrows) throw new Error('already wired');
      wired.push(el);
      return {
        connect(node: unknown) {
          connected.push(node);
          return node;
        },
      };
    },
  };
  return { ctx, connected, wired };
}

const el = () => ({ tag: 'audio' }) as unknown as HTMLAudioElement;

describe('landing theme WebAudio routing', () => {
  it('creates one context and wires the element into it exactly once', async () => {
    const fake = makeFakeContext();
    let created = 0;
    const theme = createLandingThemeAudio(() => {
      created++;
      return fake.ctx;
    });
    const element = el();
    await theme.prepare(element);
    await theme.prepare(element);
    expect(created).toBe(1);
    expect(fake.wired).toEqual([element]);
    expect(fake.connected).toEqual([fake.ctx.destination]);
  });

  it('resolves only after the routed context resumes, so playback is never routed into a suspended graph', async () => {
    let release: () => void = () => {};
    const fake = makeFakeContext({
      resume: () => new Promise<void>((resolve) => (release = resolve)),
    });
    const theme = createLandingThemeAudio(() => fake.ctx);
    let ready = false;
    const pending = theme.prepare(el()).then(() => (ready = true));
    await Promise.resolve();
    expect(ready).toBe(false);
    release();
    await pending;
    expect(ready).toBe(true);
  });

  it('rejects while autoplay still blocks the context, keeping the caller gesture retry armed', async () => {
    let calls = 0;
    const fake = makeFakeContext({
      resume: () => {
        calls++;
        return calls === 1 ? Promise.reject(new Error('blocked')) : Promise.resolve();
      },
    });
    const theme = createLandingThemeAudio(() => fake.ctx);
    const element = el();
    await expect(theme.prepare(element)).rejects.toThrow('blocked');
    await expect(theme.prepare(element)).resolves.toBeUndefined();
    expect(fake.wired).toEqual([element]); // wired once, not re-wired by the retry
  });

  it('falls back to plain playback when the context factory throws (Node, stubbed browsers)', async () => {
    let created = 0;
    const theme = createLandingThemeAudio(() => {
      created++;
      throw new Error('no AudioContext');
    });
    await expect(theme.prepare(el())).resolves.toBeUndefined();
    await expect(theme.prepare(el())).resolves.toBeUndefined();
    expect(created).toBe(1); // failure latches; no per-gesture creation storm
  });

  it('still resolves via resume when element wiring throws, leaving plain playback intact', async () => {
    const fake = makeFakeContext({ wireThrows: true });
    const theme = createLandingThemeAudio(() => fake.ctx);
    await expect(theme.prepare(el())).resolves.toBeUndefined();
    expect(fake.wired).toEqual([]);
  });

  it('imports cleanly and defaults without touching AudioContext until prepare()', () => {
    // Constructing with the default factory must not throw under plain Node
    // (no AudioContext global); creation is deferred to the first prepare().
    expect(() => createLandingThemeAudio()).not.toThrow();
  });
});
