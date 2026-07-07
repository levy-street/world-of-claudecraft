export interface MapCanvasRenderedSize {
  width: number;
  height: number;
}

export interface MapCanvasRenderedBox {
  left?: number;
  top?: number;
  width: number;
  height: number;
  borderLeft?: number;
  borderRight?: number;
  borderTop?: number;
  borderBottom?: number;
  contentWidth?: number;
  contentHeight?: number;
}

export interface MapCanvasPoint {
  x: number;
  y: number;
}

function finitePx(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function positiveSquareFallback(canvas: HTMLCanvasElement): number {
  const size = Math.min(canvas.width, canvas.height);
  if (Number.isFinite(size) && size > 0) return size;
  const attrSize = Math.min(
    finitePx(canvas.getAttribute?.('width')),
    finitePx(canvas.getAttribute?.('height')),
  );
  return attrSize > 0 ? attrSize : 1;
}

export function mapCanvasRenderedContentSize(box: MapCanvasRenderedBox): MapCanvasRenderedSize {
  const borderLeft = finitePx(box.borderLeft);
  const borderRight = finitePx(box.borderRight);
  const borderTop = finitePx(box.borderTop);
  const borderBottom = finitePx(box.borderBottom);
  return {
    width: Math.max(0, finitePx(box.contentWidth ?? box.width - borderLeft - borderRight)),
    height: Math.max(0, finitePx(box.contentHeight ?? box.height - borderTop - borderBottom)),
  };
}

export function readMapCanvasRenderedBox(canvas: HTMLCanvasElement): Required<MapCanvasRenderedBox> {
  const rect = canvas.getBoundingClientRect();
  const style = getComputedStyle(canvas);
  const borderLeft = finitePx(style.borderLeftWidth);
  const borderRight = finitePx(style.borderRightWidth);
  const borderTop = finitePx(style.borderTopWidth);
  const borderBottom = finitePx(style.borderBottomWidth);
  const content = mapCanvasRenderedContentSize({
    width: rect.width,
    height: rect.height,
    borderLeft,
    borderRight,
    borderTop,
    borderBottom,
  });
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderLeft,
    borderRight,
    borderTop,
    borderBottom,
    contentWidth: content.width,
    contentHeight: content.height,
  };
}

export function syncMapCanvasSize(
  canvas: HTMLCanvasElement,
  rendered = mapCanvasRenderedContentSize(readMapCanvasRenderedBox(canvas)),
): number {
  const rawSize = Math.min(finitePx(rendered.width), finitePx(rendered.height));
  const size = rawSize > 0 ? Math.max(1, Math.round(rawSize)) : positiveSquareFallback(canvas);
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  return size;
}

export function mapCanvasPointFromClient(
  box: MapCanvasRenderedBox,
  clientX: number,
  clientY: number,
  canvasSize: number,
): MapCanvasPoint {
  const content = mapCanvasRenderedContentSize(box);
  const contentWidth = content.width > 0 ? content.width : canvasSize;
  const contentHeight = content.height > 0 ? content.height : canvasSize;
  const x = ((clientX - finitePx(box.left) - finitePx(box.borderLeft)) * canvasSize) / contentWidth;
  const y = ((clientY - finitePx(box.top) - finitePx(box.borderTop)) * canvasSize) / contentHeight;
  return { x, y };
}

export function mapCanvasPointFromEvent(
  canvas: HTMLCanvasElement,
  event: Pick<PointerEvent, 'clientX' | 'clientY'>,
  canvasSize = canvas.width,
): MapCanvasPoint {
  return mapCanvasPointFromClient(
    readMapCanvasRenderedBox(canvas),
    event.clientX,
    event.clientY,
    canvasSize,
  );
}
