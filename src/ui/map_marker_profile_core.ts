// Pure responsive policy for map/minimap marker raster sizes. The painters ask
// for the profile once per redraw, then stay on exact-size cached drawImage
// paths inside their marker loops. This deliberately uses viewport/class state,
// never layout measurement or computed style.

export type MapMarkerProfile = 'standard' | 'compact';

export interface MapMarkerProfileHost {
  readonly touch: boolean;
  readonly compact: boolean;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/** Touch landscape and the explicit compact HUD need larger backing-space art:
 * their UI chrome scales the 162px minimap down to roughly half physical size.
 * Desktop and standard portrait keep the restrained standard family. */
export function mapMarkerProfileFor(host: MapMarkerProfileHost): MapMarkerProfile {
  return mapMarkerProfileForFlags(
    host.touch,
    host.compact,
    host.viewportWidth > host.viewportHeight,
  );
}

/** Allocation-free form for the browser adapter. Hud supplies body-class
 * membership; this pure module never reaches for DOM or viewport globals. */
export function mapMarkerProfileForFlags(
  touch: boolean,
  compact: boolean,
  landscape: boolean,
): MapMarkerProfile {
  return touch && (compact || landscape) ? 'compact' : 'standard';
}
