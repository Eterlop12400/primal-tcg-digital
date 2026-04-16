'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PixiGameCanvas } from '@/pixi/PixiGameCanvas';
import type { GameMode } from '@/hooks/useGameEngine';

function GameContent() {
  const searchParams = useSearchParams();
  const mode = (searchParams.get('mode') as GameMode) ?? 'pvai';
  const p1Deck = searchParams.get('p1deck') ?? undefined;
  const p2Deck = searchParams.get('p2deck') ?? undefined;

  return <PixiGameCanvas mode={mode} p1Deck={p1Deck} p2Deck={p2Deck} />;
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
