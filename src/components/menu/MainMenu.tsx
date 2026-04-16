'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MenuRenderer } from '@/pixi/MenuRenderer';
import { DECK_OPTIONS } from '@/game/engine/gameSetup';
import type { GameMode } from '@/hooks/useGameEngine';

type Step = 'mode-select' | 'deck-select';

export function MainMenu() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MenuRenderer | null>(null);

  const [step, setStep] = useState<Step>('mode-select');
  const [selectedMode, setSelectedMode] = useState<GameMode>('pvai');
  const [p1Deck, setP1Deck] = useState(DECK_OPTIONS[0].id);
  const [p2Deck, setP2Deck] = useState(DECK_OPTIONS[1].id);

  useEffect(() => {
    if (!canvasRef.current || rendererRef.current) return;
    const renderer = new MenuRenderer();
    rendererRef.current = renderer;
    renderer.init(canvasRef.current);

    const handleResize = () => renderer.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  const handleModeSelect = (mode: GameMode) => {
    setSelectedMode(mode);
    setStep('deck-select');
  };

  const handleStart = () => {
    router.push(`/game?mode=${selectedMode}&p1deck=${p1Deck}&p2deck=${p2Deck}`);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0d1117] px-4 relative">
      {/* Animated PixiJS background */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 0 }}
      />

      {/* Content overlay */}
      <div className="relative z-10 text-center mb-16">
        <h1 className="text-6xl font-bold tracking-tight text-white mb-2">
          PRIMAL <span className="text-amber-400">TCG</span>
        </h1>
        <p className="text-xl text-white/40 font-light tracking-widest uppercase">
          Digital
        </p>
      </div>

      {step === 'mode-select' && (
        <div className="relative z-10 flex gap-6 max-w-2xl w-full">
          {/* Player vs AI */}
          <button
            onClick={() => handleModeSelect('pvai')}
            className="group flex-1 rounded-xl border border-white/10 bg-white/5 p-8 text-left transition-all hover:border-amber-400/40 hover:bg-amber-400/5 hover:shadow-lg hover:shadow-amber-400/10"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-amber-400/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <span className="text-white/30 text-lg">vs</span>
              <div className="w-10 h-10 rounded-lg bg-cyan-400/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Player vs AI</h2>
            <p className="text-sm text-white/50">
              Challenge the AI opponent in a strategic card battle
            </p>
          </button>

          {/* AI vs AI */}
          <button
            onClick={() => handleModeSelect('aivai')}
            className="group flex-1 rounded-xl border border-white/10 bg-white/5 p-8 text-left transition-all hover:border-cyan-400/40 hover:bg-cyan-400/5 hover:shadow-lg hover:shadow-cyan-400/10"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-cyan-400/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-white/30 text-lg">vs</span>
              <div className="w-10 h-10 rounded-lg bg-cyan-400/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">AI vs AI</h2>
            <p className="text-sm text-white/50">
              Watch two AIs battle it out with speed control
            </p>
          </button>
        </div>
      )}

      {step === 'deck-select' && (
        <div className="relative z-10 max-w-lg w-full">
          <div className="rounded-xl border border-white/10 bg-white/5 p-8">
            <h2 className="text-xl font-semibold text-white mb-6 text-center">
              Choose Decks
            </h2>

            <div className="space-y-6">
              {/* Player 1 / Your Deck */}
              <DeckPicker
                label={selectedMode === 'pvai' ? 'Your Deck' : 'Player 1'}
                value={p1Deck}
                onChange={setP1Deck}
                accent="amber"
              />

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-white/30 text-sm uppercase tracking-wider">vs</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              {/* Player 2 / AI Deck */}
              <DeckPicker
                label={selectedMode === 'pvai' ? 'AI Deck' : 'Player 2'}
                value={p2Deck}
                onChange={setP2Deck}
                accent="cyan"
              />
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setStep('mode-select')}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 py-3 text-white/60 font-medium transition-all hover:bg-white/10 hover:text-white"
              >
                Back
              </button>
              <button
                onClick={handleStart}
                className="flex-1 rounded-lg bg-amber-400 py-3 text-black font-semibold transition-all hover:bg-amber-300 hover:shadow-lg hover:shadow-amber-400/20"
              >
                Start Game
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'mode-select' && (
        <p className="relative z-10 mt-12 text-white/20 text-xs">
          2 starter decks available
        </p>
      )}
    </div>
  );
}

function DeckPicker({
  label,
  value,
  onChange,
  accent,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  accent: 'amber' | 'cyan';
}) {
  const accentClasses = accent === 'amber'
    ? { active: 'border-amber-400/60 bg-amber-400/10', dot: 'bg-amber-400' }
    : { active: 'border-cyan-400/60 bg-cyan-400/10', dot: 'bg-cyan-400' };

  return (
    <div>
      <label className="block text-sm text-white/50 mb-2 uppercase tracking-wider">
        {label}
      </label>
      <div className="space-y-2">
        {DECK_OPTIONS.map((deck) => (
          <button
            key={deck.id}
            onClick={() => onChange(deck.id)}
            className={`w-full rounded-lg border p-3 text-left transition-all ${
              value === deck.id
                ? accentClasses.active
                : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  value === deck.id ? accentClasses.dot : 'bg-white/20'
                }`}
              />
              <div>
                <div className="text-white font-medium">{deck.name}</div>
                <div className="text-white/40 text-xs">{deck.theme}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
