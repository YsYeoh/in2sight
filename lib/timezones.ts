export const TIMEZONES = [
  'Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Jakarta', 'Asia/Bangkok', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago',
  'America/Los_Angeles', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
] as const;

/** The list, plus the user's current zone at the top when it isn't listed (so the select never shows a blank). */
export function withCurrentZone(current: string): string[] {
  return (TIMEZONES as readonly string[]).includes(current) ? [...TIMEZONES] : [current, ...TIMEZONES];
}
