import { closeDialog, dialog, useDialog } from '../src/dialog';
import { renderHook, act } from '@testing-library/react-native';

describe('dialog', () => {
  it('shows one at a time, in the order asked, and defaults to a single OK', async () => {
    const { result } = await renderHook(() => useDialog());
    expect(result.current).toBeNull();
    await act(async () => {
      dialog('First');
      dialog('Second', 'Why', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive' }]);
    });
    expect(result.current).toMatchObject({ title: 'First', buttons: [{ text: 'OK' }] });
    await act(async () => closeDialog());
    expect(result.current).toMatchObject({ title: 'Second', message: 'Why' });
    expect(result.current?.buttons.map((b) => b.text)).toEqual(['Cancel', 'Delete']);
    await act(async () => closeDialog());
    expect(result.current).toBeNull();
  });
});
