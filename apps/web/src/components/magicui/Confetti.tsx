import confetti from 'canvas-confetti';
import { isReducedMotion, readCssCustomProperty, watchReducedMotion } from '../../lib/css-tokens.js';

function readCelebrationPalette() {
  return {
    orange: readCssCustomProperty('--visual-confetti-orange'),
    orangeLight: readCssCustomProperty('--visual-confetti-orange-light'),
    amber: readCssCustomProperty('--visual-confetti-amber'),
    orangeDeep: readCssCustomProperty('--visual-confetti-orange-deep'),
    rose: readCssCustomProperty('--visual-confetti-rose'),
    emerald: readCssCustomProperty('--visual-confetti-emerald'),
    yellow: readCssCustomProperty('--visual-confetti-yellow'),
    peach: readCssCustomProperty('--visual-confetti-peach'),
  };
}

export function fireSuccessConfetti() {
  // R10：减少动态效果时跳过纸屑（成功toast照常，业务终态不变）
  if (isReducedMotion()) return;
  const stopWatching = watchReducedMotion((reduced) => {
    if (reduced) confetti.reset();
  });
  const flights: Array<Promise<undefined> | null> = [];
  const count = 120;
  const palette = readCelebrationPalette();
  const defaults = {
    origin: { y: 0.7 },
    zIndex: 9999,
  };

  function fire(particleRatio: number, opts: confetti.Options) {
    flights.push(confetti({
      ...defaults,
      ...opts,
      particleCount: Math.floor(count * particleRatio),
    }));
  }

  fire(0.25, {
    spread: 26,
    startVelocity: 55,
    colors: [palette.orange, palette.orangeLight, palette.amber],
  });
  fire(0.2, {
    spread: 60,
    colors: [palette.orangeDeep, palette.rose, palette.emerald],
  });
  fire(0.35, {
    spread: 100,
    decay: 0.91,
    scalar: 0.8,
    colors: [palette.orange, palette.yellow, palette.peach],
  });
  fire(0.1, {
    spread: 120,
    startVelocity: 25,
    decay: 0.92,
    scalar: 1.2,
  });
  fire(0.1, {
    spread: 120,
    startVelocity: 45,
  });
  void Promise.all(flights).finally(stopWatching);
}
