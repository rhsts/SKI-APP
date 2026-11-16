import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { fmtAlt } from '../lib/format';
import { canSearch, type Place } from '../lib/geocode';
import type { Units } from '../lib/types';
import { searchPlaces } from '../mountain/places';
import { font, size, space, target, useStyles, useTheme, type Palette } from '../theme';

interface Props {
  units: Units;
  /** The place being shown now, if it isn't where you are. */
  current: Place | null;
  onPick: (p: Place) => void;
  /** Go back to the phone's own position. */
  onUseLocation: () => void;
}

/** Type a ski resort, village or town; pick a match to see its snow and trail map. */
export function PlaceSearch({ units, current, onPick, onUseLocation }: Props) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [searched, setSearched] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const search = async () => {
    if (!canSearch(query) || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setResults(await searchPlaces(query));
      setSearched(query.trim());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={styles.field}>
        <Ionicons name="search-outline" size={20} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          placeholder="Resort, village or town"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          autoFocus
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="Place name"
        />
        <Pressable onPress={search} disabled={!canSearch(query) || busy} style={styles.go} accessibilityRole="button" accessibilityLabel="Search">
          {busy ? <ActivityIndicator color={colors.text} /> : <Text style={[s.control, !canSearch(query) && { color: colors.muted }]}>Search</Text>}
        </Pressable>
      </View>

      {failed ? <Text style={s.body}>No connection. Try again when you have signal.</Text> : null}
      {results && !results.length && !failed ? (
        <Text style={s.body}>Nothing found for “{searched}”. Try the village at the foot of the resort.</Text>
      ) : null}

      {results?.length ? (
        <View style={styles.list}>
          {results.map((p) => (
            <Pressable
              key={`${p.lat},${p.lon}`}
              onPress={() => onPick(p)}
              style={styles.result}
              accessibilityRole="button"
              accessibilityLabel={`${p.name}, ${p.region}`}
            >
              <Text style={s.body} numberOfLines={1}>{p.name}</Text>
              <Text style={[s.muted, styles.tabular]} numberOfLines={1}>
                {[p.region, p.alt != null ? fmtAlt(p.alt, units) : null].filter(Boolean).join(' · ')}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {current ? (
        <Pressable onPress={onUseLocation} style={styles.link} accessibilityRole="button">
          <Text style={[s.control, { color: colors.accent }]}>Back to where I am</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    field: {
      flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56,
      borderBottomWidth: 1, borderBottomColor: colors.text,
    },
    input: { flex: 1, minHeight: target.min, fontFamily: font.regular, fontSize: size.body, color: colors.text, padding: 0 },
    go: { minHeight: target.min, minWidth: 64, alignItems: 'flex-end', justifyContent: 'center' },
    list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faint },
    result: { minHeight: 64, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.faint },
    tabular: { fontVariant: ['tabular-nums'] },
    link: { minHeight: target.min, justifyContent: 'center', alignSelf: 'flex-start' },
  });
