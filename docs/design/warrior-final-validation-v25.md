# Warrior v25 validation checkpoint

The final Warrior visual review is still in progress. This checkpoint closes two
historical project-check questions; it does not claim complete AAA acceptance.

The test timing table comes from completed successful full-mode GitHub CI run
34303587318, attempt 1, merge-group commit
17cc8505c13550a3f598abdebecf2816829da7ae. All eight PR shards and both long-simulation
lanes passed. The canonical harvester returned 4,097 rows. Exactly 616 paths absent
from this older v25 checkout were excluded; the remaining 3,481 durations are
unchanged CI measurements. No historical or local rows were merged. Coverage is
3,481 of 3,618 eligible suites (96.21%), above the unchanged 94% floor. All 13 tests
in ci_shard_partition.test.ts pass. The raw harvest, exclusions and independent
run verification are retained in the adjacent studio-contact-pass evidence folder.

The canonical Eastbrook runtime-provenance remint was run after the committed
Warrior renderer integration. Every fingerprinted input matched HEAD f3a91ffe.
Only the four existing evidence seals and their derived integrity pins changed.
The frozen capture identity, screenshots and performance measurements remain
unchanged. This is a provenance reseal, not a new visual or performance capture.
Both existing Eastbrook contract and artifact-integrity suites pass.

Final whole-project gate, complete visual matrix and Warrior review delivery
remain outstanding. The gate baseline remains 85e9231a54cb5c136c9dc7965f5470b9b287d1a4.
