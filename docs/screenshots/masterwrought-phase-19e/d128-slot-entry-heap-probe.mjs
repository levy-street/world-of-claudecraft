// D128 memory probe, take 2: retained heap per entry for each cache-entry shape, entries
// held in a plain array after a forced GC (median of 5), reported per entry and as the
// four-slot minus two-field difference. Strings are shared so only the entry object counts.
const N = 200000;
const v = (i) => 'value' + (i % 97);
const shapes = {
  twoField: (i) => ({ kind: 'text', value: v(i) }),
  fourSlotNull: (i) => ({ text: v(i), display: null, transform: null, width: null }),
  perElementMap: (i) => new Map([['text', v(i)]]),
};
function once(make) { global.gc(); global.gc(); const b = process.memoryUsage().heapUsed; const arr = new Array(N); for (let i = 0; i < N; i++) arr[i] = make(i); global.gc(); global.gc(); const a = process.memoryUsage().heapUsed; const bytes = (a - b) / N; arr.length = 0; return bytes; }
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const out = {};
for (const [name, make] of Object.entries(shapes)) out[name] = med(Array.from({ length: 5 }, () => once(make)));
out.arraySlotOverhead = 'included (same for all shapes)';
out.fourMinusTwo = (out.fourSlotNull - out.twoField).toFixed(1);
for (const k of ['twoField', 'fourSlotNull', 'perElementMap']) out[k] = out[k].toFixed(1);
console.log(JSON.stringify(out));
