'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PixiGameCanvas } from '@/pixi/PixiGameCanvas';
import type { GameMode } from '@/hooks/useGameEngine';

function GameContent() {
  const searchParams = useSearchParams();
  const mode = (searchParams.get('mode') as GameMode) ?? 'pvai';

  return <PixiGameCanvas mode={mode} />;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d1117]">
      <div className="text-white/40 text-lg">Loading game...</div>
    </div>
  );
}

export function GameClient() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <GameContent />
    </Suspense>
  );
}
