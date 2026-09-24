# Shaman release client comparisons

Captured on 2026-09-23 using the actual offline game client and its simulation
events, not the VFX Studio. Before is release commit
`fc86d902345bc8c8387e7520b21934adeeafddac`; after is Shaman commit
`30ce5b596bb8addb9221daec02c374aa9861e52a`.

| Ability | Desktop before | Desktop after | Mobile before | Mobile after |
| --- | --- | --- | --- | --- |
| Arc Bolt | [Before](before-desktop-p4-lightning_bolt.png) | [After](after-desktop-p4-lightning_bolt.png) | [Before](before-mobile-p1-lightning_bolt.png) | [After](after-mobile-p1-lightning_bolt.png) |
| Earthen Jolt | [Before](before-desktop-p4-earth_shock.png) | [After](after-desktop-p4-earth_shock.png) | [Before](before-mobile-p1-earth_shock.png) | [After](after-mobile-p1-earth_shock.png) |
| Cinder Jolt | [Before](before-desktop-p4-flame_shock.png) | [After](after-desktop-p4-flame_shock.png) | [Before](before-mobile-p1-flame_shock.png) | [After](after-mobile-p1-flame_shock.png) |

## Capture conditions

- Desktop: 1440 x 900, graphics preset 4. Mobile: 932 x 430 landscape,
  touch emulation, graphics preset 1. Both use device scale factor 1.
- Shaman at level 20, Elemental specialization without row selections, at the
  normal Proving Shore spawn. The training dummy is five yards along positive X.
- Camera yaw `PI / 2 + 0.7`, pitch `0.42`, distance `15` in both versions.
- Real `castAbility` and 20 Hz simulation ticks supply the events to the real
  renderer. Each capture is two ticks (100 ms) after confirmed damage. No impact
  event is fabricated and no effect size, strength or lifetime is overridden.
- Background preparation is allowed to settle before sampling. The low-setting
  captures explicitly wait for the ordinary cast preparation gate. After reports
  ready with zero pending/refused programs and without forcing itself open.
  Before reaches the existing watchdog with 12 programs still pending. That
  baseline limitation is recorded rather than bypassed in the capture rig.
- These are fixed-time effect comparisons, not an input-latency or first-load
  performance benchmark. Mobile is a phone-sized browser emulation, not a
  physical-device performance measurement. Clock, incidental NPC animation and
  chat text can differ between captures.

The adjacent JSON files record viewport, real damage events, positions and
browser errors. The offline dev client reports expected unavailable API proxy
requests and transient character-asset preparation warnings. No shader compile
errors or uncaught effect exceptions were reported in these runs. GPU counters
are diagnostic snapshots; they are not normalized performance comparisons.

The new suites separately cover persistent weapon effects, party recipients,
restorative routing, the spirit-wolf gait, overload policy and resource cleanup.
These three representative impact screenshots do not claim visual coverage of
every ability or all graphics presets.
