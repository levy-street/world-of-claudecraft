# Heroic replacement review : integration 45

The 27 Heroic rows in the SVG replacement backlog each own a runtime file.
They are not weapon-art aliases. Preserve their separate identities and generate
one painting per row; this review does not mark any of them resolved.

Evidence: `src/ui/icons.ts` routes these non-weapons to their own IDs;
`src/sim/content/heroic_variants.ts` gives each its base item identity through
`heroicOf`. Existing dungeon provenance and generators deliberately distinguish
Heroic armor with deeper grounds, boss-colored light and extra fittings.
The Heroic Cantor’s Hymnal is open with rising violet notes; the base is closed.

Canonical existing briefs:

- `docs/achievements/lower-dungeon-blues-icons-2026-10-08/README.md`
- `docs/achievements/hollow-crypt-icons-2026-10-03/README.md`
- `docs/achievements/drowned-temple-icons-2026-09-30/README.md`

| Heroic ID | Base ID | Existing batch |
| --- | --- | --- |
| `heroic_chorus_conch` | `chorus_conch` | `drowned-temple-icons-2026-09-30` |
| `heroic_cantors_hymnal` | `cantors_hymnal` | `hollow-crypt-icons-2026-10-03` |
| `heroic_spadeworn_gauntlets` | `spadeworn_gauntlets` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_gravedirt_grips` | `gravedirt_grips` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_bellrope_mitts` | `bellrope_mitts` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_rimewreath_coif` | `rimewreath_coif` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_rime_laced_hood` | `rime_laced_hood` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_lamenting_veil` | `lamenting_veil` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_choirward_pauldrons` | `choirward_pauldrons` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_choristers_spaulders` | `choristers_spaulders` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_cantors_stole` | `cantors_stole` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_knellbound_hauberk` | `knellbound_hauberk` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_candlewatch_jerkin` | `candlewatch_jerkin` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_robe_of_the_unquiet_rite` | `robe_of_the_unquiet_rite` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_portcullis_girdle` | `portcullis_girdle` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_cellwatch_belt` | `cellwatch_belt` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_lanternwick_sash` | `lanternwick_sash` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_gaolyard_jerkin` | `gaolyard_jerkin` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_brinewarden_robe` | `brinewarden_robe` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_conchplate_sabatons` | `conchplate_sabatons` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_pale_chorus_slippers` | `pale_chorus_slippers` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_tideglass_gauntlets` | `tideglass_gauntlets` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_moonburn_grips` | `moonburn_grips` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_prism_etched_handwraps` | `prism_etched_handwraps` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_mere_crested_helm` | `mere_crested_helm` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_mereskin_hood` | `mereskin_hood` | `lower-dungeon-blues-icons-2026-10-08` |
| `heroic_merewater_cowl` | `merewater_cowl` | `lower-dungeon-blues-icons-2026-10-08` |
