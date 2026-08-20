// One answer to "did the page ask for shader diagnostics", for every WebGL
// context this client mints.
//
// Three's default `debug.checkShaderErrors = true` issues getShaderInfoLog /
// getProgramInfoLog / LINK_STATUS on a program's first use: a synchronous
// GPU-process round trip that blocks until the driver has finished the link.
// The world renderer has turned it off since it measured 25% of main-thread
// time on a zone-streaming walk, but the secondary contexts (character
// preview, portrait rig, armory preview) kept three's default and paid it on
// every first draw of a preview. Same switch, so a shader author who opts back
// in with ?shaderdebug gets the logs from all of them at once.
//
// Reads location per call rather than at module load: the three call sites run
// at context creation, not per frame, and a headless host without a location
// must answer false rather than throw.

export function shaderDebugRequested(): boolean {
  try {
    if (typeof location === 'undefined') return false;
    return new URLSearchParams(location.search).has('shaderdebug');
  } catch {
    return false;
  }
}
