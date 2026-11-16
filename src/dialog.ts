import { useSyncExternalStore } from 'react';

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface DialogSpec {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
}

let queue: DialogSpec[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * A message or a question in the app's own look, drawn by <DialogHost />. Takes the same
 * arguments as Alert.alert. A second one asked while the first is open waits its turn.
 */
export function dialog(title: string, message?: string, buttons?: DialogButton[]) {
  queue = [...queue, { id: nextId++, title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] }];
  emit();
}

export function closeDialog() {
  queue = queue.slice(1);
  emit();
}

export function useDialog(): DialogSpec | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => queue[0] ?? null,
  );
}
