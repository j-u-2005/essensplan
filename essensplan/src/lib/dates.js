export const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const pad = (n) => String(n).padStart(2, '0');

export function isValidISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(s);
  return toISO(d) === s;
}

export function toISO(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function addDays(s, n) {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

/** 0 = Montag … 6 = Sonntag */
export function weekdayIndex(s) {
  return (parseISO(s).getUTCDay() + 6) % 7;
}

export function mondayOf(s) {
  return addDays(s, -weekdayIndex(s));
}

export function berlinToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Welche Woche wird geplant? Freitag bis Sonntag: die kommende Woche,
 * Montag bis Donnerstag: die laufende Woche.
 */
export function planningWeek(now = new Date()) {
  const today = berlinToday(now);
  const wd = weekdayIndex(today);
  return wd >= 4 ? addDays(mondayOf(today), 7) : mondayOf(today);
}

export function isoWeekNumber(s) {
  const d = parseISO(s);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4, 12));
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

export function formatShort(s) {
  const [, m, d] = s.split('-');
  return `${d}.${m}.`;
}
