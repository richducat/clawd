'use client';

import type { ReactNode } from 'react';

export default function Card({
  children,
  className = '',
  onClick,
  noBlur,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  noBlur?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden rounded-2xl border border-white/5 ${
        noBlur ? 'bg-zinc-900' : 'bg-zinc-900/60 backdrop-blur-md'
      } ${onClick ? 'cursor-pointer active:scale-[0.98] transition-transform' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
