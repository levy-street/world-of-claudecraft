'use strict';

// Pure, Node-testable helper for the GPU verdict the main process pushes to the
// renderer (tests/electron_gpu_status_events.test.ts). The renderer only ever
// receives the minimal whitelisted payload built here (never Chromium's raw
// getGPUInfo result, which carries driver paths, vendor/device ids, and a full
// adapter inventory the page has no business seeing).

// Build the payload for one 'desktop-gpu-status' IPC send. `raw` collects the
// three main-process readings: `softwareRendering` and `glRenderer` from the
// GPU process's auxAttributes, `discreteInactive` from summarizeGpuDevices, and
// `softwareVerdict` from the synchronous isSoftwareRenderer(featureStatus)
// check. Every field is coerced strictly: a truthy non-boolean from Chromium
// must not leak through as a true verdict the renderer shows a warning for.
function gpuStatusPayload(raw) {
  const adapter = typeof raw?.glRenderer === 'string' ? raw.glRenderer.slice(0, 64) : '';
  return {
    softwareRendering: raw?.softwareRendering === true || raw?.softwareVerdict === true,
    discreteInactive: raw?.discreteInactive === true,
    adapter,
  };
}

module.exports = { gpuStatusPayload };
