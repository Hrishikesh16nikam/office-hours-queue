export const minutesSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));

export function duration(min: number): string {
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

export const MODE_LABEL = { in_person: 'In person', online: 'Online', hybrid: 'In person and online' } as const;
