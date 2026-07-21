// Load sanity: hammers /api/internal/inference and reports throughput and
// latency percentiles. With the mock upstream (instant responses) this
// measures the pool's own overhead: routing, decryption, metering writes.
//
//   LOAD_N=300 LOAD_C=30 npx tsx scripts/load_sanity.mts
process.loadEnvFile('.env');

const BASE = 'http://127.0.0.1:3100';
const N = Number(process.env.LOAD_N ?? 300);
const C = Number(process.env.LOAD_C ?? 30);

async function fire(): Promise<{ ok: boolean; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/internal/inference`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': process.env.INTERNAL_SHARED_SECRET!,
    },
    body: JSON.stringify({
      purpose: 'npc_dialogue',
      gameAccountId: `acct_load_${Math.floor(Math.random() * 50)}`,
      payload: {
        model: 'llama-3.3-70b',
        messages: [{ role: 'user', content: 'Say hi.' }],
        max_tokens: 32,
      },
    }),
  });
  await res.arrayBuffer();
  return { ok: res.status === 200, ms: performance.now() - t0 };
}

for (let i = 0; i < 5; i++) await fire(); // warmup

const latencies: number[] = [];
let errors = 0;
let next = 0;
const t0 = performance.now();
await Promise.all(
  Array.from({ length: C }, async () => {
    while (next < N) {
      next++;
      const { ok, ms } = await fire();
      if (ok) latencies.push(ms);
      else errors++;
    }
  }),
);
const wallMs = performance.now() - t0;

latencies.sort((a, b) => a - b);
const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
console.log(`requests: ${N}  concurrency: ${C}  errors: ${errors}`);
console.log(`wall: ${(wallMs / 1000).toFixed(2)}s  throughput: ${(latencies.length / (wallMs / 1000)).toFixed(1)} req/s`);
console.log(`latency ms - p50: ${pct(50).toFixed(1)}  p95: ${pct(95).toFixed(1)}  p99: ${pct(99).toFixed(1)}  max: ${latencies[latencies.length - 1].toFixed(1)}`);
process.exit(errors === 0 ? 0 : 1);
