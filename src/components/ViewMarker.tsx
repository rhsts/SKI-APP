import { useEffect, useState } from 'react';
import { Marker, type MapMarkerProps } from 'react-native-maps';

/**
 * A map marker drawn by its child view. Android turns that view into a bitmap; with
 * tracksViewChanges off from the start the bitmap can be taken before the view's text
 * has laid out, leaving an empty box. So follow changes for a moment, then stop
 * (following costs a redraw per change, e.g. per step of a moving ghost).
 * Change `redraw` when the view changes later (a picture that finished loading) to follow it again.
 */
export function ViewMarker({ redraw, ...props }: Omit<MapMarkerProps, 'tracksViewChanges'> & { redraw?: string | number | null }) {
  const [tracking, setTracking] = useState(true);
  const [drawn, setDrawn] = useState(redraw);
  if (drawn !== redraw) {
    // The view changed: follow it again (set during render, so the redraw is in the same pass).
    setDrawn(redraw);
    setTracking(true);
  }
  useEffect(() => {
    const t = setTimeout(() => setTracking(false), 500);
    return () => clearTimeout(t);
  }, [redraw]);
  return <Marker {...props} tracksViewChanges={tracking} />;
}
