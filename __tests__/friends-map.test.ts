/** The Friends tab's map: friend lines, order, headline and camera region. */
import { FALLBACK_REGION, friendLine, friendsHeadline, regionFor, seenAgo, sortFriends } from '../src/lib/friendsMap';

const NOW = 1_800_000_000_000;
const me = { lat: 47.0, lon: 10.3 };
const near = { playerId: 'a', name: 'Ana', lat: 47.001, lon: 10.3, at: NOW - 30_000 };
const far = { playerId: 'b', name: 'Ben', lat: 47.02, lon: 10.3, at: NOW - 5 * 60_000 };

describe('friends map', () => {
  it('says how long ago a friend was seen', () => {
    expect(seenAgo(NOW - 20_000, NOW)).toBe('Just now');
    expect(seenAgo(NOW - 4 * 60_000 - 5_000, NOW)).toBe('4 min ago');
  });

  it('adds the distance when your position is known', () => {
    expect(friendLine(near, me, 'metric', NOW)).toMatch(/^Just now · \d+ m away$/);
    expect(friendLine(far, null, 'metric', NOW)).toBe('5 min ago');
  });

  it('puts the closest friend first, or the freshest without a position', () => {
    expect(sortFriends([far, near], me).map((f) => f.name)).toEqual(['Ana', 'Ben']);
    expect(sortFriends([{ ...far, at: NOW }, near], null).map((f) => f.name)).toEqual(['Ben', 'Ana']);
  });

  it('counts friends in the headline', () => {
    expect(friendsHeadline(0)).toBe('No friends out right now');
    expect(friendsHeadline(1)).toBe('1 friend on the mountain');
    expect(friendsHeadline(3)).toBe('3 friends on the mountain');
  });

  it('frames everyone, never tighter than a ski area', () => {
    expect(regionFor([])).toBe(FALLBACK_REGION);
    const one = regionFor([me]);
    expect(one).toEqual({ latitude: 47, longitude: 10.3, latitudeDelta: 0.02, longitudeDelta: 0.02 });
    const both = regionFor([me, { lat: 47.1, lon: 10.5 }]);
    expect(both.latitude).toBeCloseTo(47.05);
    expect(both.latitudeDelta).toBeCloseTo(0.15);
    expect(both.longitudeDelta).toBeCloseTo(0.3);
  });
});
