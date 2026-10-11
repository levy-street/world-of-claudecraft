// Dump the Eastbrook ferry's sim collision volumes (src/sim/content/transport_ships.ts)
// as JSON so the Blender review scene can draw them as wire boxes beside the model:
//
//   npx tsx scripts/assets/eastbrook_ferry/dump_collision.ts > tmp/ferry_collision.json
//   blender --background --python scripts/assets/eastbrook_ferry/build_eastbrook_ferry.py -- \
//       --save tmp/eastbrook_ferry.blend --collision tmp/ferry_collision.json
import { EASTBROOK_FERRY_HULL } from '../../../src/sim/content/transport_ships';

process.stdout.write(`${JSON.stringify(EASTBROOK_FERRY_HULL.volumes, null, 1)}\n`);
