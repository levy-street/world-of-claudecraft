# Mob portrait manifest bootstrap review

The schema-v2 source manifest was bootstrapped only after a no-write render of all 230
live mob portrait jobs was compared with every committed `public/ui/mobs/*.webp` output.
That audit found 25 byte-identical outputs and 205 encoder/render differences. Reviewers
examined the eight largest pixel differences. Three were obsolete identities caused by
model or visual-manifest changes (`cindraleth_maw_matriarch`, `grubjaw`, and
`the_wreck_warden`) and were rerendered twice with byte-identical results. The other five
largest differences were the same Wildheart identities with acceptable pose/view drift.

The same sweep identified three escort NPC portraits that still shared an old generic
villager tint. Those portraits (`gravedigger_mosley`, `castaway_navigator`, and
`fisher_bram`) were rerendered twice with distinct live entity tints. Twelve earlier
family/model corrections were also rerendered repeatedly. Exact commands, resolved
inputs, before/after hashes, and repeatability results for all 18 accepted corrections
are recorded in `portrait-rerender-evidence.json`; labeled before/after review sheets are
tracked under `docs/screenshots/placeholder-art-completion-2026-08-09/`.

This document authorizes the one-time schema-v1 to schema-v2 migration. Later manifest
writes cannot use it as a bypass: the real renderer must emit a receipt covering every
new or changed source/output row, and a renderer-contract change requires receipts for
all 230 rows.
