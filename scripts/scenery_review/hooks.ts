// Research-only additional Rollup entry. Shared module instances with the app;
// no production source edits. These controls are invoked outside timed windows.

import { sharedFrameCadence } from '../../src/game/frame_cadence_wiring';
import { shaderWarmupStats } from '../../src/game/shader_cache_warmup';
import { setDayNightPhaseOverride } from '../../src/render/day_night_clock';
import { gfxInternalsForTest } from '../../src/render/gfx';
import { sceneryDetailSnapshot } from '../../src/render/scenery_detail';

Object.assign(window, {
  __lowPresetHelpers: { overrideSettings: gfxInternalsForTest.overrideSettings },
  __celProductionHelpers: { setDayNightPhaseOverride, shaderWarmupStats, sharedFrameCadence },
  __sceneryDetailSnapshot: sceneryDetailSnapshot,
});
