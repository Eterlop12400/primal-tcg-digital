// ============================================================
// Primal TCG — Field Card Activate Effect Picker Overlay
// ============================================================
// Displays available sub-effects for field card activate abilities
// (e.g., Micromon Beach). Threshold-based effects are shown with
// availability status, and the player clicks an available row to choose.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { COLORS, BoardLayout } from '../layout';
import { FONT } from '../SharedStyles';
import type { UIAction } from '@/hooks/useGameEngine';
import { fadeInOverlay } from './overlayTransitions';

interface FieldEffect {
  index: number;
  threshold: string;
  desc: string;
  available: boolean;
}

export class FieldActivateOverlay extends Container {
  constructor(
    layout: BoardLayout,
    cardName: string,
    terraWaterCount: number,
    effectId: string,
    cardId: string,
    effects: FieldEffect[],
    dispatch: (action: UIAction) => void,
    humanPlayer: string,
  ) {
    super();

    const W = layout.width;
    const H = layout.height;

    // Backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, W, H);
    backdrop.fill({ color: 0x000000, alpha: 0.75 });
    backdrop.eventMode = 'static';
    backdrop.cursor = 'default';
    this.addChild(backdrop);

    // Panel dimensions
    const panelW = Math.min(500, W - 40);
    const rowH = 56;
    const panelH = 60 + effects.length * (rowH + 8) + 60; // title + rows + cancel
    const panelX = (W - panelW) / 2;
    const panelY = (H - panelH) / 2;

    // Panel background
    const panel = new Graphics();
    panel.roundRect(panelX, panelY, panelW, panelH, 12);
    panel.fill({ color: 0x0f1729, alpha: 0.95 });
    panel.stroke({ color: 0xd4a843, width: 2, alpha: 0.8 });
    this.addChild(panel);

    // Title
    const title = new Text({
      text: cardName.toUpperCase(),
      style: new TextStyle({
        fontSize: 20,
        fill: 0xd4a843,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 3,
      }),
    });
    title.anchor.set(0.5, 0);
    title.x = W / 2;
    title.y = panelY + 14;
    this.addChild(title);

    // Subtitle — count
    const subtitle = new Text({
      text: `${terraWaterCount} Terra/Water character${terraWaterCount !== 1 ? 's' : ''} controlled`,
      style: new TextStyle({
        fontSize: 13,
        fill: COLORS.textMuted,
        fontFamily: FONT,
        letterSpacing: 1,
      }),
    });
    subtitle.anchor.set(0.5, 0);
    subtitle.x = W / 2;
    subtitle.y = panelY + 40;
    this.addChild(subtitle);

    // Effect rows
    let curY = panelY + 64;
    for (const eff of effects) {
      const rowBg = new Graphics();
      rowBg.roundRect(panelX + 12, curY, panelW - 24, rowH, 8);

      if (eff.available) {
        rowBg.fill({ color: 0x1a2744, alpha: 0.9 });
        rowBg.stroke({ color: COLORS.accentCyan, width: 1.5, alpha: 0.7 });
        rowBg.eventMode = 'static';
        rowBg.cursor = 'pointer';

        // Hover effect
        rowBg.on('pointerover', () => {
          rowBg.tint = 0xbbddff;
        });
        rowBg.on('pointerout', () => {
          rowBg.tint = 0xffffff;
        });

        // Click — dispatch activate with effectSubChoice
        const idx = eff.index;
        rowBg.on('pointerdown', () => {
          dispatch({
            type: 'PERFORM_ACTION',
            player: humanPlayer as any,
            action: {
              type: 'activate-effect',
              cardInstanceId: cardId,
              effectId,
              effectSubChoice: idx,
            },
          });
        });
      } else {
        rowBg.fill({ color: 0x111827, alpha: 0.6 });
        rowBg.stroke({ color: 0x374151, width: 1, alpha: 0.3 });
      }

      this.addChild(rowBg);

      // Threshold badge
      const badge = new Graphics();
      const badgeW = 36;
      const badgeH = 22;
      const badgeX = panelX + 20;
      const badgeY = curY + (rowH - badgeH) / 2;
      badge.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
      badge.fill({ color: eff.available ? COLORS.accentCyan : 0x374151, alpha: eff.available ? 0.3 : 0.4 });
      this.addChild(badge);

      const threshTxt = new Text({
        text: eff.threshold,
        style: new TextStyle({
          fontSize: 12,
          fill: eff.available ? COLORS.accentCyan : COLORS.textMuted,
          fontFamily: FONT,
          fontWeight: 'bold',
        }),
      });
      threshTxt.anchor.set(0.5, 0.5);
      threshTxt.x = badgeX + badgeW / 2;
      threshTxt.y = badgeY + badgeH / 2;
      this.addChild(threshTxt);

      // Description
      const descTxt = new Text({
        text: eff.desc,
        style: new TextStyle({
          fontSize: 13,
          fill: eff.available ? 0xe2e8f0 : 0x555555,
          fontFamily: FONT,
          wordWrap: true,
          wordWrapWidth: panelW - 84,
        }),
      });
      descTxt.x = panelX + 64;
      descTxt.y = curY + (rowH - descTxt.height) / 2;
      this.addChild(descTxt);

      curY += rowH + 8;
    }

    // Cancel button
    const cancelW = 100;
    const cancelH = 32;
    const cancelX = W / 2 - cancelW / 2;
    const cancelY = curY + 4;

    const cancelBg = new Graphics();
    cancelBg.roundRect(cancelX, cancelY, cancelW, cancelH, 6);
    cancelBg.fill({ color: 0x374151, alpha: 0.9 });
    cancelBg.stroke({ color: 0x6b7280, width: 1 });
    cancelBg.eventMode = 'static';
    cancelBg.cursor = 'pointer';
    cancelBg.on('pointerdown', () => {
      dispatch({ type: 'CLEAR_SELECTION' });
    });
    this.addChild(cancelBg);

    const cancelTxt = new Text({
      text: 'CANCEL',
      style: new TextStyle({
        fontSize: 13,
        fill: 0xe5e7eb,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 1,
      }),
    });
    cancelTxt.anchor.set(0.5, 0.5);
    cancelTxt.x = cancelX + cancelW / 2;
    cancelTxt.y = cancelY + cancelH / 2;
    this.addChild(cancelTxt);

    fadeInOverlay(this);
  }
}
