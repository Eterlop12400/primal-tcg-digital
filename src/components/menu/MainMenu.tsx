'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { MenuRenderer } from '@/pixi/MenuRenderer';

export function MainMenu() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MenuRenderer | null>(null);

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

      <div className="relative z-10 flex gap-6 max-w-2xl w-full">
        {/* Player vs AI */}
        <button
          onClick={() => router.push('/game?mode=pvai')}
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
          onClick={() => router.push('/game?mode=aivai')}
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

      <p className="relative z-10 mt-12 text-white/20 text-xs">
        Starter Deck 1: Slayer Guild (Necro/Plasma)
      </p>
    </div>
  );
}
