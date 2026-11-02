import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Google Maps on Android needs an API key built into the app; without one the
 * map crashes the app as soon as it opens. Expo Go has its own key, and iOS
 * uses Apple Maps, so only installed Android builds can be missing it.
 */
export const mapsAvailable: boolean =
  Platform.OS !== 'android' ||
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  Constants.expoConfig?.extra?.mapsKeyPresent === true;
