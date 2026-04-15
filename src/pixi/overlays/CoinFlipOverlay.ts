// ============================================================
// Primal TCG — Coin Flip Overlay (PixiJS)
// ============================================================
// Shows who goes first at game start, auto-dismisses with GSAP.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';
import { COLORS, BoardLayout } from '../layout';
import { FONT } from '../SharedStyles';
import type { GameState, PlayerId } from '@/game/types';
import type { GameMode } from '@/hooks/useGameEngine';

export class CoinFlipOverlay extends Container {
  constructor(
    state: GameState,
    mode: GameMode,
    humanPlayer: PlayerId,
    layout: BoardLayout,
  ) {
    super();

    const firstPlayer = state.currentTurn;
    const isYouFirst = mode === 'pvai' && firstPlayer === humanPlayer;

    const label = mode === 'pvai'
      ? (isYouFirst ? 'You go first!' : 'Opponent goes first!')
      : (firstPlayer === 'player1' ? 'Player 1 goes first!' : 'Player 2 goes first!');

    const accentColor = isYouFirst || firstPlayer === 'player1'
      ? COLORS.accentCyan
      : COLORS.buttonDanger;

    // Center card
    const card = new Container();

    const cardW = 260;
    const cardH = 120;
    const bg = new Graphics();
    bg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 16);
    bg.fill({ color: 0x0c1425, alpha: 0.95 });
    bg.stroke({ color: accentColor, width: 2, alpha: 0.6 });
    card.addChild(bg);

    // Coin circle
    const coinR = 24;
    const coin = new Graphics();
    coin.circle(0, -20, coinR);
    coin.fill({ color: 0xf59e0b, alpha: 0.2 });
    coin.stroke({ color: 0xf59e0b, width: 2, alpha: 0.5 });
    card.addChild(coin);

    const coinTxt = new Text({
      text: 'C',
      style: new TextStyle({
        fontSize: 20,
        fill: 0xf59e0b,
        fontFamily: FONT,
        fontWeight: 'bold',
      }),
    });
    coinTxt.anchor.set(0.5, 0.5);
    coinTxt.y = -20;
    card.addChild(coinTxt);

    // "Coin Flip" sub-label
    const subTxt = new Text({
      text: 'COIN FLIP',
      style: new TextStyle({
        fontSize: 9,
        fill: COLORS.textMuted,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 4,
      }),
    });
    subTxt.anchor.set(0.5, 0.5);
    subTxt.y = 14;
    card.addChild(subTxt);

    // Main label
    const mainTxt = new Text({
      text: label,
      style: new TextStyle({
        fontSize: 20,
        fill: accentColor,
        fontFamily: FONT,
        fontWeight: 'bold',
      }),
    });
    mainTxt.anchor.set(0.5, 0.5);
    mainTxt.y = 38;
    card.addChild(mainTxt);

    card.x = layout.width / 2;
    card.y = layout.height / 2;
    card.alpha = 0;
    card.scale.set(0.8);
    this.addChild(card);

    // GSAP animation: pop in, hold, fade out, destroy
    const tl = gsap.timeline({
      onComplete: () => {
        this.parent?.removeChild(this);
        this.destroy();
      },
    });

    tl.to(card, { alpha: 1, duration: 0.3, ease: 'power2.out' })
      .to(card.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out' }, '<')
      .to(card, { duration: 2 }) // hold
      .to(card, { alpha: 0, y: card.y - 30, duration: 0.5, ease: 'power2.in' });
  }
}
