export type Sport = 'ski' | 'snowboard' | 'telemark' | 'sitski' | 'touring';

export const SPORTS: { id: Sport; label: string }[] = [
  { id: 'ski', label: 'Ski' },
  { id: 'snowboard', label: 'Snowboard' },
  { id: 'telemark', label: 'Telemark' },
  { id: 'sitski', label: 'Sit-ski' },
  { id: 'touring', label: 'Ski touring' },
];

export function sportInfo(id: string | null | undefined) {
  return SPORTS.find((s) => s.id === id) ?? SPORTS[0];
}

export function isSport(v: unknown): v is Sport {
  return typeof v === 'string' && SPORTS.some((s) => s.id === v);
}
