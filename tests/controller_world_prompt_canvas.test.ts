import { describe, expect, it, vi } from 'vitest';
import {
  drawControllerWorldPromptBesideName,
  drawControllerWorldPromptChip,
} from '../src/render/controller_world_prompt_canvas';
import { createNameplateCanvasState } from '../src/render/nameplate_canvas';
import type { TextSpriteCache, TextSpriteStyle } from '../src/ui/text_sprite_cache';

function canvasTrace() {
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyles.push(String(value));
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      strokeStyles.push(String(value));
    },
    set lineWidth(_value: number) {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fillStyles, strokeStyles };
}

function spriteTrace() {
  const draw = vi.fn();
  const measureAdvance = vi.fn((label: string) => label.length * 8);
  return {
    text: { draw, measureAdvance } as unknown as TextSpriteCache,
    draw,
    measureAdvance,
  };
}

const nameStyle: TextSpriteStyle = {
  font: '700 12px serif',
  fill: '#fff',
  stroke: '#000',
  lineWidth: 3,
};

describe('controller world prompt canvas', () => {
  it('places the button immediately left of the existing name label', () => {
    const canvas = canvasTrace();
    const sprites = spriteTrace();
    const state = createNameplateCanvasState();
    state.name = 'Miner';

    drawControllerWorldPromptBesideName(
      canvas.ctx,
      sprites.text,
      state,
      nameStyle,
      'A',
      300,
      200,
      0,
      false,
    );

    expect(sprites.draw).toHaveBeenCalledWith(
      canvas.ctx,
      'A',
      262,
      196,
      expect.objectContaining({ fill: '#fff7d6' }),
    );
  });

  it('sizes longer brand and remap labels without hardcoded A or X geometry', () => {
    const canvas = canvasTrace();
    const sprites = spriteTrace();

    drawControllerWorldPromptChip(canvas.ctx, sprites.text, 'Triangle', 400, 300, false);

    expect(sprites.measureAdvance).toHaveBeenCalledWith(
      'Triangle',
      expect.objectContaining({ font: '800 12px Arial, sans-serif' }),
    );
    expect(canvas.ctx.moveTo).toHaveBeenCalledWith(369, 288);
  });

  it('uses only Canvas system colors under forced colors', () => {
    const canvas = canvasTrace();
    const sprites = spriteTrace();

    drawControllerWorldPromptChip(canvas.ctx, sprites.text, 'Cross', 400, 300, true);

    expect(canvas.fillStyles).toEqual(['Canvas']);
    expect(canvas.strokeStyles).toEqual(['CanvasText']);
    expect(sprites.draw).toHaveBeenCalledWith(
      canvas.ctx,
      'Cross',
      400,
      304,
      expect.objectContaining({ fill: 'CanvasText', stroke: 'Canvas' }),
    );
  });
});
