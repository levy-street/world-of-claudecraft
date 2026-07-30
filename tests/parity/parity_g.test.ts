// Shard g of the golden-trace parity gate: a contiguous slice of SCENARIOS run
// through the shared runner (see run_scenarios.ts, which also documents the
// shard boundaries). The split exists purely so vitest can parallelize the
// recordings across worker files; assertions, goldens, and UPDATE_PARITY
// minting are unchanged (this shard mints only its own slice's goldens).

import { runParityShard } from './run_scenarios';

runParityShard(6);
