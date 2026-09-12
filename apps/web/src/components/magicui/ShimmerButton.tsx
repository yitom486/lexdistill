import React from 'react';

interface ShimmerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string;
  className?: string;
  children?: React.ReactNode;
}

export function ShimmerButton({
  className = '',
  children,
  disabled,
  ...props
}: ShimmerButtonProps) {
  return (
    <button
      disabled={disabled}
      className={`group relative overflow-hidden rounded-xl bg-tint-orange-500 hover:bg-tint-orange-600 px-6 py-2.5 font-medium text-sm text-tone-white shadow-xs hover:shadow-sm transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 cursor-pointer ${className}`}
      {...props}
    >
      <div
        className="absolute -inset-full top-0 block h-full w-1/2 -skew-x-12 bg-gradient-to-r from-transparent to-grad-whiteo30 opacity-0 group-hover:animate-shine"
        style={{
          animationDuration: '1.4s',
        }}
      />
      <span className="relative z-10 flex items-center justify-center gap-2">
        {children}
      </span>
    </button>
  );
}
