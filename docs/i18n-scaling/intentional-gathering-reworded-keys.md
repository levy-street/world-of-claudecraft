# Intentional gathering reworded guide keys

The intentional gathering source-composition change rewords existing English
Guide values. Translation status cannot detect this kind of drift, so the next
maintainer locale pass must review and refill every key below.

| Existing key | Why every locale needs a fresh translation |
|---|---|
| `guide.profPages.specimenBody` | Removes the obsolete same-signer room and lost-signature rule; keeps distinct specimen overflow. |
| `guide.profPages.specimenBodyFamilies` | Applies the same correction to the live five-specimen-family wording. |
| `guide.profPages.econ.provenanceBody` | Separates gatherer attribution from premium signing, explains mixed-source stacks, bounded tooltip display, the full Sources dialog, grouping, and specimen overflow. |
| `guide.profPages.faq.a1` | Replaces strict same-signer material stacking with descriptor-preserving mixed-source stacking and grouping behavior. |
| `guide.profPages.faq.a4` | Keeps the windfall and premium benefit constants while removing the obsolete identical-signer slot claim. |
| `guide.interfacePage.lootBody` | Corrects the ordinary-loot paragraph (the interact key collects at once; clicking a body opens a Take Loot popup, not a click-a-line window) and replaces the loot window's retired per-component Harvest checkboxes with the Field Kit, the shared All-or-one-material harvest preference (All by default, saved on Apply, refusing rather than falling back when the chosen material is absent), and its own timed Harvest command. |
| `guide.professions.harvestBodyFamilies` | Replaces the same retired Harvest checkboxes with the Field Kit (carried, not consumed), the shared preference picker (also opened from the Professions window and a corpse's Change option), the conditional finer-grade concentration bonus, and the kill-credit priority window (the killer solo, or their party) before a body opens publicly. |
| `guide.profPages.faq.a3` | Rewrites the harvesting half of the answer for the Field Kit, the timed Harvest cast, the shared preference pick (default All, Apply-saved, no implicit fallback), the conditional finer-grade concentration bonus, and the ten-second kill-credit priority window held by the killer solo or their party ahead of first come. |

Refresh all 21 maintained locale overlays:

`cs_CZ`, `da_DK`, `de_DE`, `en_CA`, `es`, `es_ES`, `fr_CA`,
`fr_FR`, `id_ID`, `it_IT`, `ja_JP`, `ko_KR`, `nl_NL`, `pl_PL`,
`pt_BR`, `ru_RU`, `sv_SE`, `tr_TR`, `vi_VN`, `zh_CN`, and `zh_TW`.

This registry records required release work only. It does not claim that any
translation is current. Inherited regional overlays still need maintainer
review against their parent or English source.
