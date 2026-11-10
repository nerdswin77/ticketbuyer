export const money = (cents: number, currency = 'eur') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(
    cents / 100,
  );

export const countdown = (ms: number): string => {
  if (ms <= 0) return 'OPEN';
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${mmss}`;
  return mmss;
};

export const kickoff = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Format a timestamp in a specific IANA time zone (e.g. the stadium's). */
export const inZone = (ms: number, timeZone: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, { ...opts, timeZone }).format(new Date(ms));

export const zoneAbbr = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')
    ?.value ?? timeZone;

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "in 12 days", "in 5 h", "in 3 min" */
export const relative = (ms: number, now: number) => {
  const d = ms - now;
  if (d <= 0) return 'started';
  const min = Math.round(d / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
};

/** [[5,11],[5,12],[6,3]] -> "Row 5: 11, 12 · Row 6: 3" */
export const formatPositions = (positions: [number, number][]): string => {
  const rows = new Map<number, number[]>();
  for (const [r, s] of [...positions].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    rows.set(r, [...(rows.get(r) ?? []), s]);
  }
  return [...rows].map(([r, ss]) => `Row ${r}: ${ss.join(', ')}`).join(' · ');
};

export const clockTime = (ms: number, millis = false) => {
  const d = new Date(ms);
  const t = d.toLocaleTimeString(undefined, { hour12: false });
  return millis ? `${t}.${String(d.getMilliseconds()).padStart(3, '0')}` : t;
};
