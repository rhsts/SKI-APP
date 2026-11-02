export type Sport = 'ski' | 'snowboard' | 'telemark' | 'sitski' | 'touring';

export const SPORTS: { id: Sport; label: string; emoji: string }[] = [
  { id: 'ski', label: 'Ski', emoji: '⛷️' },
  { id: 'snowboard', label: 'Snowboard', emoji: '🏂' },
  { id: 'telemark', label: 'Telemark', emoji: '🎿' },
  { id: 'sitski', label: 'Sit-ski', emoji: '♿' },
  { id: 'touring', label: 'Ski touring', emoji: '🏔️' },
];

export function sportInfo(id: string | null | undefined) {
  return SPORTS.find((s) => s.id === id) ?? SPORTS[0];
}

export function isSport(v: unknown): v is Sport {
  return typeof v === 'string' && SPORTS.some((s) => s.id === v);
}
