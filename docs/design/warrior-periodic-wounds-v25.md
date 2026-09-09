# Warrior periodic wounds â€” v25

Gaping Wounds was restarting the Warrior's native weapon swing on each damage tick, even with auto-attacks stopped. The accompanying generic physical particles also read as pale sparks. Periodic damage now makes a short red incision on the recipient and leaves the caster's current animation alone. Anonymous physical Warrior tick events use blood droplets; other classes retain their existing route.

The incision also plays on the final tick after the aura disappears. It does not add another target hit stop, screen shake or primary attack sequence. Health changes, damage amounts, timing and combat text still come from the original simulation events.

## Evidence

[Before and after records](../screenshots/warrior-wounds-v25/proof.json) preserve matching Ultra Studio captures, source hashes and the real Maiming Strike take. Both versions produce two 22-damage Gaping Wounds ticks. At 3.20 and 6.10 seconds the before take restarts `2H_Melee_Attack_Chop`; the after take remains `Idle`, with auto-attacks disabled throughout. The primary Maiming Strike animation still plays normally.

Focused ownership and anatomical-contact tests cover the event routes, the last-tick response, caster animation suppression, and the absence of another hold. Separate whole-kit visual, quality, terrain and sustained-casting reviews remain open; this correction is not Warrior's final art approval.

The [current confirmation](../screenshots/warrior-wounds-v25/current.json) repeats both idle-caster ticks with the death-safe Warrior identity route. Its complete capture shard has no reported errors, missing assets or browser console errors. The focused test also retains blood droplets after the caster dies.
