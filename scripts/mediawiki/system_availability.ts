import { DEFAULT_SEASONAL_WINDOWS } from '../../server/seasonal_calendar';

/** Player-visible availability. The PvP menu and shipped deeds are authoritative for
 * retired brackets. Guide visibility alone does not determine whether a dungeon is playable. */
const retired = new Map<string, string>([
  [
    'Protect Yumi',
    'The PvP menu no longer offers either team size. You cannot practice it offline anymore either.',
  ],
  [
    'Fiesta arena',
    'You can no longer start a Fiesta match. Its 2v2 queue and offline practice are gone.',
  ],
  ['Fiesta augments', 'You could only get these upgrades during a [[Fiesta arena|Fiesta match]].'],
  ['Fiesta power-ups', 'These pickups only showed up during a [[Fiesta arena|Fiesta match]].'],
  [
    'Vale Cup',
    'The Sowfield in Eastbrook was removed. Players can no longer enter a Vale Cup match or earn its deeds.',
  ],
]);

export function activityNotice(owner: string): string {
  const reason = retired.get(owner);
  if (reason) return "'''Retired.''' " + reason;
  if (owner === 'Mount racing')
    return "'''Retired from live play.''' You can no longer join Mount racing. The game still has the solo jumping course that the Galecrest riding lesson uses.";
  if (owner === 'Gourdlight Eve') {
    const utc = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      dateStyle: 'long',
      timeStyle: 'short',
    });
    const windows = DEFAULT_SEASONAL_WINDOWS.filter((s) => s.eventId === 'gourdlight_eve');
    return [
      "'''Seasonal event.''' Gourdlight Eve activities only appear while the event is running on your realm.",
      ...windows.map(
        (s) =>
          `The default event window runs from ${utc.format(s.startMs)} to ${utc.format(s.endMs)} UTC. The people who run a realm can change these dates.`,
      ),
    ].join(' ');
  }
  return '';
}

export function retiredDeedActivity(id: string): string | undefined {
  if (id.startsWith('pvp_fiesta_')) return 'Fiesta arena';
  if (id === 'chr_vale_cup_debut' || id.startsWith('pvp_vcup_')) return 'Vale Cup';
  return undefined;
}
