// Flavor text when a player interacts with a ground quest sparkle object.
// Every itemId in GROUND_OBJECTS must have an entry here.

export interface GroundPickupLines {
  /** Quest not active (or not accepted). */
  deny: string;
  /** Quest active but collect objective already satisfied. */
  enough: string;
}

export const GROUND_PICKUP_LINES: Record<string, GroundPickupLines> = {
  supply_crate: {
    deny: 'The crate is nailed shut.',
    enough: 'You already have enough supply crates.',
  },
  gravecaller_sigil: {
    deny: 'The sigil repels your touch.',
    enough: "You already carry a Gravecaller's Sigil.",
  },
  weathered_ledger_page: {
    deny: 'The ledger pages are bound too tightly to take.',
    enough: 'You already have enough ledger pages.',
  },
  morthen_grimoire: {
    deny: "The grimoire's clasp is magically sealed.",
    enough: "You already have Morthen's Grimoire.",
  },
  fen_muster_order: {
    deny: 'The wax seal holds until the order is yours to claim.',
    enough: 'You already have the Fenbridge muster order.',
  },
  lost_caravan_goods: {
    deny: "You aren't authorized to salvage these goods yet.",
    enough: 'You already have enough caravan goods.',
  },
  rusted_censer: {
    deny: 'The censer is chained in place.',
    enough: 'You already have enough rusted censers.',
  },
  bastion_ward_stone: {
    deny: 'The ward stone will not budge.',
    enough: 'You already have the Bastion ward stone.',
  },
  unknown_alien_weaponry: {
    deny: 'The meteor debris is too hot to handle without Aldric expecting it.',
    enough: 'You already recovered enough alien wreckage.',
  },
  highwatch_summons: {
    deny: 'The summons are sealed with Highwatch wax.',
    enough: 'You already have the Highwatch summons.',
  },
  ogre_war_totem: {
    deny: 'The totem is planted too firmly to uproot.',
    enough: 'You already have enough ogre war totems.',
  },
  gravewyrm_sigil: {
    deny: 'Dark magic keeps the sigil rooted.',
    enough: 'You already have enough Gravewyrm sigils.',
  },
  sanctum_key_shard: {
    deny: 'The shard is dormant and locked in place.',
    enough: 'You already have enough sanctum key shards.',
  },
  moongate_rubbing: {
    deny: 'The warding is not yours to copy until the watcher asks for it.',
    enough: 'You already have the warding rubbing.',
  },
  grave_sir_aldren: {
    deny: 'The grave is sealed against the living until the dead call you to it.',
    enough: "You have already taken what Captain Aldren's grave will give.",
  },
  grave_high_priest_malric: {
    deny: 'The grave is sealed against the living until the dead call you to it.',
    enough: "You have already taken what High Priest Malric's grave will give.",
  },
  grave_captain_voss: {
    deny: 'The grave is sealed against the living until the dead call you to it.',
    enough: "You have already taken what Royal Assassin Voss's grave will give.",
  },
  crypt_ritual_circle: {
    deny: 'The ritual circle lies cold and dormant.',
    enough: 'The circle has nothing more to give you.',
  },
  // Northern realm wayfinding objects
  frostveil_cairn_tarn: {
    deny: 'The lake cairn is sealed beneath a skin of unbroken ice.',
    enough: 'The Glacier Tarn cairn already burns with a steady blue light.',
  },
  frostveil_cairn_fen: {
    deny: "The marsh cairn gives no answer without a watcher's charge.",
    enough: 'The Shiverfen cairn is already awake and watching.',
  },
  frostveil_cairn_terrace: {
    deny: 'The terrace cairn is silent beneath the driving snow.',
    enough: 'The Howling Terrace cairn needs no further tending.',
  },
  amberfall_lantern_orchard: {
    deny: 'The orchard lantern has no flame to offer an unbidden hand.',
    enough: 'The Orchard harvest lantern is already glowing gold.',
  },
  amberfall_lantern_mere: {
    deny: 'The mere lantern stays dark until its keeper begins the round.',
    enough: 'The Great Mere harvest lantern is already alight.',
  },
  amberfall_lantern_monolith: {
    deny: 'Cold green fire withdraws from your touch.',
    enough: 'The Monolith harvest lantern has yielded all it can tell you.',
  },
  willowfen_marker_bogshine: {
    deny: "The reed marker is sunk too deep to turn without the fenward's leave.",
    enough: 'The Bogshine reed marker already points toward safe ground.',
  },
  willowfen_marker_willowweep: {
    deny: 'The carved reeds resist being turned without cause.',
    enough: 'The Willowweep reed marker already shows the homeward path.',
  },
  willowfen_marker_drowsy: {
    deny: 'Something beneath the mud holds the marker fast.',
    enough: 'The Drowsy Strand reed marker is set firmly in place.',
  },
  nightbloom_anchor_moonwell: {
    deny: 'The moonwell rune reflects only an empty sky.',
    enough: 'You have already read the Moonwell dream anchor.',
  },
  nightbloom_anchor_gloamfield: {
    deny: 'The gloamfield rune will not settle into a readable shape.',
    enough: 'You have already read the Gloamfield dream anchor.',
  },
  nightbloom_anchor_barrow: {
    deny: 'The barrow rune closes like an eye when you approach.',
    enough: 'You have already read the Sleepless Barrow dream anchor.',
  },
  galecrest_signal_downs: {
    deny: 'The storm post will not sound for an unannounced hand.',
    enough: 'The Howling Downs storm post has already given its note.',
  },
  galecrest_signal_tarn: {
    deny: 'The tarn post is still and refuses your grip.',
    enough: 'The Mirror Tarn storm post has already answered.',
  },
  galecrest_signal_wrecks: {
    deny: 'A drowned bell tone warns you away from the post.',
    enough: 'The Wreckfield storm post has already sounded its warning.',
  },
  palmreach_waymark_strand: {
    deny: 'Vines hold the shell marker shut around its secret.',
    enough: 'The Palm Strand waymark is already clear and shining.',
  },
  palmreach_waymark_vinefall: {
    deny: "The overgrown waymark will not open without a trailblazer's purpose.",
    enough: 'The Vinefall waymark already shows the reopened trail.',
  },
  palmreach_waymark_lagoon: {
    deny: 'The lagoon waymark sleeps beneath salt and flowering vines.',
    enough: 'The Sapphire Lagoon waymark is already awake.',
  },
  // the Veiled Hollow
  hollow_sealstone: {
    deny: 'The sealstone waits, its socket empty. You have nothing that fits it.',
    enough: 'The seal is set. The sealstone asks nothing more of you.',
  },
  monument_overlook: {
    deny: 'The verse is worn shallow. Without a reason to read, it stays silent.',
    enough: 'You have already read what the Overlook monument remembers.',
  },
  monument_court: {
    deny: 'Ivy blankets the verse. Without a reason to read, it stays silent.',
    enough: 'You have already read what the Court monument remembers.',
  },
  monument_north: {
    deny: 'The forgotten verse waits for a reader with a reason.',
    enough: 'You have already read what the forgotten monument remembers.',
  },
};

export function groundPickupDeny(itemId: string, itemName: string): string {
  return GROUND_PICKUP_LINES[itemId]?.deny ?? `You cannot take the ${itemName} yet.`;
}

export function groundPickupEnough(itemId: string): string {
  return GROUND_PICKUP_LINES[itemId]?.enough ?? 'You have enough of those.';
}
