import confetti from 'canvas-confetti';
import { readCssCustomProperty } from '../lib/css-tokens.js';

function celebrationColors() {
  return {
    amber: readCssCustomProperty('--visual-confetti-amber'),
    emerald: readCssCustomProperty('--visual-confetti-emerald'),
    rose: readCssCustomProperty('--visual-confetti-rose'),
    orange: readCssCustomProperty('--visual-confetti-orange'),
    orangeLight: readCssCustomProperty('--visual-confetti-orange-light'),
    orangeDeep: readCssCustomProperty('--visual-confetti-orange-deep'),
    yellow: readCssCustomProperty('--visual-confetti-yellow'),
    peach: readCssCustomProperty('--visual-confetti-peach'),
  };
}

/**
 * 触发日常任务达成彩带庆祝效果
 */
export function fireTaskCompletedConfetti() {
  const colors = celebrationColors();
  confetti({
    particleCount: 60,
    spread: 65,
    origin: { y: 0.7 },
    colors: [colors.amber, colors.emerald, colors.orangeLight, colors.rose, colors.orange],
    disableForReducedMotion: true,
  });
}

/**
 * 触发“超额连刷 / 状态极佳”金色微光彩带粒子爆破
 */
export function fireGoldenBurstConfetti() {
  const colors = celebrationColors();
  const count = 100;
  const defaults = {
    origin: { y: 0.65 },
    disableForReducedMotion: true,
  };

  function fire(particleRatio: number, opts: confetti.Options) {
    confetti({
      ...defaults,
      ...opts,
      particleCount: Math.floor(count * particleRatio),
    });
  }

  fire(0.3, {
    spread: 40,
    startVelocity: 45,
    colors: [colors.yellow, colors.amber, colors.orangeLight],
  });

  fire(0.25, {
    spread: 75,
    colors: [colors.peach, colors.yellow, colors.orangeDeep],
  });

  fire(0.2, {
    spread: 100,
    decay: 0.92,
    scalar: 1.1,
    colors: [colors.orangeLight, colors.amber, colors.peach],
  });
}
