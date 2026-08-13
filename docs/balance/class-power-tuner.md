<!-- Living operator + maintainer doc for the Class Power Tuner. This markdown
     file is the committed reference. The full rendering (the same prose plus the
     complete per-class, per-spec ability tables, the weapon table, and the
     dashboard screenshots) is a build artifact: generate it on demand with the
     command at the end of this document. It is deliberately not committed, since
     it runs to megabytes and is reproducible from the live content tables. -->

# Class Power Tuner

An operator-facing balance lever: every aspect of every ability of every class as
a multiplier slider, plus the auto-attack ("white") swing damage and swing timer
of every weapon. Saved per realm, applied to the world at the next server restart.

It exists because two of the nine classes have been reworked and now outperform
the other seven. Closing that gap used to mean editing content source and
shipping a build; with the tuner it is a slider and a restart.

> **On the numbers below.** The tool is complete and the mechanism is settled;
> what moves under it is the CONTENT. The per-ability tables and screenshots
> below are a snapshot of the kit as it stands on `release/v0.37.0`, and the
> class reworks
> are still arriving one wave at a time. Nothing here needs re-engineering when a
> wave lands: the catalog is derived from the live content tables, never
> hand-authored, so a redesigned class shows up with the right sliders on its own.
> The reference is simply regenerated (one command, at the end of this document)
> so the tables describe the current kit. Read the mechanism as settled and the
> numbers as of today.

**Full reference (screenshots, every class/spec ability table, every weapon):**
generated on demand, see "Regenerating the reference" at the end of this
document. It is not committed: it is derived from the live content tables and
runs to megabytes.

## Who can use it

A **tuner** is someone **assigned to the role by Levy Street**, the project owner.
It is not something an operator can grant themselves or pick up by holding another
staff role: the designation is handed out deliberately, to the few people trusted
to move class balance, and it is revoked the same way.

Technically it is a dedicated staff role, `tuner`, carrying exactly two
permissions:

| Permission | What it allows |
|---|---|
| `tuning.read` | See the sliders and the change history |
| `tuning.write` | Save a tuning document |

The role carries nothing else. An account holding only `tuner` cannot see player
accounts, act on players, or read the anti-bot internals, and every other admin
endpoint answers it 403. `tuning.read` is deliberately kept out of the read-only
`viewer` bundle, so the balance surface reaches assigned people rather than every
read-only seat.

`admin` and `superadmin` also hold both permissions, because `admin` is the
legacy full-admin bundle (every tool the old `is_admin` flag conferred, minus
staff-role management) rather than a designation of its own. That is deliberate:
tuning is reversible, boot-scoped and attributed in the change history, so it is
not in the superadmin-only class that `guildbank.purge` is in. What `tuner` adds
is the ability to hand someone the balance surface WITHOUT handing them the rest
of the dashboard.

Levy Street assigns it with the grant script (or the Staff page, for an account
that already holds staff roles). Every save is attributed to the account that made
it in the change history, so the trail always names which assigned tuner moved a
number and why.

```
node scripts/grant_admin.mjs <username> --roles tuner
```

## The classes this has been pointed at

Warrior and Mage were reworked first. The next three through the same door were
**Shaman**, **Hunter** and **Priest**, and their redesigns have now LANDED on this
base, nine specializations in total:

| Class | Specialization | The loop the redesign builds |
|---|---|---|
| Shaman | Thundercall (Elemental) | Lightning caster: Fulmination banking, spent by shocks |
| | Warspirit (Enhancement) | Dual wield: Galeheart echoes and Flow State |
| | Spiritmend (Restoration) | Healer: Mending Current deposits, consumed by Cascading Mend |
| Hunter | Packlord (Beast Mastery) | Pet focused: Stampede, with Pack Command resets |
| | Coldsight (Marksmanship) | Ranged damage on the Cold Read mastery |
| | Fieldcraft (Survival) | Physical damage, Bloodhook contributions |
| Priest | Doctrine (Discipline) | Covenant loop, hybrid healing and damage |
| | Benison (Holy) | Vigil-based healing loop |
| | Vespers (Shadow) | Effigy loop, damage scaling off it |

