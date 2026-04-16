// ============================================================
// Primal TCG — Essence Activate Overlay
// ============================================================
// Displays activatable strategy cards in the player's essence zone.
// Player clicks a card to activate its effect from essence.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { COLORS, BoardLayout } from '../layout';
import { FONT } from '../SharedStyles';
import { CardSprite } from '../CardSprite';
import type { UIAction } from '@/hooks/useGameEngine';
import type { GameState } from '@/game/types';
import { getCardDefForInstance } from '@/game/engine/utils';
import type { StrategyCardDef, CardEffectDef } from '@/game/types';

interface ActivatableCard {
  instanceId: string;
  defId: string;
  name: string;
  effectId: string;
  effectDescription: string;
}

export class EssenceActivateOverlay extends Container {
  constructor(
    layout: BoardLayout,
    state: GameState,
    cards: ActivatableCard[],
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
    backdrop.on('pointerdown', () => {
      dispatch({ type: 'CLEAR_SELECTION' });
    });
    this.addChild(backdrop);

    // Panel dimensions
    const panelW = Math.min(520, W - 40);
    const rowH = 72;
    const panelH = 60 + cards.length * (rowH + 8) + 60;
    const panelX = (W - panelW) / 2;
    const panelY = (H - panelH) / 2;

    // Panel background
    const panel = new Graphics();
    panel.roundRect(panelX, panelY, panelW, panelH, 12);
    panel.fill({ color: 0x0f1729, alpha: 0.95 });
    panel.stroke({ color: 0xd4a843, width: 2, alpha: 0.8 });
    panel.eventMode = 'static'; // prevent click-through
    this.addChild(panel);

    // Title
    const title = new Text({
      text: 'ACTIVATE FROM ESSENCE',
      style: new TextStyle({
        fontSize: 18,
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

    // Subtitle
    const subtitle = new Text({
      text: 'Choose a card to activate',
      style: new TextStyle({
        fontSize: 13,
        fill: COLORS.textMuted,
        fontFamily: FONT,
        letterSpacing: 1,
      }),
    });
    subtitle.anchor.set(0.5, 0);
    subtitle.x = W / 2;
    subtitle.y = panelY + 38;
    this.addChild(subtitle);

    // Card rows
    let curY = panelY + 60;
    for (const card of cards) {
      const rowBg = new Graphics();
      rowBg.roundRect(panelX + 12, curY, panelW - 24, rowH, 8);
      rowBg.fill({ color: 0x1a2744, alpha: 0.9 });
      rowBg.stroke({ color: COLORS.accentCyan, width: 1.5, alpha: 0.7 });
      rowBg.eventMode = 'static';
      rowBg.cursor = 'pointer';

      rowBg.on('pointerover', () => { rowBg.tint = 0xbbddff; });
      rowBg.on('pointerout', () => { rowBg.tint = 0xffffff; });

      const cardInstanceId = card.instanceId;
      const effectId = card.effectId;
      rowBg.on('pointerdown', () => {
        dispatch({ type: 'CLEAR_SELECTION' });
        dispatch({
          type: 'PERFORM_ACTION',
          player: humanPlayer as any,
          action: {
            type: 'activate-effect',
            cardInstanceId,
            effectId,
          },
        });
      });

      this.addChild(rowBg);

      // Card name
      const nameTxt = new Text({
        text: card.name,
        style: new TextStyle({
          fontSize: 15,
          fill: 0xe2e8f0,
          fontFamily: FONT,
          fontWeight: 'bold',
        }),
      });
      nameTxt.x = panelX + 24;
      nameTxt.y = curY + 8;
      this.addChild(nameTxt);

      // Effect description
      const descTxt = new Text({
        text: card.effectDescription,
        style: new TextStyle({
          fontSize: 11,
          fill: COLORS.textMuted,
          fontFamily: FONT,
          wordWrap: true,
          wordWrapWidth: panelW - 52,
        }),
      });
      descTxt.x = panelX + 24;
      descTxt.y = curY + 28;
      this.addChild(descTxt);

      // "ACTIVATE" badge
      const badgeW = 72;
      const badgeH = 22;
      const badgeX = panelX + panelW - 24 - badgeW;
      const badgeY = curY + 8;
      const badge = new Graphics();
      badge.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
      badge.fill({ color: 0xd4a843, alpha: 0.3 });
      this.addChild(badge);

      const badgeTxt = new Text({
        text: 'ACTIVATE',
        style: new TextStyle({
          fontSize: 11,
          fill: 0xd4a843,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 1,
        }),
      });
      badgeTxt.anchor.set(0.5, 0.5);
      badgeTxt.x = badgeX + badgeW / 2;
      badgeTxt.y = badgeY + badgeH / 2;
      this.addChild(badgeTxt);

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
  }
}
