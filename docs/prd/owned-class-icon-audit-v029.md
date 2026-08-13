# Hunter, Shaman, and Priest icon audit

This audit covers the new ability and passive icons introduced by PR #2218 for the v0.29.0 class work.

## Result

All 43 project-generated owned-class icon IDs now use dedicated image artwork. Together with the existing painted class assets, every ability learned across the nine level-20 spellbooks resolves to painted art instead of a procedural fallback. Every project-generated file is a 128 by 128 WebP and has a provenance entry in its class mapping file.

The final completion pass replaced the remaining 12 procedural fallbacks: Volley, Hushing Shot, Howling Rage, Skybranch, Faultwake, Storm Chorus, Primal Mastery, Cascading Mend, Terror Canticle, Choirmend, Sunburst Canticle, and Gloamveil.

The artwork follows the visual language of the existing class icons:

- Hunter uses readable weapons, beasts, traps, and movement silhouettes with green, red, blue, and amber cues.
- Shaman uses elemental weapons, lightning, water, earth, and spirit silhouettes with strong spec color cues.
- Priest uses gold for healing and protection, violet for shadow magic, and clear figures or symbols for small-size readability.

The full project-generated icon sheet is [pr-2218-owned-class-icons.png](../screenshots/pr-2218-owned-class-icons.png).

## Icon inventory

### Hunter

1. Pack Command
2. Stampede
3. Unleash Beast
4. Measured Shot
5. Pack Rally
6. Shrapnel Charge
7. Bloodtrail Assault
8. Trailbreak
9. Wildheart
10. Shellskin
11. Frostjaw Trap
12. Cold Focus
13. Bloodhook
14. Hunting Momentum
15. Armed Re-entry
16. Volley
17. Hushing Shot
18. Howling Rage

### Shaman

1. Galeheart Weapon
2. Thunder Reservoir
3. Warspirit Cadence
4. Stormsurge
5. Lifespring Weapon
6. Unleash Weapon
7. Tidecall
8. Stoneward
9. Primal Exaltation
10. Ancestors' Return
11. Skybranch
12. Faultwake
13. Storm Chorus
14. Primal Mastery
15. Cascading Mend

Unleash Weapon is a baseline spell for Elemental, Enhancement, and Restoration. Its result comes from the active spec weapon enchant. Elemental uses Pyrebrand, Enhancement uses Galeheart or Stonebound, and Restoration uses Lifespring.

### Priest

1. Veilstep
2. Scouring Mercy
3. Seraphic Vigil
4. Call Tithefiend
5. Martyr's Aegis
6. Choir of Deliverance
7. Terror Canticle
8. Choirmend
9. Sunburst Canticle
10. Gloamveil

## Spellbook evidence

Each spellbook was captured at level 20 in both desktop and mobile-touch layouts.

| Class | Spec | Desktop | Mobile |
|---|---|---|---|
| Hunter | Packlord | [Desktop](../screenshots/pr-2218-spellbook-hunter-packlord-desktop.png) | [Mobile](../screenshots/pr-2218-spellbook-hunter-packlord-mobile.png) |
| Hunter | Coldsight | [Desktop](../screenshots/pr-2218-spellbook-hunter-coldsight-desktop.png) | [Mobile](../screenshots/pr-2218-spellbook-hunter-coldsight-mobile.png) |
| Hunter | Fieldcraft | [Desktop](../screenshots/pr-2218-spellbook-hunter-fieldcraft-desktop.png) | [Mobile](../screenshots/pr-2218-spellbook-hunter-fieldcraft-mobile.png) |
| Shaman | Thundercall | [Desktop](../screenshots/pr-2218-spellbook-shaman-thundercall-desktop.png) | [Mobile](../screenshots/pr-2218-spellbook-shaman-thundercall-mobile.png) |
| Shaman | Warspirit | [Desktop](../screenshots/pr-2218-spellbook-shaman-warspirit-desktop.png) | [Mobile](../screenshots/pr-2218-spellbook-shaman-warspirit-mobile.png) |
| Shaman | Spiritmend | [Desktop](../screenshots/pr-2218-spellbook-shaman-spiritmend-desktop.png) | [Mobile](../screenshots/pr-2218-spellbook-shaman-spiritmend-mobile.png) |
| Priest | Doctrine | [Desktop](../screenshots/pr-2218-spellbook-priest-doctrine-desktop.png) | [Mobile](../screenshots/pr-2218-spellbook-priest-doctrine-mobile.png) |
| Priest | Benison | [Desktop](../screenshots/pr-2218-spellbook-priest-benison-desktop.png) | [Mobile](../screenshots/pr-2218-spellbook-priest-benison-mobile.png) |
| Priest | Vespers | [Desktop](../screenshots/pr-2218-spellbook-priest-vespers-desktop.png) | [Mobile](../screenshots/pr-2218-spellbook-priest-vespers-mobile.png) |

The screenshots show the baseline level-20 spellbooks without talent choices allocated. Talent-granted icons that are not present in those spellbooks remain visible in the full icon sheet.

## Visual review

- Every icon has a single readable subject at spellbook size.
- The Hunter spear and movement icons share a family without becoming identical.
- The Enhancement weapon icons remain distinguishable at 34 pixels: Galeheart shows paired blades, Warspirit Cadence shows crossed weapons and cadence rings, and Stormsurge shows a single charged axe.
- Tithefiend uses five visible orbs to connect the icon to its five-stack payoff.
- No generated icon contains text, a logo, a watermark, or its own UI frame.
- Every ability learned by the nine owned specs at level 20 now resolves to painted art.

## Known gap outside PR #2218

The repository still contains 36 older Mage and Warrior icon files that are larger than the documented 128 by 128 target. They are not new to PR #2218 and were not resized here because that could change existing artwork quality. The #2218 icon-size test is deliberately scoped to the 43 owned-class files.
