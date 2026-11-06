import { useEffect, useState } from 'react';
import { Marker, type MapMarkerProps } from 'react-native-maps';

/**
 * A map marker drawn by its child view. Android turns that view into a bitmap; with
 * tracksViewChanges off from the start the bitmap can be taken before the view's text
 * has laid out, leaving an empty box. So follow changes for a moment, then stop
 * (following costs a redraw per change, e.g. per step of a moving ghost).
 */
export function ViewMarker(props: Omit<MapMarkerProps, 'tracksViewChanges'>) {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracking(false), 500);
    return () => clearTimeout(t);
  }, []);
  return <Marker {...props} tracksViewChanges={tracking} />;
}