That wave is the worked example for everything above. **The dashboard, server and
wire needed no work at all:** the catalog is derived from the live content tables
and the sliders come from the abilities' own effects, so the redesigned kit
appeared with the right sliders on its own, Hunter's mana-to-Focus switch landed
on the resource-cost channel by itself, and the retired abilities are simply
absent.

The one thing a rework CAN require is a row in the classification table, and
`tests/class_tuning_coverage.test.ts` is what says so out loud. Merging this
release turned it red naming 140 unclassified numbers across the paladin kit, the
warlock necromancy and affliction sets, the redesigned hunter kit and the druid
engine payoffs, and the fix was one row each in
`src/sim/tuning/ability_fields.ts`, plus three def-level resource meters the
walker had to reach. Expect exactly that shape of work when the next wave lands.

## How a change reaches the world

1. A tuner moves sliders in **Balance > Class Power** and saves with a note.
2. The document is sanitized, stored as one row per realm (`class_tuning_config`)
   and appended to an audit trail (`class_tuning_changes`) recording the before
   and after documents, the operator and the note. An unchanged save records
   nothing.
3. The page reports the change as **pending a restart**. The running world is
   untouched.
4. At the next boot `installRealmClassTuning` (`server/class_tuning.ts`) installs
   the document onto the ability and item tables ONCE, before the first
   `GameServer` (and therefore the first `Sim`) exists.

Tuning is boot-scoped on purpose (`src/sim/tuning/install.ts` carries the
reasoning): swapping values under a running world would change numbers underneath
in-flight casts and cooldowns, and would leave server and clients disagreeing for
as long as the change took to propagate. The realm hands its installed document
to each client in the `hello` frame, so client tooltips, cooldown pips and cost
predictions describe the numbers the server actually resolves.

## Where the code lives

| Path | Role |
|---|---|
| `src/sim/tuning/channels.ts` | The closed channel vocabulary and the value math (`scaleTuningValue`) |
| `src/sim/tuning/ability_fields.ts` | THE classification table: which effect field belongs to which channel, and how it responds |
| `src/sim/tuning/ability_knobs.ts` | The ONE ability traversal that both lists the sliders and applies them |
| `src/sim/tuning/weapon_knobs.ts` | The same traversal for a weapon's swing damage and swing timer |
| `src/sim/tuning/document.ts` | The sparse per-realm document plus its sanitizer |
| `src/sim/tuning/catalog.ts` | The derived catalog the dashboard renders |
| `src/sim/tuning/install.ts` | The boot install onto `ABILITIES`, `ITEMS[].weapon` and `CLASSES[].ranged` |
| `server/class_tuning.ts` / `_db.ts` | Boot install, save/history operations / the SQL boundary |
| `src/admin/pages/ClassTuning.svelte` | The dashboard page (class windows plus the Weapons window) |
| `src/admin/class_tuning.ts` | Its pure view model (slider state, filters, previews) |

## Adding a tunable number (what a class rework has to do)

Usually nothing. The catalog is derived from the live content tables and one
traversal drives both the sliders and the apply, so a new ability built from
existing effect types arrives with the right sliders automatically.

When a rework adds a NEW effect field, `tests/class_tuning_coverage.test.ts` fails
naming it. The fix is one row in `EFFECT_TUNED_FIELDS`
(`src/sim/tuning/ability_fields.ts`) choosing its channel and its value kind:

- `linear` for a magnitude (damage, seconds, yards, costs)
- `deviation` for a multiplier whose neutral point is 1 (a snare's 0.5, a 2x
  threat multiplier, a 1.4 haste aura): the slider moves its distance from 1
- `fraction` for a normalized 0..1 share, clamped to at most the whole
- `multiplier` for a plain rate whose neutral is 1 and which must not snap to a
  whole number (a weapon-damage multiplier, the spell power coefficient)

