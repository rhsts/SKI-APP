import { Ionicons } from '@expo/vector-icons';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PhotoRow } from '../db';
import { Appear } from './Appear';
import { fmtTimeOfDay } from '../lib/format';
import { useStyles, useTheme, type Palette } from '../theme';

interface Props {
  photos: PhotoRow[];
  open: string | null;
  onOpen: (id: string | null) => void;
  onAdd: () => void;
  onRemove: (p: PhotoRow) => void;
  busy?: boolean;
}

/** The day's photos as a strip of thumbnails, with a full-screen viewer. */
export function PhotoStrip({ photos, open, onOpen, onAdd, onRemove, busy }: Props) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const current = photos.find((p) => p.id === open) ?? null;
  const idx = current ? photos.indexOf(current) : -1;

  return (
    <View style={[s.card, { gap: 12 }]}>
      <View style={styles.head}>
        <Text style={s.label}>Photos</Text>
        <Pressable onPress={onAdd} disabled={busy} hitSlop={8} style={styles.add}>
          <Ionicons name="images-outline" size={16} color={colors.accent} />
          <Text style={styles.addText}>{busy ? 'Adding…' : 'Add photos'}</Text>
        </Pressable>
      </View>
      {photos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {photos.map((p) => (
            <Pressable key={p.id} onPress={() => onOpen(p.id)} accessibilityLabel={`Photo at ${fmtTimeOfDay(p.t)}`}>
              <Image source={{ uri: p.uri }} style={styles.thumb} />
              <Text style={[s.muted, { fontSize: 11, textAlign: 'center' }]}>{fmtTimeOfDay(p.t)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={s.muted}>Pick photos from this day: they’re pinned on the map of the run you took them on.</Text>
      )}

      <Modal visible={!!current} transparent animationType="fade" onRequestClose={() => onOpen(null)}>
        <View style={styles.viewer}>
          {current ? (
            <Appear key={current.id} style={styles.full}>
              <Image source={{ uri: current.uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            </Appear>
          ) : null}
          <View style={styles.bar}>
            <Pressable onPress={() => onOpen(null)} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
            <Text style={styles.barText}>{current ? `${fmtTimeOfDay(current.t)} · ${idx + 1} of ${photos.length}` : ''}</Text>
            <Pressable
              hitSlop={12}
              accessibilityLabel="Remove photo"
              onPress={() =>
                current &&
                Alert.alert('Remove this photo from the day?', 'It stays in your gallery.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => { onRemove(current); onOpen(null); } },
                ])
              }
            >
              <Ionicons name="trash-outline" size={24} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.nav}>
            <Pressable disabled={idx <= 0} onPress={() => onOpen(photos[idx - 1]?.id ?? null)} hitSlop={12} style={{ opacity: idx <= 0 ? 0.3 : 1 }}>
              <Ionicons name="chevron-back-circle" size={44} color="#fff" />
            </Pressable>
            <Pressable disabled={idx >= photos.length - 1} onPress={() => onOpen(photos[idx + 1]?.id ?? null)} hitSlop={12} style={{ opacity: idx >= photos.length - 1 ? 0.3 : 1 }}>
              <Ionicons name="chevron-forward-circle" size={44} color="#fff" />
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    add: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    addText: { color: colors.accent, fontWeight: '700' },
    thumb: { width: 88, height: 88, borderRadius: 12, backgroundColor: colors.faint },
    viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' },
    full: { width: '100%', height: '75%' },
    bar: { position: 'absolute', top: 48, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    barText: { color: '#fff', fontWeight: '600' },
    nav: { position: 'absolute', bottom: 48, left: 24, right: 24, flexDirection: 'row', justifyContent: 'space-between' },
  });
