export const EVENT_LABELS = { feeding: 'Feeding', cleaning: 'Cleaning', bulb_change: 'Bulb change', other: 'Other' };
export function eventLocalTime(stamp) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(stamp * 1000)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function eventFold(stamp) {
  return eventLocalTime(stamp) === eventLocalTime(stamp - 3600) ? 1 : 0;
}
export const eventTimeLabel = stamp => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
}).format(new Date(stamp * 1000));
