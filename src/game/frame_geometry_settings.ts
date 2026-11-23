/** Frame settings share one CSS publication path, including layout imports and resets. */
const FRAME_GEOMETRY_PROPERTIES: Record<string, readonly [string, string]> = {
  playerFrameScale: ['--player-frame-scale', ''],
  targetFrameScale: ['--target-frame-scale', ''],
  playerFrameWidth: ['--player-frame-width', 'px'],
  playerFrameHeight: ['--player-frame-height', 'px'],
  targetFrameWidth: ['--target-frame-width', 'px'],
  targetFrameHeight: ['--target-frame-height', 'px'],
  petFrameWidth: ['--pet-frame-width', 'px'],
  petFrameHeight: ['--pet-frame-height', 'px'],
  focusTarget1Width: ['--focus-target-1-width', 'px'],
  focusTarget1Height: ['--focus-target-1-height', 'px'],
  focusTarget2Width: ['--focus-target-2-width', 'px'],
  focusTarget2Height: ['--focus-target-2-height', 'px'],
  focusTarget3Width: ['--focus-target-3-width', 'px'],
  focusTarget3Height: ['--focus-target-3-height', 'px'],
  playerFrameResourceWidth: ['--player-resource-width', 'px'],
  playerFrameResourceHeight: ['--player-resource-height', 'px'],
  // Frame appearance rides the same publication path: one root var per setting.
  hillBarOpacity: ['--hill-bar-opacity', ''],
};

export function applyFrameGeometrySetting(
  style: Pick<CSSStyleDeclaration, 'setProperty'>,
  key: string,
  value: number,
): boolean {
  const property = FRAME_GEOMETRY_PROPERTIES[key];
  if (!property) return false;
  style.setProperty(property[0], String(value) + property[1]);
  return true;
}
