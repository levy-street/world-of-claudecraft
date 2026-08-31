<!-- Generated from tests/movement_latency_baseline.test.ts (BASELINE).
     Regenerate with UPDATE_MOVEMENT_BASELINE_DOC=1 npx vitest run
     tests/movement_latency_baseline.test.ts; never hand-edit. -->

# Movement latency baseline (v0.41.0)

What the online client DRAWS for the local player, scored against the
zero-latency authoritative trajectory for the same intent timeline.
Yards and yards per second; back = backward steps, dev = path deviation,
prog = along-path progress error, corr = correction events.

The three crowd-control rows are scored against the harness server's OWN
ticks instead: the zero-latency twin never receives the aura, so its
trajectory would be a fiction to compare against.
Their measured replay counts pin designed override absorption; all other
cells retain the strict zero-replay target.

| cell | back n | back worst | dev max | dev mean | prog max | prog settle | speed err | speed delta | corr | input-authority max ms | input-authority mean ms | replay events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| straight run + stop @ 0 ms | 0 | 0.0000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0 | 50.0 | 39.0 | 0 |
| straight run + stop @ 50 ms | 0 | 0.0000 | 0.000 | 0.000 | 0.097 | 0.000 | 0.00 | 0.00 | 0 | 66.7 | 66.7 | 0 |
| straight run + stop @ 150 ms + 20 jitter | 0 | 0.0000 | 0.000 | 0.000 | 0.136 | 0.000 | 0.00 | 0.00 | 0 | 100.0 | 100.0 | 0 |
| straight run + stop @ 300 ms + 40 jitter | 0 | 0.0000 | 0.000 | 0.000 | 0.082 | 0.000 | 0.00 | 0.00 | 0 | 216.7 | 216.7 | 0 |
| curved steering @ 0 ms | 0 | 0.0000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0 | 50.0 | 39.0 | 0 |
| curved steering @ 50 ms | 0 | 0.0000 | 0.000 | 0.000 | 0.097 | 0.000 | 0.01 | 0.01 | 0 | 66.7 | 66.7 | 0 |
| curved steering @ 150 ms + 20 jitter | 0 | 0.0000 | 0.000 | 0.000 | 0.136 | 0.000 | 0.01 | 0.01 | 0 | 100.0 | 100.0 | 0 |
| curved steering @ 300 ms + 40 jitter | 0 | 0.0000 | 0.000 | 0.000 | 0.082 | 0.000 | 0.01 | 0.01 | 0 | 216.7 | 216.7 | 0 |
| strafe weave @ 0 ms | 0 | 0.0000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0 | 50.0 | 39.0 | 0 |
| strafe weave @ 50 ms | 0 | 0.0000 | 0.000 | 0.000 | 0.097 | 0.000 | 0.00 | 0.00 | 0 | 66.7 | 66.7 | 0 |
| strafe weave @ 150 ms + 20 jitter | 0 | 0.0000 | 0.000 | 0.000 | 0.136 | 0.000 | 0.00 | 0.00 | 0 | 100.0 | 100.0 | 0 |
| strafe weave @ 300 ms + 40 jitter | 0 | 0.0000 | 0.000 | 0.000 | 0.082 | 0.000 | 0.00 | 0.00 | 0 | 216.7 | 216.7 | 0 |
| run with jump @ 0 ms | 0 | 0.0000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0 | 50.0 | 39.0 | 0 |
| run with jump @ 50 ms | 0 | 0.0000 | 0.000 | 0.000 | 0.097 | 0.000 | 0.00 | 0.00 | 0 | 66.7 | 66.7 | 0 |
| run with jump @ 150 ms + 20 jitter | 0 | 0.0000 | 0.000 | 0.000 | 0.136 | 0.000 | 0.00 | 0.00 | 0 | 100.0 | 100.0 | 0 |
| run with jump @ 300 ms + 40 jitter | 0 | 0.0000 | 0.000 | 0.000 | 0.082 | 0.000 | 0.00 | 0.00 | 0 | 216.7 | 216.7 | 0 |
| start-stop tapping @ 0 ms | 0 | 0.0000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.00 | 0.00 | 0 | 50.0 | 40.3 | 0 |
| start-stop tapping @ 50 ms | 0 | 0.0000 | 0.000 | 0.000 | 0.097 | 0.000 | 0.00 | 0.00 | 0 | 66.7 | 66.7 | 0 |
| start-stop tapping @ 150 ms + 20 jitter | 0 | 0.0000 | 0.000 | 0.000 | 0.136 | 0.000 | 0.00 | 0.00 | 0 | 100.0 | 100.0 | 0 |
| start-stop tapping @ 300 ms + 40 jitter | 0 | 0.0000 | 0.000 | 0.000 | 0.082 | 0.000 | 0.00 | 0.00 | 0 | 216.7 | 216.7 | 0 |
| HOL stall 500 ms mid-run | 0 | 0.0000 | 0.000 | 0.000 | 0.136 | 0.000 | 0.00 | 0.00 | 0 | 100.0 | 100.0 | 0 |
| server stun mid-run | 24 | -0.1979 | 0.000 | 0.000 | 1.399 | 0.000 | 14.32 | 13.83 | 14 | 100.0 | 100.0 | 1 |
| server snare mid-run | 9 | -0.1982 | 0.000 | 0.000 | 1.177 | 0.000 | 14.07 | 13.90 | 9 | 100.0 | 100.0 | 2 |
| server stun apply and expire twice | 42 | -0.1974 | 0.000 | 0.000 | 1.392 | 0.000 | 14.23 | 13.85 | 30 | 100.0 | 100.0 | 2 |
| straight run + stop @ 300 ms + 20 jitter | 0 | 0.0000 | 0.000 | 0.000 | 0.056 | 0.000 | 0.00 | 0.00 | 0 | 183.3 | 183.3 | 0 |

## Facing baseline

| cell | post-release max rad/s | reversals | continuity samples | camera split rad | camera samples | terminal rad | settle samples |
| --- | --- | --- | --- | --- | --- | --- | --- |
| turn tap while idle @ 0 ms | 0.0000 | 0 | 61 | 0.0000 | 90 | 0.0000 | 1 |
| turn tap while idle @ 150 ms + 20 jitter | 0.0000 | 0 | 61 | 0.0000 | 90 | 0.0000 | 1 |
| turn tap while walking @ 0 ms | 0.0000 | 0 | 67 | 0.0000 | 108 | 0.0000 | 1 |
| turn tap while walking @ 150 ms + 20 jitter | 0.0000 | 0 | 67 | 0.0000 | 108 | 0.0000 | 1 |
| mouselook drag + release @ 0 ms | 0.0000 | 0 | 62 | 0.0000 | 96 | 0.0000 | 1 |
| mouselook drag + release @ 150 ms + 20 jitter | 0.0000 | 0 | 62 | 0.0000 | 96 | 0.0000 | 1 |
