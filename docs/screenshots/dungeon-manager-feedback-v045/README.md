# Dungeon playtest feedback: Wildheart corpses, Sanctum scenery, exits and alerts

Before is the integration head `a4cce65bca`; after is `fix/dungeon-manager-feedback-v045`.
Both ran the offline client on the Ultra preset at 1600x900 with a real GPU backend
(`--use-angle=d3d11`), driven with the `/dev` dungeon commands, captured with puppeteer
and resized to 1280 wide.

## Wildheart Basin: how the trolls lie when they die

The Vineclaw Stalker, Bloodmane Ravager and Sunbone Hexcaller fell from their bind pose
and lay in a T. Their death clip now starts from each rig's own Idle and keys every joint.
Measured on the live skeletons (the upper arm's direction against the torso's: 0 is a T,
-1 is an arm lying along the body):

| Rig | Before, left / right | After, left / right |
| --- | --- | --- |
| Vineclaw Stalker | 0.02 / -0.22 | -0.98 / -0.99 |
| Bloodmane Ravager | -0.27 / -0.30 | -0.98 / -0.99 |
| Sunbone Hexcaller | 0.09 / -0.12 | -0.98 / -0.99 |

A corpse seen dying and a corpse already dead when it comes into view give the same
numbers after the change.

| | Before | After |
| --- | --- | --- |
| Stalker, died in view | ![before](before-wildheart-stalker-died-in-view.jpg) | ![after](after-wildheart-stalker-died-in-view.jpg) |
| Ravager, found dead | ![before](before-wildheart-ravager-found-dead.jpg) | ![after](after-wildheart-ravager-found-dead.jpg) |
| Hexcaller, found dead | ![before](before-wildheart-hexcaller-found-dead.jpg) | ![after](after-wildheart-hexcaller-found-dead.jpg) |

The Fanglord Beastmaster and Zulgar are not in this change: both now wear their art-guide
bodies, which carry their own authored deaths.

## Gravewyrm Sanctum scenery

| | Before | After |
| --- | --- | --- |
| Frost terrace: shallow fractures break up the flat snow | ![before](before-sanctum-frost-terrace.jpg) | ![after](after-sanctum-frost-terrace.jpg) |
| Anchor chain: bends over the lip and hangs into the crevasse | ![before](before-sanctum-anchor-chain.jpg) | ![after](after-sanctum-anchor-chain.jpg) |
| Chain bridge, gates open: a continuous ice deck over the links | ![before](before-sanctum-chain-bridge.jpg) | ![after](after-sanctum-chain-bridge.jpg) |

## Velkhar's ward

The ramp down to Velkhar drops from the works' floor to the vault's between 78 and 88 yd
north of the instance centre. The Vault Ward stood at 85, most of the way down, so anyone
still on the ramp when the fight sealed was outside it. It now stands at 78, on the lip.

| Before | After |
| --- | --- |
| ![before](before-sanctum-vault-ward.jpg) | ![after](after-sanctum-vault-ward.jpg) |

## Korzul's exit portal

Before, the exit opened on the Shore of the Held at instance-local (-14, 138), as the
generic stone door arch. After, it opens on the lake's permanent rock rim at (-42, 192),
beside the fight, as an upright frost opening. In both builds stepping into it put the
player back outside the Sanctum, alive.

| Before | After |
| --- | --- |
| ![before](before-sanctum-exit-portal.jpg) | ![after](after-sanctum-exit-portal.jpg) |

![after, from above the rim](after-sanctum-exit-portal-wide.jpg)

## Dungeon alerts

Forty-seven alert and prompt lines now lead with the action and name its consequence.
Three caught in live fights (top strip before, bottom strip after):

![Lockbound](alert-sanctum-lockbound.jpg)
![Chain Flail](alert-sanctum-flail.jpg)
![Stalked](alert-wildheart-stalked.jpg)

In the HUD:

![after](after-alert-in-game.jpg)

### Locale follow-up

These are rewordings of existing English keys in `src/ui/i18n.catalog/hud_chrome.ts`, so
the status registry does not mark them pending. The five non-Latin overlays (`zh_CN`,
`zh_TW`, `ja_JP`, `ko_KR`, `ru_RU`) still hold translations of the old wording and need a
maintainer pass over these keys:

- `hudChrome.bastionChain`: `shackledLine`, `strainedLine`
- `hudChrome.bastionAlert`: `reapedLine`, `veilLine`, `shadeLine`
- `hudChrome.wildheartAlert`: `preyLine`, `preyWaitLine`, `stalkedLine`, `pollinatedLine`,
  `bondLine`
- `hudChrome.sanctumAlert`: `quenchLine`, `plungeLine`, `descentLine`, `eyeLine`,
  `eyeCrackedLine`, `flailLine`, `chargeLine`, `trenchLine`, `strainLine`, `infernoLine`,
  `stompLine`, `breathLine`, `maulLine`, `tailLine`, `meltwaterTitle`, `meltwaterLine`,
  `meltwaterTargetLine`, `crackedLine`, `flightLine`, `lockboundLine`, `brandedLine`,
  `rimeLine`, `slabLine`
- `hudChrome.cryptAlert`: `measuredLine`, `embracedLine`, `lamentShelteredLine`,
  `lamentOpenLine`, `tollLine`, `harmonyLine`, `graspLine`, `reapLine`, `riteLine`,
  `riteNamedLine`, `soulLine`
- `hudChrome.kitUse`: `toppleLine`, `relightLine`, `relightUsingLine`
