import { useSyncExternalStore } from 'react';
import { isReducedMotion, watchReducedMotion } from '../lib/css-tokens.js';

const subscribe = (notify: () => void) => watchReducedMotion(() => notify());

/** Track live OS changes without remounting learning sessions. */
export function useMotionPreference(): boolean {
  return useSyncExternalStore(subscribe, isReducedMotion, () => false);
}
