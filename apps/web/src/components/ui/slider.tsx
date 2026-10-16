import * as React from 'react';
import { Slider as BaseSlider } from '@base-ui-components/react/slider';
import { cn } from '../../lib/utils.js';

export const Slider = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSlider.Root>
>(({ className, ...props }, ref) => (
  <BaseSlider.Root
    ref={ref}
    className={cn(
      'relative flex w-full touch-none select-none items-center cursor-pointer',
      className
    )}
    {...props}
  >
    <BaseSlider.Control className="relative flex h-2 w-full items-center rounded-full bg-line-soft">
      <BaseSlider.Track className="relative h-full w-full rounded-full">
        <BaseSlider.Indicator className="absolute h-full rounded-full bg-tint-amber-500-amber-600" />
        <BaseSlider.Thumb aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']} className="block h-4 w-4 rounded-full border-2 border-tone-amber-600 bg-tone-white shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tone-amber-500" />
      </BaseSlider.Track>
    </BaseSlider.Control>
  </BaseSlider.Root>
));
Slider.displayName = 'Slider';