A `linear` field whose authored value is a whole number stays whole, and a
nonzero one never scales to zero however far the slider is pulled down: several
count fields (`softCap`, `maxTargets`) read 0 as "no limit at all" rather than
"none", so a rounded-away count would land as a buff. Only a base of zero, which
no slider can move anyway, comes out as zero.

A field that is genuinely not a power lever (tick cadence, an identity flag) goes
in `UNTUNED_EFFECT_FIELDS`, `UNTUNED_DEF_FIELDS`, or `UNTUNED_RANK_FIELDS` (for a
numeric field on `AbilityRank` itself) with the reasoning at the row.
A new aura KIND must be declared in exactly one of the four kind sets: a
multiplier around 1 joins `MULTIPLIER_AURA_KINDS`, a marker joins
`MARKER_AURA_KINDS`, reflect damage joins `REFLECT_AURA_KINDS`, and a plain
magnitude joins `MAGNITUDE_AURA_KINDS` (the declared linear default). The guard
fails on an undeclared kind and on a live aura value that looks like an
undeclared multiplier, on either side of 1.

### What the coverage guard does NOT see

Two scope limits, so the "fails on any unaccounted numeric field" claim stays
honest:

- **Time channels aside, the guard covers ability CONTENT only.** Magnitudes
  carried by talents (a choice row's `addEffects` payloads, and the runtime
  modifiers `applyTalentMods` applies after tuning) are outside the walk on
  purpose: the tuner moves the authored ability tables, and talents are a
  different lever. A rework that shifts power into talent payloads shifts it
  out of the tuner's reach; weigh that when choosing where a number lives.
- **The classification table cannot tell which effect types read Spell or
  Attack Power.** A bespoke combat module that adds its own power rider must
  join `POWER_SCALED_EFFECTS` in `ability_knobs.ts` by hand (paladinAegis is
  the standing example), or its ability never gets a spell_power slider.

A new channel is a wider change: add it to `TUNING_CHANNELS`, add its
`tuning.channel.<id>` English label in `src/admin/i18n.en.ts`, and regenerate
(`npm run i18n:admin`). `tests/admin/class_tuning.test.ts` pins one label per
channel.

## Guards

| Test | What it holds |
|---|---|
| `tests/class_tuning.test.ts` | Channel math, the ability and weapon walkers, the document, install/restore |
| `tests/class_tuning_coverage.test.ts` | Every numeric ability field (def, effect and rank level) is classified; every aura kind is declared in exactly one kind set; every fraction base is a real 0..1 share; every class, spec, ability and weapon is present |
| `tests/class_tuning_db.test.ts` | Additive idempotent DDL, the atomic save-plus-audit, unchanged-is-a-no-op |
| `tests/class_tuning_runtime.test.ts` | The shipped-baseline snapshot, the boot install, the pending-restart state |
| `tests/admin/class_tuning.test.ts` | The view model, and the local value math pinned equal to the sim's |
| `tests/server/admin.test.ts` | The three endpoints |
| `tests/admin_routes.test.ts` | The route-to-permission map stays complete |

## Regenerating the reference

The screenshots come from the REAL dashboard against a REAL server, and the
tables from the same catalog the dashboard renders, so neither can drift from the
tool.

```
# 1. Postgres + a server, with an account holding the tuner role
npm run db:up
npm run server
node scripts/grant_admin.mjs <username> --roles tuner

# 2. A dev client pointed at that server
WOC_DEV_API_TARGET=http://127.0.0.1:8787 npx vite --port 5195

# 3. Capture, then build the document
GAME_URL=http://127.0.0.1:5195 SERVER_URL=http://127.0.0.1:8787 \
  ADMIN_USER=<username> ADMIN_PASS='...' \
  SHOTS_DIR=docs/screenshots/class-power-tuner \
  node scripts/class_tuner_shots.mjs

OUT_DIR=docs/balance SHOTS_DIR=docs/screenshots/class-power-tuner \
  node scripts/class_tuner_reference.mjs --pdf
```
