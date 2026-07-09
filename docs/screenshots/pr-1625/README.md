# PR #1625 Cast Bar and Pet Feedback Screenshots

These screenshots were captured from the running local game app on this PR branch using `/play.html`, the real Vite runtime, and the actual HUD/nameplate DOM nodes. The harness used the existing repo browser pattern: `puppeteer-core`, `window.__game`, and the live offline sim.

Selectors verified before capture:

- `#castbar`
- `#tf-castbar`
- `.np-castbar`
- `#petbar`
- `.pet-btn`
- `.auto-badge`
- `.cdtext`

Desktop screenshots use a 1440x900 viewport. One mobile proof, `castbar-normal-hard-cast-mobile.png`, uses a 390x844 touch viewport. The contact sheet is assembled from the captured screenshots listed below, not from recreated CSS bars.

Runtime fixture means the state was produced inside the actual running app using the real HUD, renderer, sim state, CSS, and DOM nodes, but with controlled in-page state or event setup. It is not a standalone HTML mock.

| State | File | Source | How produced | Notes |
|---|---|---|---|---|
| Consume / Eat / Drink | [castbar-consume-eat-drink-desktop.png](./castbar-consume-eat-drink-desktop.png) | in-game | Used baked_bread and spring_water through the real sim useItem path. | Verified #castbar with channel and cast-kind-consume classes plus localized consume text. |
| Normal hard cast | [castbar-normal-hard-cast-desktop.png](./castbar-normal-hard-cast-desktop.png) | in-game | Mage cast Cinderbolt through sim.castAbility. | Verified #castbar cast-kind-cast with label, timer, and ARIA status. |
| Successful Complete | [castbar-success-complete-desktop.png](./castbar-success-complete-desktop.png) | in-game | Captured the player cast bar during the authoritative castStop success:true flash. | This is the normal cast lifecycle, not a disappearance fallback. |
| Channel | [castbar-channel-desktop.png](./castbar-channel-desktop.png) | in-game | Mage cast Aether Darts through sim.castAbility. | Verified draining channel class and visible Channeling cue. |
| Interrupted | [castbar-interrupted-desktop.png](./castbar-interrupted-desktop.png) | runtime fixture | A controlled in-page interrupt used the real effect_dispatch interrupt arm, which emitted castStop success:false. | The UI flash is driven by castStop failure metadata, not by bar disappearance. |
| Interruptible enemy cast | [target-interruptible-enemy-cast-desktop.png](./target-interruptible-enemy-cast-desktop.png) | runtime fixture | Set a live target mob to cast the real fireball ability inside the running game. | Verified #tf-castbar interruptible class and visible Interruptible cue. |
| Cannot interrupt / uninterruptible cast | [target-cannot-interrupt-desktop.png](./target-cannot-interrupt-desktop.png) | runtime fixture | Set a live target mob to the Nythraxis Deathless Rage cast id inside the running game. | Verified #tf-castbar uninterruptible class and visible Cannot interrupt cue. |
| Important / Danger cast | [target-important-danger-cast-desktop.png](./target-important-danger-cast-desktop.png) | runtime fixture | Used the same live target Deathless Rage cast, which castBarState marks important. | Verified important class and visible Danger cue. |
| Nameplate cast states | [nameplate-cast-states-desktop.png](./nameplate-cast-states-desktop.png) | runtime fixture | Captured the renderer-created nameplate for the same live target cast. | Verified .np-castbar classes and overflow-protected cue text on the actual nameplate DOM. |
| Pet cast / pet action | [pet-cast-action-desktop.png](./pet-cast-action-desktop.png) | in-game | Warlock summoned a real demon, damaged it, then used the real Heal Demon pet action. | Verified #castbar cast-source-pet with Pet and Channeling cues. |
| Pet Cooldown | [pet-cooldown-desktop.png](./pet-cooldown-desktop.png) | in-game | Hunter tamed a real pet, targeted a hostile mob, then used petTaunt. | Verified #petbar .pet-btn cooldown class, action label, seconds text, title, and ARIA context. |
| Pet Autocast Cooldown | [pet-autocast-cooldown-desktop.png](./pet-autocast-cooldown-desktop.png) | in-game | Enabled real pet auto-taunt while Taunt was cooling down from petTaunt. | Verified AUTO badge plus cooldown text and contextual ARIA. |
| Pet Autocast Ready | [pet-autocast-ready-desktop.png](./pet-autocast-ready-desktop.png) | in-game | Advanced the real sim timer until Taunt was ready while auto-taunt stayed enabled. | Verified AUTO badge remains visible without cooldown class or cooldown text. |
| Normal hard cast (mobile) | [castbar-normal-hard-cast-mobile.png](./castbar-normal-hard-cast-mobile.png) | in-game | Mage cast Cinderbolt through sim.castAbility on the mobile touch viewport. | Mobile selector check verified #castbar is readable with label, timer, and ARIA. |
| Failed | not captured | not naturally reachable | No real gameplay source distinct from interrupted was found in this pass. | CastBarPainter supports outcome-failed, but SimEvent.castStop currently carries success:boolean and maps success:false to Interrupted. |

## Notes

- `Complete` was captured from the normal cast lifecycle after an authoritative `castStop success:true`.
- `Interrupted` was captured from the real effect-dispatch interrupt arm emitting `castStop success:false`, but the interrupt ability itself was controlled by the harness, so it is labeled runtime fixture.
- `Failed` was not captured. In this branch the UI painter/core supports an `outcome-failed` class, but the gameplay event stream found in this pass exposes `castStop success:boolean`, with `success:false` mapped to Interrupted.
- The pet cooldown/autocast screenshots are from a real tamed hunter pet and the real pet command cooldown path.
