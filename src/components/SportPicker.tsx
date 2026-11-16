import { SPORTS, type Sport } from '../lib/sport';
import { Options } from './Options';

/** Ski, Snowboard, Telemark, Sit-ski, Ski touring. Chosen before you record; a saved day keeps its sport. */
export function SportPicker({ value, onChange }: { value: Sport; onChange: (s: Sport) => void }) {
  return <Options options={SPORTS} value={value} onChange={onChange} label="Sport" />;
}
