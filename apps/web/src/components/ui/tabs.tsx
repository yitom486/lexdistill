import * as React from 'react';
import { Tabs as TabsPrimitive } from '@base-ui-components/react/tabs';
import { cn } from '../../lib/utils.js';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-2xl bg-veil-sand-clay p-1 text-ink-stone-500 relative border border-tone-stone-200o80-stone-800',
      className
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

const TabsIndicator = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Indicator>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Indicator>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Indicator
    ref={ref}
    className={cn(
      'absolute rounded-xl bg-surface-espresso shadow-xs transition-all z-0 pointer-events-none',
      className
    )}
    {...props}
  />
));
TabsIndicator.displayName = 'TabsIndicator';

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Tab>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Tab>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Tab
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-xl px-3.5 py-2 text-xs sm:text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:pointer-events-none disabled:opacity-50 text-ink-faint-soft hover:text-tone-stone-900 dark:hover:text-ink-stone-200 aria-selected:text-ink-amber-950 dark:aria-selected:text-ink-amber-300 aria-selected:font-semibold cursor-pointer relative z-10 gap-2 shrink-0 select-none',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Panel>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Panel>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Panel
    ref={ref}
    className={cn(
      'mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsIndicator };
