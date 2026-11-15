/** The app's own dialog: it shows what `dialog()` asks, closes on an answer, and then runs that answer. */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { dialog } from '../../src/dialog';

jest.mock('../../src/settings', () => {
  const s = { theme: 'light', vibrate: false };
  return { useSettings: () => s, getSettings: () => s };
});
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => undefined), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-screens', () => ({ FullWindowOverlay: ({ children }: { children: unknown }) => children }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// eslint-disable-next-line import/first
import { DialogHost } from '../../src/components/DialogHost';

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('dialog host', () => {
  it('shows a question, closes on the answer, then runs it', async () => {
    const onDelete = jest.fn();
    const onCancel = jest.fn();
    await render(<DialogHost />);
    expect(screen.queryByText('Delete this day?')).toBeNull();

    await act(async () => {
      dialog('Delete this day?', 'This can’t be undone.', [
        { text: 'Cancel', style: 'cancel', onPress: onCancel },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ]);
    });
    expect(screen.getByText('Delete this day?')).toBeTruthy();
    expect(screen.getByText('This can’t be undone.')).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByLabelText('Delete')); });
    expect(screen.queryByText('Delete this day?')).toBeNull();
    await tick();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a tap outside is the cancel answer, and a plain message gets an OK', async () => {
    const onCancel = jest.fn();
    await render(<DialogHost />);
    await act(async () => { dialog('Log out?', undefined, [{ text: 'Cancel', style: 'cancel', onPress: onCancel }, { text: 'Log out' }]); });
    await act(async () => { fireEvent.press(screen.getByLabelText('Close')); });
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Log out?')).toBeNull();

    await act(async () => { dialog('Password changed'); });
    await act(async () => { fireEvent.press(screen.getByLabelText('OK')); });
    expect(screen.queryByText('Password changed')).toBeNull();
  });
});
