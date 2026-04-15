// ============================================================
// Primal TCG — Animation Router
// ============================================================
// Maps each animation event type to GSAP animation functions.
// Returns Promise<void> resolved when animation completes.

import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';
import type { AnimationEvent } from '@/game/engine/animationEvents';
import type { BoardLayout } from '../layout';
import { COLORS } from '../layout';
import { FONT } from '../SharedStyles';
import {
  showTurnBanner,
  showPhaseBanner,
  showDamageNumber,
  screenShake,
  screenFlash,
  particleBurst,
  showChainNotification,
  showEffectCallout,
} from '../effects/Animations';
import { showCardCloseUp } from '../effects/CardCloseUp';
import { shatterEffect } from '../effects/ShatterEffect';
import { getCardTexture } from '../AssetLoader';
import { PHASE_LABELS } from '@/lib/constants';
import type { PlayerId } from '@/game/types';

export type CardPositionMap = Map<string, { x: number; y: number; w: number; h: number; zone: string }>;

export class AnimationRouter {
  private effectsLayer: Container;
  private boardLayer: Container;
  private layout: BoardLayout;
  private humanPlayer: PlayerId | null = null;
  private cardPositions: CardPositionMap = new Map();

  constructor(effectsLayer: Container, boardLayer: Container, layout: BoardLayout) {
    this.effectsLayer = effectsLayer;
    this.boardLayer = boardLayer;
    this.layout = layout;
  }

  updateLayout(layout: BoardLayout): void {
    this.layout = layout;
  }

  setHumanPlayer(player: PlayerId): void {
    this.humanPlayer = player;
  }

  /** Update tracked card positions from the renderer each frame. */
  setCardPositions(positions: CardPositionMap): void {
    this.cardPositions = positions;
  }

