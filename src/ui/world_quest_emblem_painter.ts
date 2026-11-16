// The circular world-quest emblem, shared by the per-zone map painter and the
// continent overview painter so both levels draw the same mark. An available
// quest is blue with a dark center and a four-point star; an active quest
// switches to the gold/bright completion grammar with a check. The caller owns
// the size (the continent draws it a little smaller) and resolves the colors.

const WORLD_QUEST_BADGE_INNER_RATIO = 0.62;
const WORLD_QUEST_STAR_RADIUS_RATIO = 0.72;
const WORLD_QUEST_STAR_CORNER_RATIO = 0.34;
const WORLD_QUEST_CHECK_WIDTH_RATIO = 0.22;
const WORLD_QUEST_CHECK_MIN_WIDTH = 2;

/** The resolved --color-map-* values the emblem reads. */
export interface WorldQuestEmblemColors {
  readonly questBadgeFill: string;
  readonly questBadgeText: string;
  readonly worldQuestAvailable: string;
  readonly player: string;
  readonly outline: string;
}

export interface WorldQuestEmblemMarker {
  readonly mx: number;
  readonly my: number;
  readonly state: 'available' | 'active';
}

/** Draw one emblem centered on the marker, `outer` px in radius. */
export function drawWorldQuestEmblem(
  ctx: CanvasRenderingContext2D,
  marker: WorldQuestEmblemMarker,
  outer: number,
  lineWidth: number,
  colors: WorldQuestEmblemColors,
): void {
  const inner = outer * WORLD_QUEST_BADGE_INNER_RATIO;
  const active = marker.state === 'active';
  ctx.fillStyle = active ? colors.questBadgeFill : colors.worldQuestAvailable;
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(marker.mx, marker.my, outer, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = active ? colors.player : colors.questBadgeText;
  ctx.beginPath();
  ctx.arc(marker.mx, marker.my, inner, 0, Math.PI * 2);
  ctx.fill();

  if (active) {
    ctx.strokeStyle = colors.questBadgeText;
    ctx.lineWidth = Math.max(WORLD_QUEST_CHECK_MIN_WIDTH, inner * WORLD_QUEST_CHECK_WIDTH_RATIO);
    ctx.beginPath();
    ctx.moveTo(marker.mx - inner * 0.55, marker.my);
    ctx.lineTo(marker.mx - inner * 0.12, marker.my + inner * 0.45);
    ctx.lineTo(marker.mx + inner * 0.62, marker.my - inner * 0.45);
    ctx.stroke();
    return;
  }

  const star = inner * WORLD_QUEST_STAR_RADIUS_RATIO;
  const corner = star * WORLD_QUEST_STAR_CORNER_RATIO;
  ctx.fillStyle = colors.worldQuestAvailable;
  ctx.beginPath();
  ctx.moveTo(marker.mx, marker.my - star);
  ctx.lineTo(marker.mx + corner, marker.my - corner);
  ctx.lineTo(marker.mx + star, marker.my);
  ctx.lineTo(marker.mx + corner, marker.my + corner);
  ctx.lineTo(marker.mx, marker.my + star);
  ctx.lineTo(marker.mx - corner, marker.my + corner);
  ctx.lineTo(marker.mx - star, marker.my);
  ctx.lineTo(marker.mx - corner, marker.my - corner);
  ctx.closePath();
  ctx.fill();
}
