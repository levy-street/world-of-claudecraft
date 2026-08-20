# Ignivar raid expansion concept provenance

## Generation record

| Field | Value |
|---|---|
| Tool | OpenAI built-in image generation through Codex |
| Generation date | 2026-08-18 |
| Output status | Original first-party World of ClaudeCraft design material |
| Upstream reference | `docs/design/ignivar-boss-model/reference-turnaround.png` |
| Upstream SHA-256 | `cb370c4dc1b08276cbce9cd5fe2601f1de0162cc7311e54f9c11c0ed21f180c7` |
| Third-party references | None |
| Rights | Original project concepts generated for World of ClaudeCraft |
| Redistribution | Project inclusion only, subject to the media license recorded at shipping time |

Every concept was produced by its own image generation call. The exact prompts are
preserved in [prompts.md](prompts.md). No external game image, model, logo, photograph,
or third-party concept entered the lineage.

## Accepted outputs

Hashes are SHA-256 of the exact repository PNG bytes.

| Asset input | Dimensions | Bytes | SHA-256 |
|---|---:|---:|---|
| `ignivar_ember_sentinel.png` | `1672 x 941` | `1418844` | `cabae2c86f6a4908724fefbca121d309f198331a66bc5806406cfff36155d0cf` |
| `ignivar_crucible_warden.png` | `1672 x 941` | `1506934` | `310aae74650e675d1e1a425214f7de1b6f220a701edc57f3049e38aaaa7de6c2` |
| `ignivar_cinder_artificer.png` | `1672 x 941` | `1490582` | `0673d17183a0d386bbf3a2d52b7852f130f47e489770f6ebbf44780be95723a2` |
| `varkhul_forge_master.png` | `1672 x 941` | `1688965` | `37c6f1c6ac727f6ec58327be47d2a43f68189d332ce47f212a4d4f71a816787a` |
| `varkhul_warhammer.png` | `1024 x 1536` | `1543298` | `5843ca5e825cffa7848ff8db3251ea1c98bc8b17d5fae47ca2076feae6800bab` |
| `varkhul_grand_forge.png` | `1331 x 1182` | `1972556` | `6bad83fe6efd89e450304f4f6f0724c3702acd7647c73fb6b8f9d183cb479be6` |

The original generated-image files remain in the Codex generated-images store. The
repository copies are byte-identical and are the durable Tripo inputs.

## Visual acceptance

The six outputs were inspected at original resolution and approved as the Tripo input
set on 2026-08-18. The three automata have distinct agile, defensive, and caster
silhouettes. Varkhul, the separate warhammer, and the combined forge-anvil landmark
share one material language without cloning Ignivar. The four humanoids use a neutral
T-pose with separated limbs, and Varkhul's right hand is clear for the separate hammer.

The acceptance applies to the concept images only. Each generated GLB still requires
front, side, back, hero, animation, and held-weapon preview review before integration.

The two static-object references were also checked with the installed img2threejs 1.3.0
reference-admission gate. `varkhul_warhammer.png` and `varkhul_grand_forge.png` were both
admitted with no rejection reason. The humanoid sheets follow the Asset Generator's
rigged-character lane instead of the static procedural-object workflow.

## Paid-generation status

No Tripo call was made from this worktree. At the acceptance gate, neither the process
environment nor the repository-local ignored `.env` contained `TRIPO_API_KEY`, and no
rotated credential had been confirmed. The credential posted in conversation is treated
as compromised and is not an approved input to the pipeline.

The resumable command sequence is recorded in [tripo-wave.md](tripo-wave.md). Paid work
must start with `balance`, must use the fixed job IDs in that record, and must stop for
model preview approval before local rigging or integration.
