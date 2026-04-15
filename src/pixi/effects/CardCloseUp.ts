// ============================================================
// Primal TCG — Card Close-Up Effect (Master Duel signature)
// ============================================================
// When a card is played/activated: zoom to center screen, dim
// background, show card name + action text. Duration ~1.2s.

import { Container, Graphics, Text, TextStyle, Sprite } from 'pixi.js';
import gsap from 'gsap';
import { getCardTexture } from '../AssetLoader';
import { COLORS, CARD_SIZES } from '../layout';
import { FONT } from '../SharedStyles';
import { particleBurst } from './Animations';

export interface CardCloseUpOptions {
  waitForClick?: boolean; // If true, pause until player clicks to continue
}

export function showCardCloseUp(
  parent: Container,
  defId: string,
  cardName: string,
  actionText: string, // e.g., "Summoned!", "Effect Activated!"
  screenW: number,
  screenH: number,
  options?: CardCloseUpOptions,
): Promise<void> {
  const waitForClick = options?.waitForClick ?? false;

  return new Promise((resolve) => {
    const container = new Container();

    // Radial vignette backdrop (darker at edges, less dim at center)
    const backdrop = new Graphics();
    backdrop.rect(0, 0, screenW, screenH);
    backdrop.fill({ color: 0x000000, alpha: 0.75 });
    backdrop.eventMode = 'static'; // block clicks through
    container.addChild(backdrop);

    // Radial vignette ring (extra darkening at edges)
    const vignette = new Graphics();
    const vigR = Math.max(screenW, screenH) * 0.6;
    vignette.circle(screenW / 2, screenH / 2, vigR);
    vignette.fill({ color: 0x000000, alpha: 0.0 }); // transparent center
    // Dark border ring
    vignette.rect(0, 0, screenW, screenH);
    vignette.fill({ color: 0x000000, alpha: 0.15 });
    container.addChild(vignette);

    // Card image
    const cardSize = { width: 160, height: 224 };
    const cardContainer = new Container();

    // Card border glow (behind the card, in symbol color)
    const behindGlow = new Graphics();
    behindGlow.roundRect(-8, -8, cardSize.width + 16, cardSize.height + 16, 14);
    behindGlow.fill({ color: COLORS.accentGold, alpha: 0.12 });
    cardContainer.addChild(behindGlow);

    const cardBg = new Graphics();
    cardBg.roundRect(0, 0, cardSize.width, cardSize.height, 8);
    cardBg.fill({ color: COLORS.cardBack });
    cardContainer.addChild(cardBg);

    const texture = getCardTexture(defId);
    const img = new Sprite(texture);
    img.x = 3;
    img.y = 3;
    img.width = cardSize.width - 6;
    img.height = cardSize.height - 6;
    cardContainer.addChild(img);

    // Glow border
    const glow = new Graphics();
    glow.roundRect(-4, -4, cardSize.width + 8, cardSize.height + 8, 12);
    glow.stroke({ color: COLORS.accentGold, width: 3, alpha: 0.7 });
    cardContainer.addChild(glow);

    cardContainer.pivot.set(cardSize.width / 2, cardSize.height / 2);
    cardContainer.x = screenW / 2;
    cardContainer.y = screenH / 2 - 20;
    container.addChild(cardContainer);

    // Card name text
    const nameTxt = new Text({
      text: cardName.toUpperCase(),
      style: new TextStyle({
        fontSize: 20,
        fill: COLORS.textBright,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 3,
      }),
    });
    nameTxt.anchor.set(0.5, 0);
    nameTxt.x = screenW / 2;
    nameTxt.y = screenH / 2 + cardSize.height / 2 + 10;
    container.addChild(nameTxt);

    // Action text (e.g. "Summoned!" or multi-line effect description)
    const actionTxt = new Text({
      text: actionText,
      style: new TextStyle({
        fontSize: 14,
        fill: COLORS.accentGold,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 1,
        wordWrap: true,
        wordWrapWidth: screenW * 0.6,
        align: 'center',
      }),
    });
    actionTxt.anchor.set(0.5, 0);
    actionTxt.x = screenW / 2;
    actionTxt.y = nameTxt.y + nameTxt.height + 6;
    container.addChild(actionTxt);

    // "Tap to continue" hint (only shown when waitForClick)
    let hintTxt: Text | null = null;
    if (waitForClick) {
      hintTxt = new Text({
        text: 'TAP TO CONTINUE',
        style: new TextStyle({
          fontSize: 12,
          fill: COLORS.textMuted,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 2,
        }),
      });
      hintTxt.anchor.set(0.5, 0);
      hintTxt.x = screenW / 2;
      hintTxt.y = actionTxt.y + actionTxt.height + 20;
      hintTxt.alpha = 0; // fades in after card animation
      container.addChild(hintTxt);
    }

    // Start hidden — text also starts off for stagger
    container.alpha = 0;
    cardContainer.scale.set(0.5);
    nameTxt.alpha = 0;
    actionTxt.alpha = 0;
    parent.addChild(container);

    const cleanup = () => {
      parent.removeChild(container);
      container.destroy({ children: true });
      resolve();
    };

    if (waitForClick) {
      // Animate in, then hold until clicked
      const tl = gsap.timeline();

      tl.to(container, { alpha: 1, duration: 0.15 })
        .to(cardContainer.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(1.7)' }, '<')
        .call(() => {
          particleBurst(container, screenW / 2, screenH / 2 - 20, COLORS.accentGold, 16);
        })
        .to(nameTxt, { alpha: 1, duration: 0.2 }, '+=0.1')
        .to(actionTxt, { alpha: 1, duration: 0.2 }, '+=0.05')
        .to({}, { duration: 0.1 })
        .call(() => {
          // Show hint text and pulse it
          if (hintTxt) {
            gsap.to(hintTxt, { alpha: 1, duration: 0.3 });
            gsap.to(hintTxt, {
              alpha: 0.4,
              duration: 0.8,
              repeat: -1,
              yoyo: true,
              ease: 'sine.inOut',
            });
          }

          // Make backdrop clickable to dismiss
          backdrop.cursor = 'pointer';
          backdrop.on('pointerdown', () => {
            // Fade out then cleanup
            gsap.to(container, {
              alpha: 0,
              y: -20,
              duration: 0.2,
              ease: 'power2.in',
              onComplete: cleanup,
            });
          });
        });
    } else {
      // Auto-dismiss with dramatic entrance
      const tl = gsap.timeline({
        onComplete: cleanup,
      });

      // Animate in
      tl.to(container, { alpha: 1, duration: 0.15 })
        .to(cardContainer.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(1.7)' }, '<')
        // Particle burst on card appear
        .call(() => {
          particleBurst(container, screenW / 2, screenH / 2 - 20, COLORS.accentGold, 16);
        })
        // Staggered text reveal
        .to(nameTxt, { alpha: 1, duration: 0.15 }, '+=0.05')
        .to(actionTxt, { alpha: 1, duration: 0.15 }, '+=0.05')
        // Hold
        .to(container, { duration: 0.4 })
        // Fade out upward
        .to(container, { alpha: 0, y: -20, duration: 0.2, ease: 'power2.in' });
    }
  });
}

// Convenience function for common close-up scenarios
export function showSummonCloseUp(
  parent: Container,
  defId: string,
  cardName: string,
  screenW: number,
  screenH: number,
  options?: CardCloseUpOptions,
): Promise<void> {
  return showCardCloseUp(parent, defId, cardName, 'SUMMONED!', screenW, screenH, options);
}

export function showEffectCloseUp(
  parent: Container,
  defId: string,
  cardName: string,
  screenW: number,
  screenH: number,
  options?: CardCloseUpOptions,
): Promise<void> {
  return showCardCloseUp(parent, defId, cardName, 'EFFECT ACTIVATED!', screenW, screenH, options);
}
