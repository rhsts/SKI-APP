/** Coordinates the way rescue services read them out: 47.01370° N, 10.29180° E and 47°0'49.3"N 10°17'30.5"E. */
export function formatCoords(lat: number, lon: number) {
  const dms = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const mFloat = (a - d) * 60;
    const m = Math.floor(mFloat);
    const s = (mFloat - m) * 60;
    return `${d}°${m}'${s.toFixed(1)}"${v >= 0 ? pos : neg}`;
  };
  return {
    decimal: `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`,
    dms: `${dms(lat, 'N', 'S')} ${dms(lon, 'E', 'W')}`,
    mapsLink: `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`,
  };
}

/** 911 for North America, 112 elsewhere (112 also works on any GSM phone in Europe). */
export function emergencyNumbers(locale: string): string[] {
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  return region === 'US' || region === 'CA' ? ['911', '112'] : ['112', '911'];
}