  /**
   * Route an animation event to the appropriate GSAP animation.
   * Returns a promise that resolves when the animation completes.
   */
  async play(event: AnimationEvent): Promise<void> {
    const L = this.layout;

    switch (event.type) {
      case 'card-zone-change': {
        // Card summon/play close-ups always auto-dismiss (no click)
        // since the game engine keeps advancing during animations
        const cardPos = this.cardPositions.get(event.cardId);

        if (event.reason === 'summon') {
          // Fly card from hand position to center for close-up
          if (cardPos && cardPos.zone === 'hand') {
            await this.flyCardOverlay(event.defId, cardPos.x, cardPos.y, cardPos.w, cardPos.h, L.width / 2, L.height / 2, 0.3);
          }
          await showCardCloseUp(
            this.effectsLayer,
            event.defId,
            event.cardName,
            'SUMMONED!',
            L.width,
            L.height,
          );
        } else if (event.reason === 'play') {
          // Fly card from hand position to center for close-up
          if (cardPos && cardPos.zone === 'hand') {
            await this.flyCardOverlay(event.defId, cardPos.x, cardPos.y, cardPos.w, cardPos.h, L.width / 2, L.height / 2, 0.3);
          }
          await showCardCloseUp(
            this.effectsLayer,
            event.defId,
            event.cardName,
            'STRATEGY!',
            L.width,
            L.height,
          );
        } else if (event.reason === 'charge') {
          // Card slides from hand to right side (essence zone)
          if (cardPos && cardPos.zone === 'hand') {
            const essenceX = L.width - L.sideColW / 2;
            const isBottom = event.player === this.humanPlayer;
            const essenceY = isBottom ? L.playerY + L.playerH * 0.7 : L.opponentY + L.opponentH * 0.3;
            await this.flyCardOverlay(event.defId, cardPos.x, cardPos.y, cardPos.w, cardPos.h, essenceX, essenceY, 0.3);
            particleBurst(this.effectsLayer, essenceX, essenceY, COLORS.accentCyan, 8);
          }
          await delay(100);
        } else if (event.reason === 'destroy') {
          // Shatter at card's actual board position
          if (cardPos) {
            shatterEffect(this.effectsLayer, cardPos.x, cardPos.y, cardPos.w, cardPos.h, COLORS.injuredDot);
          }
          screenShake(this.boardLayer, 3, 0.2);
          await delay(200);
        } else if (event.reason === 'draw') {
          // Card slides from deck to hand area
          const isBottom = event.player === this.humanPlayer;
          const deckX = L.width - L.sideColW / 2;
          const deckY = isBottom ? L.playerY + L.playerH * 0.3 : L.opponentY + L.opponentH * 0.3;
          const handX = L.width / 2;
          const handY = isBottom ? L.height - 80 : 80;
          await this.flyCardOverlay(event.defId, deckX, deckY, 40, 56, handX, handY, 0.25);
          await delay(50);
        } else if (event.reason === 'discard') {
          // Card flies to discard pile
          if (cardPos) {
            const discardX = L.width - L.sideColW / 2;
            const isBottom = event.player === this.humanPlayer;
            const discardY = isBottom ? L.playerY + L.playerH * 0.5 : L.opponentY + L.opponentH * 0.5;
            await this.flyCardOverlay(event.defId, cardPos.x, cardPos.y, cardPos.w, cardPos.h, discardX, discardY, 0.25);
          }
          await delay(100);
        }
        break;
      }

      case 'damage-applied': {
        // Show floating damage number
        const targetX = L.width / 2 + (Math.random() - 0.5) * 100;
        const targetY = L.height / 2;
        showDamageNumber(this.effectsLayer, event.amount, targetX, targetY);
        if (event.isLethal) {
          screenShake(this.boardLayer, 5, 0.3);
        }
        await delay(300);
        break;
      }

      case 'stat-modified': {
        // Brief notification
        const changeText = `${event.cardName}: ${event.before.lead}/${event.before.support} → ${event.after.lead}/${event.after.support}`;
        showChainNotification(this.effectsLayer, changeText, L.width, L.height);
        await delay(400);
        break;
      }

      case 'counter-changed': {
        showChainNotification(
          this.effectsLayer,
          `${event.cardName}: ${event.counterType} ${event.prevCount}→${event.newCount}`,
          L.width,
          L.height,
        );
        await delay(400);
        break;
      }

      case 'chain-entry-added': {
        // Card close-up for chain entries — wait for player click
        await showCardCloseUp(
          this.effectsLayer,
          event.defId,
          event.cardName,
          `CHAIN ${event.chainIndex + 1}`,
          L.width,
          L.height,
          { waitForClick: true },
        );
        break;
      }

      case 'chain-entry-resolved': {
        const outcomeText = event.outcome === 'resolved' ? 'RESOLVED'
          : event.outcome === 'negated' ? 'NEGATED!'
          : 'FIZZLED';
        showChainNotification(
          this.effectsLayer,
          `${event.cardName} — ${outcomeText}`,
          L.width,
          L.height,
        );
        await delay(500);
        break;
      }

      case 'effect-activated': {
        // Show close-up + effect description — wait for player click
        const effectActionText = event.effectDescription
          ? `EFFECT!\n${event.effectDescription}`
          : 'EFFECT!';
        await showCardCloseUp(
          this.effectsLayer,
          event.defId,
          event.cardName,
          effectActionText,
          L.width,
          L.height,
          { waitForClick: true },
        );
        break;
      }

      case 'battle-reward': {
        screenFlash(this.effectsLayer, L.width, L.height, COLORS.accentGold);
        particleBurst(this.effectsLayer, L.width / 2, L.height / 2, COLORS.accentGold, 30);
        showChainNotification(
          this.effectsLayer,
          `BATTLE REWARD! (${event.newTotal}/10)`,
          L.width,
          L.height,
        );
        await delay(600);
        break;
      }

      case 'phase-change': {
        const phaseText = PHASE_LABELS[event.toPhase] ?? event.toPhase;
        if (event.toPhase !== 'start' && event.toPhase !== 'setup') {
          showPhaseBanner(this.effectsLayer, phaseText, L.width, L.height);
        }
        await delay(200);
        break;
      }

      case 'turn-change': {
        const label = `TURN ${event.turn}`;
        showTurnBanner(this.effectsLayer, label, L.width, L.height);
        await delay(800);
        break;
      }

      case 'card-revealed': {
        showChainNotification(
          this.effectsLayer,
          `${event.cardName} revealed!`,
          L.width,
          L.height,
        );
        await delay(300);
        break;
      }

      case 'card-targeted': {
        // Brief flash on target
        showChainNotification(
          this.effectsLayer,
          `${event.sourceCardName} → ${event.cardName}`,
          L.width,
          L.height,
        );
        await delay(300);
        break;
      }

      case 'card-destroyed': {
        screenShake(this.boardLayer, 4, 0.25);
        // Shatter at card's actual tracked position (or screen center fallback)
        const destroyPos = this.cardPositions.get(event.cardId);
        const shatterX = destroyPos ? destroyPos.x : L.width / 2 - 36;
        const shatterY = destroyPos ? destroyPos.y : L.height / 2 - 50;
        const shatterW = destroyPos ? destroyPos.w : 72;
        const shatterH = destroyPos ? destroyPos.h : 101;
        await shatterEffect(
          this.effectsLayer,
          shatterX,
          shatterY,
          shatterW,
          shatterH,
          COLORS.injuredDot,
        );
        showChainNotification(
          this.effectsLayer,
          `${event.cardName} DESTROYED!`,
          L.width,
          L.height,
        );
        await delay(200);
        break;
      }

      case 'player-notification': {
        showChainNotification(
          this.effectsLayer,
          event.message,
          L.width,
          L.height,
        );
        await delay(event.severity === 'dramatic' ? 600 : 300);
        break;
      }

      case 'coin-flip': {
        await this.playCoinFlipAnimation(event.cardName, event.results, event.headsCount, L.width, L.height);
        break;
      }
    }
  }

