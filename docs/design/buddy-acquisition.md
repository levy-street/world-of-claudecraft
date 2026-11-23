# Buddy companions: acquisition

The active roster is Tug, the Warhorse, Crystal Lich, Forgemaw The Molten, and Flicker and
Glimmer. Buddies are
non-combat followers, owned across the signed-in account. Each character keeps its
own equipped companion. Cosmetics (Shift+Y), under Buddies,
owns selection and Summon/Dismiss. The Book of Deeds has no buddy controls.
The Hunting menu and its Shift+C shortcut are removed. Buddies cannot be placed
on or activated from action bars, including controller bars. Old saved buddy slots
are cleared when loaded.

## Obtaining the remaining buddies

| Buddy | Normal gameplay source | Chance per eligible player |
|---|---|---|
| Tug, the Warhorse | Purchase directly from FURY (Eastbrook Vale) or Warmarshal Draven Kole (Highwatch) | 10,000 honor |
| Crystal Lich | Defeat Nythraxis, Scourge of Thornpeak | 0.5% normal, 1% heroic |
| Forgemaw The Molten | Defeat Ignivar or Varkhul in the heroic Crucible | 1% from either boss; no normal-mode drop |
| Flicker and Glimmer | Help five referred friends complete their referral stamp cards | Guaranteed account-wide unlock |

The rates in `src/sim/content/buddy_sources.ts` are design placeholders marked
CALIBRATE. Rolls are independent per eligible player, using the nearby kill-credit
roster. A successful boss roll creates a pending companion, rather than an item.
A chat presence line signals the win; leaving the instance reveals, collects and
summons it. Pending rewards persist across logout.

Tug, the Warhorse is sold in the honor vendors' Companions section. Paying immediately
collects, reveals and summons Tug, the Warhorse through the same grant used by raid reveals.
No item enters the inventory and full bags do not block the purchase. Owned or
already-pending companions cannot be purchased again. Honor purchases are final. There are no companion deed rewards in the active tables.

Flicker and Glimmer replace the former Sapling reward at the fifth completed friend.
Already-earned tier-five entitlements also project the pair on login. Sapling is retired;
saved Sapling ownership and pending rewards are ignored. No item or inventory space is required.

## Buddy icons and names

Each card in Cosmetics > Buddies shows the companion's portrait, rendered from
the shipped game model. The target frame uses the same portrait. The hover panel
shows a custom nickname above the original buddy type, without duplicating the
type when the name is unchanged. Rebuild art with
`scripts/render_buddy_portraits.mjs` (prepare, save the rendered PNGs, encode).
Target your
summoned buddy, then right-click its target frame and choose Rename Buddy.
Names are saved separately for each buddy on each character, surviving swaps,
dismissal and character reload. Account-wide unlocks do not copy nicknames.
Names use the existing pet-name rules: 2-16 letters, spaces, hyphens or apostrophes,
starting with a letter. Online names also use the existing name moderation.

## Account ownership

On login, existing unlocks from every character on the account are combined with
account ownership, including queued admin grants. New reveals and purchases share
ownership with online alts after persistence; other realms refresh within the
existing 30-second save interval. A character's pending raid reveal and equipped
choice remain local to that character. Changing or dismissing one character's
buddy does not change another character's equipped companion.

Honor purchases persist payment and account ownership in one transaction. A
concurrent purchase of an already-unlocked buddy is not charged. Standalone offline
play has no signed-in account and keeps its local character save.

## Local testing and admin grants

With developer commands enabled, enter `/dev buddies` in chat to collect all
remaining buddies immediately. Open Cosmetics with Shift+Y, select Buddies and choose Summon.

`/dev buddy <key>` stages one pending world-source reward at the player's
feet; walk 80 yards away to reveal it. The keys are `horse`, `crystal_lich`,
`forgemaw` and `sprites`. Developer commands are restricted to development environments.

The authorized admin endpoint
`POST /admin/api/moderation/characters/:id/grant-buddy` accepts a `buddyKey` and
reason. It grants through an online character, or adds durable account ownership
when that character is offline. Online alts receive offline grants on the next
account refresh. It no longer accepts cosmetic grants.

## Archived buddies and cosmetics

The restoration bundle is kept OUT of the release tree, on the
`feature/buddies-archive` branch (levy-street/world-of-claudecraft#4465), whose
README describes how to restore it. It preserves the historical full roster, their dedicated models, copies of shared models/icons, original
full-roster definitions, and the removed alternate-look implementation and
tests. Nothing in this tree reads it; the same sources are also reachable from
this branch's git history.

The live game has no buddy look catalog, unlock/equip actions, challenge tracking,
look rewards, or Looks interface. Old cosmetic wire fields are ignored and the
retired wire command is inert. No companion whistles or charms exist in the item catalog.
The honor vendor uses a collection offer, separate from inventory items. Companions
are summoned and dismissed through Cosmetics.

Loading a character normalizes its collection to the active roster. Retired
ownership, pending rewards, last selection and old cosmetic unlock/equipment
fields are discarded. The code archive does not back up character saves; keep
an original save separately if its retired unlocks must be restored later.
