/** Authored clearings remove only named scatter, never terrain anchors or heights.
 * Both collision and rendering consume this same deterministic placement gate. */
const EXCLUSIONS = [
  // Wisp maze lawn: this ordinary tree overlaps the southeast trial corner.
  { x: 470.83139702072367, z: 1049.3634334169328 },
  { x: 430.56771796988323, z: 1058.3339893245138 },
  { x: 469.0259377551265, z: 1059.0917784823105 },
  // Wyrmroad horde lane: edge trees and a rock obscure incoming private actors.
  { x: 390.4622943964787, z: 1802.078793170862 },
  { x: 390.9927746313624, z: 1815.7276418884285 },
  { x: 411.3127885675058, z: 1812.7735601491295 },
  { x: 2.456450840458274, z: 211.33819991815835 },
  // The North Watch firing lanes: one ordinary tree obscured the middle lane.
  { x: 442.06173, z: 1003.16146 },
  // Wyrmwatch battery: rocks overlapping the firing lanes and supply crates.
  { x: 376.78737124521285, z: 1828.1877607954666 },
  { x: 378.3173164781183, z: 1840.3080333708785 },
  { x: 385.38642308069393, z: 1848.2350369272754 },
  { x: 384.4008878977038, z: 1874.3803454781882 },
  { x: 390.96715987753123, z: 1828.9928906559944 },
  { x: 395.7734629823826, z: 1831.624793476425 },
  // The relocated battery's far lane corner: two trees inside the new field.
  { x: 376.2271715174429, z: 1816.5684037525207 },
  { x: 380.44544397946447, z: 1815.2093056854792 },
  // Last Keep battery: named scatter across the firing lanes.
  { x: 368.3865608260967, z: 1924.1916371914558 },
  { x: 367.4546361025423, z: 1945.0561844334006 },
  { x: 370.69166315346956, z: 1915.294014248997 },
  { x: 375.35517376009375, z: 1926.9491909733042 },
  { x: 373.5998047152534, z: 1939.6218792777508 },
];

export function isExcludedDecoration(x: number, z: number): boolean {
  return EXCLUSIONS.some((point) => Math.hypot(x - point.x, z - point.z) < 1.2);
}

/** Road lamps kept off authored clearings, matched to the exact planned site so no
 * other road-light placement is replanned. */
const STREETLAMP_EXCLUSIONS = [
  // The private wisp maze trial.
  { x: 460.6305996347541, z: 1028.5178347589988 },
  // The North Watch battery: a Wraithwood lamp inside the east firing lane.
  { x: 400.2, z: 1817 },
];

export function isExcludedStreetlamp(x: number, z: number): boolean {
  return STREETLAMP_EXCLUSIONS.some((point) => Math.hypot(x - point.x, z - point.z) < 0.01);
}