  /**
   * Animated coin flip with sequential flips and result display.
   */
  private playCoinFlipAnimation(
    cardName: string,
    results: ('heads' | 'tails')[],
    headsCount: number,
    screenW: number,
    screenH: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const container = new Container();
      container.alpha = 0;
      this.effectsLayer.addChild(container);

      // Backdrop
      const bg = new Graphics();
      bg.rect(0, 0, screenW, screenH);
      bg.fill({ color: 0x000000, alpha: 0.6 });
      container.addChild(bg);

      // Card name label
      const nameTxt = new Text({
        text: cardName.toUpperCase(),
        style: new TextStyle({
          fontSize: 16,
          fill: COLORS.textMuted,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 3,
        }),
      });
      nameTxt.anchor.set(0.5, 0);
      nameTxt.x = screenW / 2;
      nameTxt.y = screenH * 0.22;
      container.addChild(nameTxt);

      // "COIN FLIP" title
      const titleTxt = new Text({
        text: results.length > 1 ? `COIN FLIP x${results.length}` : 'COIN FLIP',
        style: new TextStyle({
          fontSize: 28,
          fill: COLORS.textBright,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 6,
        }),
      });
      titleTxt.anchor.set(0.5, 0);
      titleTxt.x = screenW / 2;
      titleTxt.y = screenH * 0.26;
      container.addChild(titleTxt);

      // Coin circle
      const coinSize = 80;
      const coinX = screenW / 2;
      const coinY = screenH * 0.45;

      const coin = new Graphics();
      coin.circle(0, 0, coinSize / 2);
      coin.fill({ color: 0xf59e0b });
      coin.stroke({ color: 0xfbbf24, width: 3 });
      coin.x = coinX;
      coin.y = coinY;
      container.addChild(coin);

      const coinLabel = new Text({
        text: '?',
        style: new TextStyle({
          fontSize: 32,
          fill: 0x78350f,
          fontFamily: FONT,
          fontWeight: 'bold',
        }),
      });
      coinLabel.anchor.set(0.5, 0.5);
      coinLabel.x = coinX;
      coinLabel.y = coinY;
      container.addChild(coinLabel);

      // Result text (appears after flips)
      const resultTxt = new Text({
        text: '',
        style: new TextStyle({
          fontSize: 20,
          fill: COLORS.textBright,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 2,
        }),
      });
      resultTxt.anchor.set(0.5, 0);
      resultTxt.x = screenW / 2;
      resultTxt.y = screenH * 0.62;
      container.addChild(resultTxt);

      // Individual result dots row
      const dotsContainer = new Container();
      dotsContainer.x = screenW / 2;
      dotsContainer.y = screenH * 0.68;
      container.addChild(dotsContainer);

      // Fade in
      gsap.to(container, { alpha: 1, duration: 0.2 });

      // Animate each flip sequentially
      const tl = gsap.timeline();
      const flipDuration = 0.4;
      const pauseBetween = 0.15;

      results.forEach((result, i) => {
        const startTime = i * (flipDuration + pauseBetween) + 0.3;
        const isHeads = result === 'heads';

        // Spin animation — squash Y to simulate flip
        tl.to(coin.scale, {
          y: 0.1,
          duration: flipDuration * 0.3,
          ease: 'power2.in',
        }, startTime);
        tl.to(coinLabel.scale, {
          y: 0.1,
          duration: flipDuration * 0.3,
          ease: 'power2.in',
        }, startTime);

        // At midpoint, change coin appearance
        tl.call(() => {
          coinLabel.text = isHeads ? 'H' : 'T';
          coin.clear();
          coin.circle(0, 0, coinSize / 2);
          coin.fill({ color: isHeads ? 0x22c55e : 0xef4444 });
          coin.stroke({ color: isHeads ? 0x4ade80 : 0xf87171, width: 3 });

          // Add result dot
          const dotIdx = i;
          const dotGap = 24;
          const totalDotsW = (results.length - 1) * dotGap;
          const dot = new Graphics();
          dot.circle(0, 0, 8);
          dot.fill({ color: isHeads ? 0x22c55e : 0xef4444 });
          dot.x = dotIdx * dotGap - totalDotsW / 2;
          dot.alpha = 0;
          dotsContainer.addChild(dot);

          const dotLabel = new Text({
            text: isHeads ? 'H' : 'T',
            style: new TextStyle({
              fontSize: 9,
              fill: 0xffffff,
              fontFamily: FONT,
              fontWeight: 'bold',
            }),
          });
          dotLabel.anchor.set(0.5, 0.5);
          dotLabel.x = dot.x;
          dotLabel.y = 0;
          dotLabel.alpha = 0;
          dotsContainer.addChild(dotLabel);

          gsap.to(dot, { alpha: 1, duration: 0.15 });
          gsap.to(dotLabel, { alpha: 1, duration: 0.15 });
        }, [], startTime + flipDuration * 0.3);

        // Unsquash
        tl.to(coin.scale, {
          y: 1,
          duration: flipDuration * 0.3,
          ease: 'back.out(2)',
        }, startTime + flipDuration * 0.35);
        tl.to(coinLabel.scale, {
          y: 1,
          duration: flipDuration * 0.3,
          ease: 'back.out(2)',
        }, startTime + flipDuration * 0.35);
      });

      // Show final result summary
      const summaryTime = results.length * (flipDuration + pauseBetween) + 0.5;
      tl.call(() => {
        if (results.length === 1) {
          resultTxt.text = results[0] === 'heads' ? 'HEADS!' : 'TAILS!';
          resultTxt.style.fill = results[0] === 'heads' ? 0x4ade80 : 0xf87171;
        } else {
          resultTxt.text = `${headsCount} HEADS / ${results.length - headsCount} TAILS`;
          resultTxt.style.fill = headsCount > 0 ? 0x4ade80 : 0xf87171;
        }
        resultTxt.alpha = 0;
        gsap.to(resultTxt, { alpha: 1, duration: 0.2 });
      }, [], summaryTime);

      // Fade out and clean up
      tl.to(container, {
        alpha: 0,
        duration: 0.3,
        delay: 1.2,
      }, summaryTime + 0.2);

      tl.call(() => {
        this.effectsLayer.removeChild(container);
        container.destroy({ children: true });
        resolve();
      });
    });
  }

  /**
   * Create a temporary card-like sprite on the effects layer that flies
   * from one position to another. Used for zone-change animations.
   */
  private flyCardOverlay(
    defId: string,
    fromX: number,
    fromY: number,
    cardW: number,
    cardH: number,
    toX: number,
    toY: number,
    duration: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      // Create a lightweight card representation
      const c = new Container();

      const bg = new Graphics();
      bg.roundRect(0, 0, cardW, cardH, 4);
      bg.fill({ color: COLORS.cardBack });
      c.addChild(bg);

      // Card image
      const texture = getCardTexture(defId);
      const img = new Sprite(texture);
      img.x = 2;
      img.y = 2;
      img.width = cardW - 4;
      img.height = cardH - 4;
      c.addChild(img);

      // Glow border
      const glow = new Graphics();
      glow.roundRect(-2, -2, cardW + 4, cardH + 4, 6);
      glow.stroke({ color: COLORS.accentGold, width: 2, alpha: 0.7 });
      c.addChild(glow);

      c.pivot.set(cardW / 2, cardH / 2);
      c.x = fromX + cardW / 2;
      c.y = fromY + cardH / 2;
      this.effectsLayer.addChild(c);

      const tl = gsap.timeline({
        onComplete: () => {
          this.effectsLayer.removeChild(c);
          c.destroy({ children: true });
          resolve();
        },
      });

      // Scale up slightly during flight, then settle
      tl.to(c, {
        x: toX,
        y: toY,
        duration,
        ease: 'power2.inOut',
      })
      .to(c.scale, {
        x: 1.15,
        y: 1.15,
        duration: duration * 0.5,
        ease: 'power2.out',
      }, 0)
      .to(c.scale, {
        x: 1,
        y: 1,
        duration: duration * 0.5,
        ease: 'power2.in',
      }, duration * 0.5)
      // Quick fade out at end
      .to(c, { alpha: 0, duration: 0.1 }, duration - 0.1);
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
