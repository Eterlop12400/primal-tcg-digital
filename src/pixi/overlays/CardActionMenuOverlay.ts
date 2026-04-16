// ============================================================
// Primal TCG — Card Action Menu Overlay
// ============================================================
// A contextual popup near the clicked card showing available actions
// (e.g., "Summon" vs "Activate Effect"). Positioned near the card,
// not centered like other overlays.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { COLORS, BoardLayout } from '../layout';
import { FONT } from '../SharedStyles';
import type { UIAction } from '@/hooks/useGameEngine';

export interface CardAction {
  label: string;
  description: string;
  action: 'summon' | 'activate' | 'play-strategy' | 'charge';
  effectId?: string;
}

export class CardActionMenuOverlay extends Container {
  constructor(
    layout: BoardLayout,
    cardX: number,
    cardY: number,
    cardW: number,
    cardH: number,
    actions: CardAction[],
    onSelect: (action: CardAction) => void,
    onCancel: () => void,
  ) {
    super();

    const W = layout.width;
    const H = layout.height;

    // Backdrop — click to cancel
    const backdrop = new Graphics();
    backdrop.rect(0, 0, W, H);
    backdrop.fill({ color: 0x000000, alpha: 0.4 });
    backdrop.eventMode = 'static';
    backdrop.cursor = 'default';
    backdrop.on('pointerdown', () => onCancel());
    this.addChild(backdrop);

    // Panel dimensions
    const panelW = 200;
    const rowH = 40;
    const padding = 8;
    const panelH = actions.length * (rowH + 4) + padding * 2;

    // Position panel near the card — to the right if there's space, otherwise left
    let panelX = cardX + cardW + 8;
    if (panelX + panelW > W - 10) {
      panelX = cardX - panelW - 8;
    }
    if (panelX < 10) {
      panelX = 10;
    }

    // Vertical — center on the card
    let panelY = cardY + (cardH - panelH) / 2;
    if (panelY < 10) panelY = 10;
    if (panelY + panelH > H - 10) panelY = H - panelH - 10;

    // Panel background
    const panel = new Graphics();
    panel.roundRect(panelX, panelY, panelW, panelH, 10);
    panel.fill({ color: 0x0f1729, alpha: 0.95 });
    panel.stroke({ color: COLORS.accentCyan, width: 2, alpha: 0.8 });
    panel.eventMode = 'static'; // prevent clicks from going through to backdrop
    this.addChild(panel);

    // Action rows
    let curY = panelY + padding;
    for (const act of actions) {
      const rowBg = new Graphics();
      rowBg.roundRect(panelX + 6, curY, panelW - 12, rowH, 6);
      rowBg.fill({ color: 0x1a2744, alpha: 0.9 });
      rowBg.stroke({ color: COLORS.accentCyan, width: 1, alpha: 0.5 });
      rowBg.eventMode = 'static';
      rowBg.cursor = 'pointer';

      rowBg.on('pointerover', () => {
        rowBg.tint = 0xbbddff;
      });
      rowBg.on('pointerout', () => {
        rowBg.tint = 0xffffff;
      });

      const selectedAction = act;
      rowBg.on('pointerdown', (e) => {
        e.stopPropagation();
        onSelect(selectedAction);
      });

      this.addChild(rowBg);

      // Label
      const label = new Text({
        text: act.label,
        style: new TextStyle({
          fontSize: 14,
          fill: 0xe2e8f0,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 1,
        }),
      });
      label.anchor.set(0, 0.5);
      label.x = panelX + 16;
      label.y = curY + rowH / 2;
      this.addChild(label);

      // Description (small text on right)
      if (act.description) {
        const desc = new Text({
          text: act.description,
          style: new TextStyle({
            fontSize: 10,
            fill: COLORS.textMuted,
            fontFamily: FONT,
          }),
        });
        desc.anchor.set(1, 0.5);
        desc.x = panelX + panelW - 16;
        desc.y = curY + rowH / 2;
        this.addChild(desc);
      }

      curY += rowH + 4;
    }
  }
}
