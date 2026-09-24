import confetti from 'canvas-confetti';
import { readCssCustomProperty } from '../../lib/css-tokens.js';

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
  const count = 120;
  const palette = readCelebrationPalette();
  const defaults = {
    origin: { y: 0.7 },
    zIndex: 9999,
  };

  function fire(particleRatio: number, opts: confetti.Options) {
    confetti({
      ...defaults,
      ...opts,
      particleCount: Math.floor(count * particleRatio),
    });
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
}
