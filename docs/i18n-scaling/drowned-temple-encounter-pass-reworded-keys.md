# Drowned Temple encounter pass: reworded keys

The Drowned Temple encounter pass replaces the Pearlguard Sentinel's clam golem
with a sacred manta ray (display only; the id `pearlguard_sentinel` is frozen)
and rewords three existing English values. Translation status cannot detect
this kind of drift, so the next maintainer locale pass must review and refill
every key below in the Latin locales. The five non-Latin locales (`ja_JP`,
`ko_KR`, `ru_RU`, `zh_CN`, `zh_TW`) were refilled in the same change.

| Existing key | Why the Latin locales need a fresh translation |
|---|---|
| `entities.mobs.pearlguard_sentinel.name` | "Pearlguard Sentinel" became "Moonmantle Ray": the mob is now a manta, so the old sentinel names are wrong. |
| `abilityUi.cast.temple_pearl_slam` | The cast bar "Pearl Slam" became "Tidal Wingbeat" (the manta brings its wings down). |
| `dungeonGuide.drownedTemple.sight.sentinel` | Laverock's line now speaks of the moon rays of the gate pools instead of offering clams. |

Refresh these Latin locale overlays:

`cs_CZ`, `da_DK`, `de_DE`, `en_CA`, `es`, `es_ES`, `fr_CA`,
`fr_FR`, `id_ID`, `it_IT`, `nl_NL`, `pl_PL`, `pt_BR`, `sv_SE`,
`tr_TR`, and `vi_VN`.

The pass also adds English-only sim matcher rows in `src/ui/sim_i18n.ts` (the
Combined Breath, the moon's call, and the manta's renamed moves, the
`mechanic.temple*` and `aura.temple*` keys added beside
`log.drownedTempleHydraRegrows`); like the Temple's earlier mechanic rows they
have no locale fills yet.

This registry records required release work only. It does not claim that any
translation is current.
