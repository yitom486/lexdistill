import { motion } from 'framer-motion';
import { useMotionPreference } from '../../hooks/useMotionPreference.js';
import { readCssDurationSeconds } from '../../lib/css-tokens.js';

export function UpdateAvailableDot() {
  const reduced = useMotionPreference();
  const className = 'absolute right-1 top-1 w-1.5 h-1.5 rounded-full bg-gold-warm';
  if (reduced) return <span aria-hidden className={className} />;
  return (
    <motion.span
      aria-hidden
      className={className}
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{ duration: readCssDurationSeconds('--motion-shine-duration'), repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}
