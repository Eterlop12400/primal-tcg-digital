'use client';

import React from 'react';
import { SYMBOL_COLORS } from '@/lib/constants';

interface BadgeProps {
  type: string;
  label?: string;
}

export default function Badge({ type, label }: BadgeProps) {
  const color = SYMBOL_COLORS[type.toLowerCase()] ?? '#9ca3af';
  const displayLabel = label ?? type;

  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `${color}33`,
        color: color,
      }}
    >
      {displayLabel}
    </span>
  );
}
