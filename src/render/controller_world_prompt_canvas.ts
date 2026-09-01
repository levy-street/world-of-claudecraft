import type { TextSpriteCache, TextSpriteStyle } from '../ui/text_sprite_cache';
import type { NameplateCanvasState } from './nameplate_canvas';
import { NAMEPLATE_HERALDRY_TITLE_STEP } from './nameplate_heraldry_core';

const PROMPT_HEIGHT = 24;
const PROMPT_MIN_WIDTH = 24;
const PROMPT_HORIZONTAL_PADDING = 10;

const PROMPT_STYLE: TextSpriteStyle = {
  font: '800 12px Arial, sans-serif',
  fill: '#fff7d6',
  stroke: '#000',
  lineWidth: 2,
};

const FORCED_PROMPT_STYLE: TextSpriteStyle = {
  font: PROMPT_STYLE.font,
  fill: 'CanvasText',
  stroke: 'Canvas',
  lineWidth: 2,
};

export function roundedCanvasRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function controllerWorldPromptWidth(
  text: TextSpriteCache,
  buttonLabel: string,
  forcedColors: boolean,
): number {
  const style = forcedColors ? FORCED_PROMPT_STYLE : PROMPT_STYLE;
  return Math.max(
    PROMPT_MIN_WIDTH,
    Math.ceil(text.measureAdvance(buttonLabel, style)) + PROMPT_HORIZONTAL_PADDING,
  );
}

export function drawControllerWorldPromptChip(
  ctx: CanvasRenderingContext2D,
  text: TextSpriteCache,
  buttonLabel: string,
  centerX: number,
  centerY: number,
  forcedColors: boolean,
): void {
  const style = forcedColors ? FORCED_PROMPT_STYLE : PROMPT_STYLE;
  const width = controllerWorldPromptWidth(text, buttonLabel, forcedColors);
  const x = centerX - width / 2;
  const y = centerY - PROMPT_HEIGHT / 2;
  ctx.save();
  roundedCanvasRect(ctx, x, y, width, PROMPT_HEIGHT, 6);
  ctx.fillStyle = forcedColors ? 'Canvas' : '#20160d';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = forcedColors ? 'CanvasText' : '#f2d27a';
  ctx.stroke();
  text.draw(ctx, buttonLabel, centerX, centerY + 4, style);
  ctx.restore();
}

export function drawControllerWorldPromptBesideName(
  ctx: CanvasRenderingContext2D,
  text: TextSpriteCache,
  state: NameplateCanvasState,
  nameStyle: TextSpriteStyle,
  buttonLabel: string,
  screenX: number,
  screenY: number,
  heraldryLift: number,
  forcedColors: boolean,
): void {
  let bottomY = screenY;
  if (state.castVisible) bottomY -= 10;
  if (state.hpVisible) bottomY -= 7;
  if (state.guild) bottomY -= state.currentTarget ? 14 : 12;
  if (state.title) bottomY -= NAMEPLATE_HERALDRY_TITLE_STEP;
  bottomY -= heraldryLift;
  let rowHeight = state.currentTarget ? 18 : 16;
  for (const badge of state.badges) rowHeight = Math.max(rowHeight, badge.size);
  const nameWidth = text.measureAdvance(state.name, nameStyle);
  const promptWidth = controllerWorldPromptWidth(text, buttonLabel, forcedColors);
  drawControllerWorldPromptChip(
    ctx,
    text,
    buttonLabel,
    screenX - nameWidth / 2 - 6 - promptWidth / 2,
    bottomY - rowHeight / 2,
    forcedColors,
  );
}

export class ControllerWorldPromptCanvasPainter {
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly text: TextSpriteCache,
    private readonly forcedColorsMql: MediaQueryList | null,
    private readonly nameStyle: TextSpriteStyle,
    private readonly targetNameStyle: TextSpriteStyle,
  ) {}

  drawAt(buttonLabel: string, screenX: number, screenY: number): void {
    drawControllerWorldPromptChip(
      this.ctx,
      this.text,
      buttonLabel,
      screenX,
      screenY,
      this.forcedColorsMql?.matches === true,
    );
  }

  drawBesideName(
    state: NameplateCanvasState,
    buttonLabel: string,
    screenX: number,
    screenY: number,
    heraldryLift: number,
  ): void {
    drawControllerWorldPromptBesideName(
      this.ctx,
      this.text,
      state,
      state.currentTarget ? this.targetNameStyle : this.nameStyle,
      buttonLabel,
      screenX,
      screenY,
      heraldryLift,
      this.forcedColorsMql?.matches === true,
    );
  }
}
