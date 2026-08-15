import { describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/render/renderer';

interface BubbleHarness {
  updateChatBubbles(): void;
}

function bubbleHarness(
  now: number,
  bubbleUntil: number,
): {
  harness: BubbleHarness;
  el: { isConnected: boolean; style: { display: string }; remove(): void };
} {
  vi.spyOn(performance, 'now').mockReturnValue(now);
  const el = {
    isConnected: true,
    style: { display: '' },
    remove(): void {
      this.isConnected = false;
    },
  };
  const renderer = Object.create(Renderer.prototype) as BubbleHarness & {
    chatBubbles: Map<number, { el: HTMLDivElement; until: number }>;
    sim: { entities: Map<number, unknown> };
    views: Map<number, unknown>;
    viewport: { width: number; height: number };
  };
  renderer.chatBubbles = new Map([
    [7, { el: el as unknown as HTMLDivElement, until: bubbleUntil }],
  ]);
  renderer.sim = { entities: new Map() };
  renderer.views = new Map();
  renderer.viewport = { width: 800, height: 600 };
  return { harness: renderer, el };
}

describe('chat bubble lifecycle', () => {
  it('keeps a live bubble while its entity or view is not drawable yet', () => {
    const { harness, el } = bubbleHarness(1000, 2000);

    harness.updateChatBubbles();

    expect(el.isConnected).toBe(true);
    expect(el.style.display).toBe('none');
  });

  it('expires a live bubble that never gets a drawable anchor', () => {
    const { harness, el } = bubbleHarness(2500, 2000);

    harness.updateChatBubbles();

    expect(el.isConnected).toBe(false);
  });
});
