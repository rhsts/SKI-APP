import { Polyline } from 'react-native-maps';
import { difficultyColor } from '../lib/pistes';
import type { TrailMap } from '../lib/trailmap';

/**
 * The resort's pistes (coloured by difficulty) and lifts (thin dark lines),
 * drawn under your own track. Render inside a MapView.
 */
export function TrailOverlay({ map }: { map: TrailMap }) {
  return (
    <>
      {map.pistes.map((p) => (
        <Polyline
          key={p.id}
          coordinates={p.coords.map((c) => ({ latitude: c.lat, longitude: c.lon }))}
          strokeColor={hexA(difficultyColor(p.difficulty), 0.55)}
          strokeWidth={3}
          zIndex={0}
        />
      ))}
      {map.lifts.map((l) => (
        <Polyline
          key={l.id}
          coordinates={l.coords.map((c) => ({ latitude: c.lat, longitude: c.lon }))}
          strokeColor="rgba(20,20,20,0.75)"
          strokeWidth={1.5}
          zIndex={0}
        />
      ))}
    </>
  );
}

/** '#RRGGBB' + alpha → 'rgba(…)'. */
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
