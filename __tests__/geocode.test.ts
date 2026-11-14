import { canSearch, geocodeUrl, parsePlaces } from '../src/lib/geocode';

describe('finding a place by name', () => {
  it('asks for the typed name, trimmed and encoded', () => {
    const url = geocodeUrl('  Mürren ');
    expect(url.startsWith('https://geocoding-api.open-meteo.com/v1/search?')).toBe(true);
    expect(new URL(url).searchParams.get('name')).toBe('Mürren');
  });

  it('needs at least two letters', () => {
    expect(canSearch(' Z ')).toBe(false);
    expect(canSearch('Ze')).toBe(true);
  });

  it('reads names, region, position and height', () => {
    const places = parsePlaces({
      results: [
        { id: 1, name: 'Mürren', latitude: 46.559, longitude: 7.892, elevation: 1638, admin1: 'Bern', country: 'Switzerland' },
        { id: 2, name: 'Zermatt', latitude: 46.02, longitude: 7.749, country: 'Switzerland' },
      ],
    });
    expect(places).toEqual([
      { name: 'Mürren', region: 'Bern, Switzerland', lat: 46.559, lon: 7.892, alt: 1638 },
      { name: 'Zermatt', region: 'Switzerland', lat: 46.02, lon: 7.749, alt: null },
    ]);
  });

  it('shows a place once when the village and its municipality read the same', () => {
    const zermatt = { name: 'Zermatt', latitude: 46.02, longitude: 7.749, elevation: 1608, admin1: 'Valais', country: 'Switzerland' };
    expect(parsePlaces({ results: [zermatt, { ...zermatt, id: 2, latitude: 46.0 }] })).toHaveLength(1);
  });

  it('drops entries without a name or coordinates, and survives junk', () => {
    expect(parsePlaces({ results: [{ name: 'Nowhere' }, { latitude: 1, longitude: 2 }, null] })).toEqual([]);
    expect(parsePlaces({})).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
    expect(parsePlaces({ error: true, reason: 'bad' })).toEqual([]);
  });
});
