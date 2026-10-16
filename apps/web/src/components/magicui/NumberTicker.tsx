import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useInView, useMotionValue, useSpring } from 'framer-motion';
import { cn } from '../../lib/utils.js';
import { useMotionPreference } from '../../hooks/useMotionPreference.js';

interface NumberTickerProps {
  value: number;
  direction?: 'up' | 'down';
  className?: string;
  delay?: number;
  decimalPlaces?: number;
}

export function NumberTicker({
  value,
  direction = 'up',
  delay = 0,
  className = '',
  decimalPlaces = 0,
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useMotionPreference();
  const target = direction === 'down' ? 0 : value;
  const motionValue = useMotionValue(direction === 'down' ? value : 0);
  const springValue = useSpring(motionValue, {
    damping: 24,
    stiffness: 120,
  });
  const isInView = useInView(ref, { once: true, margin: '0px' });

  useLayoutEffect(() => {
    if (!reduced) return;
    motionValue.jump(target);
    springValue.jump(target);
    if (ref.current) ref.current.textContent = Number(target).toFixed(decimalPlaces);
  }, [reduced, target, decimalPlaces, motionValue, springValue]);

  useEffect(() => {
    if (isInView && !reduced) {
      const timer = setTimeout(() => {
        motionValue.set(direction === 'down' ? 0 : value);
      }, delay * 1000);
      return () => clearTimeout(timer);
    }
  }, [motionValue, isInView, delay, value, direction, reduced]);

  useEffect(() => {
    return springValue.on('change', (latest) => {
      if (ref.current) {
        ref.current.textContent = Number(reduced ? target : latest).toFixed(decimalPlaces);
      }
    });
  }, [springValue, decimalPlaces, reduced, target]);

  return (
    <span
      className={cn(
        'inline-block font-mono tabular-nums select-none tracking-tight',
        className
      )}
      ref={ref}
    >
      {Number(reduced ? target : value).toFixed(decimalPlaces)}
    </span>
  );
}

