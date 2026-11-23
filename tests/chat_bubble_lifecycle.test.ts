import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ChatBubbleLayer } from '../src/render/chat_bubble_layer';
import { Renderer } from '../src/render/renderer';
import type { IWorld } from '../src/world_api';

// The bubble layer moved out of renderer.ts (src/render/chat_bubble_layer.ts);
// the renderer's per-frame updateChatBubbles is now forge speech plus this
// layer's update(), pinned at the bottom.
function bubbleHarness(
  now: number,
  bubbleUntil: number,
): {
  layer: ChatBubbleLayer;
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
  const sim = { entities: new Map(), worldQuestLog: new Map() } as unknown as IWorld;
  const layer = new ChatBubbleLayer({
    sim: () => sim,
    layer: () => {
      throw new Error('no new bubble expected');
    },
    camera: () => new THREE.PerspectiveCamera(),
    viewport: () => ({ width: 800, height: 600 }),
    views: () => new Map(),
  });
  layer.bubbles.set(7, { el: el as unknown as HTMLDivElement, until: bubbleUntil });
  return { layer, el };
}

describe('chat bubble lifecycle', () => {
  it('keeps a live bubble while its entity or view is not drawable yet', () => {
    const { layer, el } = bubbleHarness(1000, 2000);

    layer.update();

    expect(el.isConnected).toBe(true);
    expect(el.style.display).toBe('none');
  });

  it('expires a live bubble that never gets a drawable anchor', () => {
    const { layer, el } = bubbleHarness(2500, 2000);

    layer.update();

    expect(el.isConnected).toBe(false);
    expect(layer.bubbles.size).toBe(0);
  });

  it('is the layer the renderer ticks every frame', () => {
    const source = String(
      (Renderer.prototype as unknown as { updateChatBubbles(): void }).updateChatBubbles,
    );
    expect(source).toContain('this.chatBubbles.update()');
  });
});
