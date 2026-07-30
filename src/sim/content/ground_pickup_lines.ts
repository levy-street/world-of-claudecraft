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
  // --- the new-realm quest pass ---
  hearth_ember_cache: {
    deny: 'The ember kettle is banked and sealed. It is not yours to carry.',
    enough: 'You have recovered every ember cache the lodge lost.',
  },
  sprung_trap: {
    deny: 'The sprung iron is tangled in the reeds, and it is not your trapline.',
    enough: 'You have gathered all of the traps Brosk asked for.',
  },
  scorched_supply_crate: {
    deny: 'The crate is too hot to shoulder without a reason to brave it.',
    enough: 'You have recovered every crate the quartermaster listed.',
  },
  wyrmwatch_warning_banner: {
    deny: 'The banner pole is bundled tight. Wyrmwatch has not issued it to you.',
    enough: 'Every warning banner is already planted.',
  },
  amberfall_sap_bucket: {
    deny: 'The sap bucket hangs on its tap, and the orchard is not yours to strip.',
    enough: 'You are carrying all the sap buckets that overturned.',
  },
  mere_ferry_lantern: {
    deny: 'The lantern bobs at the waterline, waiting for the ferry crew.',
    enough: 'You have fished out every ferry lantern the mere took.',
  },
  fenway_mooring_line: {
    deny: 'The cut line is snagged fast, and no one asked you to haul it.',
    enough: 'You have recovered all the mooring line Alden needs.',
  },
  bridgemere_toll_chest: {
    deny: 'The toll-chest is bedded deep in fen mud and is not yours to raise.',
    enough: 'You have raised every sunken toll-chest.',
  },
  gloamfield_nightbloom: {
    deny: 'The blossom only opens for a gardener of the night beds.',
    enough: 'Your basket holds all the nightbloom it can.',
  },
  vigil_star_chart: {
    deny: 'The chart stone shows nothing to eyes the Astronomer has not guided.',
    enough: 'You have read every chart the Vigil holds.',
  },
  barrow_grave_offering: {
    deny: 'The scattered offering is grave-bound. Disturb it with cause, or not at all.',
    enough: 'You have gathered all the scattered offerings.',
  },
  gallowmere_grave_candle: {
    deny: "The grave-candle is not yours to light without the candlewright's blessing.",
    enough: 'Every boundary candle already burns.',
  },
  silkbound_remains: {
    deny: 'The silk-wrapped shape is not yours to cut down.',
    enough: 'You have cut down all the remains the vicar asked after.',
  },
  pearlwake_cargo_crate: {
    deny: 'The cargo crate is salvage-marked. The wreck line has rules.',
    enough: 'You have hauled every crate off the wreck line.',
  },
  sunken_offering_bowl: {
    deny: 'The offering bowl is dry, and the idol road keeps its own accounts.',
    enough: 'Every offering bowl on the idol road is filled.',
  },
  evergarden_statue_rubbing: {
    deny: 'The statue offers nothing to a passerby without a purpose.',
    enough: 'You have taken a rubbing from all four sisters.',
  },
  hedgewick_tool_cart: {
    deny: 'The spilled cart is garden property, and the gardeners are counting.',
    enough: 'You have righted every spilled tool cart.',
  },
  shear_storm_lantern: {
    deny: 'The storm-lantern is chained to its post against the gale.',
    enough: 'Every lantern on the Shear is already lit.',
  },
  wreckfield_flotsam_crate: {
    deny: 'Salvage law is clear: no claim, no crate.',
    enough: 'You have salvaged all the flotsam Edda marked.',
  },
  gullhaven_watchbell: {
    deny: "The watchbell answers only the bellkeeper's errand.",
    enough: 'Every coastal watchbell has been rung.',
  },
};

export function groundPickupDeny(itemId: string, itemName: string): string {
  return GROUND_PICKUP_LINES[itemId]?.deny ?? `You cannot take the ${itemName} yet.`;
}

export function groundPickupEnough(itemId: string): string {
  return GROUND_PICKUP_LINES[itemId]?.enough ?? 'You have enough of those.';
}
