// ============================================================
// Primal TCG — Character Activate Effect Confirmation Overlay
// ============================================================
// Shows the character's activate effect description with cost info
// and scope badge before the player commits. ACTIVATE confirms and
// enters cost-selection flow; CANCEL returns to normal mode.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { COLORS, BoardLayout } from '../layout';
import { FONT } from '../SharedStyles';
import type { UIAction } from '@/hooks/useGameEngine';
import { fadeInOverlay } from './overlayTransitions';

interface ActivateEffectInfo {
  effectId: string;
  effectDescription: string;
  costDescription?: string;
  scope?: 'instance' | 'name-turn' | 'name-game';
}

export class CharacterActivateOverlay extends Container {
  constructor(
    layout: BoardLayout,
    characterName: string,
    cardId: string,
    effects: ActivateEffectInfo[],
    dispatch: (action: UIAction) => void,
    humanPlayer: string,
    onActivate: (effectId: string) => void,
  ) {
    super();

    const W = layout.width;
    const H = layout.height;

    // Backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, W, H);
    backdrop.fill({ color: 0x000000, alpha: 0.7 });
    backdrop.eventMode = 'static';
    backdrop.cursor = 'default';
    backdrop.on('pointerdown', () => {
      dispatch({ type: 'CLEAR_SELECTION' });
    });
    this.addChild(backdrop);

    // Panel dimensions
    const panelW = Math.min(460, W - 40);
    const rowH = 70;
    const panelH = 60 + effects.length * (rowH + 8) + 50;
    const panelX = (W - panelW) / 2;
    const panelY = (H - panelH) / 2;

    // Panel background
    const panel = new Graphics();
    panel.roundRect(panelX, panelY, panelW, panelH, 12);
    panel.fill({ color: 0x0f1729, alpha: 0.95 });
    panel.stroke({ color: 0xd4a843, width: 2, alpha: 0.8 });
    panel.eventMode = 'static'; // prevent backdrop click-through
    this.addChild(panel);

    // Title — character name
    const title = new Text({
      text: characterName.toUpperCase(),
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

    // Subtitle
    const subtitle = new Text({
      text: 'ACTIVATE EFFECT',
      style: new TextStyle({
        fontSize: 12,
        fill: COLORS.textMuted,
        fontFamily: FONT,
        letterSpacing: 2,
      }),
    });
    subtitle.anchor.set(0.5, 0);
    subtitle.x = W / 2;
    subtitle.y = panelY + 40;
    this.addChild(subtitle);

    // Effect rows
    let curY = panelY + 60;
    for (const eff of effects) {
      const rowBg = new Graphics();
      rowBg.roundRect(panelX + 12, curY, panelW - 24, rowH, 8);
      rowBg.fill({ color: 0x1a2744, alpha: 0.9 });
      rowBg.stroke({ color: COLORS.accentCyan, width: 1.5, alpha: 0.7 });
      rowBg.eventMode = 'static';
      rowBg.cursor = 'pointer';

      // Hover effect
      rowBg.on('pointerover', () => { rowBg.tint = 0xbbddff; });
      rowBg.on('pointerout', () => { rowBg.tint = 0xffffff; });

      // Click — activate this effect
      const effectId = eff.effectId;
      rowBg.on('pointerdown', () => {
        onActivate(effectId);
      });

      this.addChild(rowBg);

      // Scope badge (if not default instance)
      const scopeColors: Record<string, { bg: number; text: string }> = {
        'instance': { bg: 0x22c55e, text: 'PER CARD' },
        'name-turn': { bg: 0xeab308, text: 'ONCE/TURN' },
        'name-game': { bg: 0xec4899, text: 'ONCE/GAME' },
      };
      const scope = eff.scope ?? 'instance';
      if (scope !== 'instance') {
        const scopeInfo = scopeColors[scope];
        const scopeBadgeW = 72;
        const scopeBadgeH = 18;
        const scopeX = panelX + panelW - 12 - scopeBadgeW - 8;
        const scopeY = curY + 4;
        const scopeBadge = new Graphics();
        scopeBadge.roundRect(scopeX, scopeY, scopeBadgeW, scopeBadgeH, 3);
        scopeBadge.fill({ color: scopeInfo.bg, alpha: 0.25 });
        this.addChild(scopeBadge);

        const scopeTxt = new Text({
          text: scopeInfo.text,
          style: new TextStyle({ fontSize: 9, fill: scopeInfo.bg, fontFamily: FONT, fontWeight: 'bold' }),
        });
        scopeTxt.anchor.set(0.5, 0.5);
        scopeTxt.x = scopeX + scopeBadgeW / 2;
        scopeTxt.y = scopeY + scopeBadgeH / 2;
        this.addChild(scopeTxt);
      }

      // Effect description
      const descTxt = new Text({
        text: eff.effectDescription,
        style: new TextStyle({
          fontSize: 13,
          fill: 0xe2e8f0,
          fontFamily: FONT,
          wordWrap: true,
          wordWrapWidth: panelW - 48,
          lineHeight: 18,
        }),
      });
      descTxt.x = panelX + 24;
      descTxt.y = curY + 8;
      this.addChild(descTxt);

      // Cost description (if any)
      if (eff.costDescription) {
        const costTxt = new Text({
          text: `Cost: ${eff.costDescription}`,
          style: new TextStyle({
            fontSize: 11,
            fill: 0xfbbf24,
            fontFamily: FONT,
            fontStyle: 'italic',
          }),
        });
        costTxt.x = panelX + 24;
        costTxt.y = curY + rowH - 22;
        this.addChild(costTxt);
      }

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
