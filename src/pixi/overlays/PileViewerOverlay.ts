// ============================================================
// Primal TCG — Pile Viewer Overlay
// ============================================================
// Shows all cards in a pile (discard, essence, etc.) in a
// scrollable grid. Right-click individual cards for detail view.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';
import { CardSprite } from '../CardSprite';
import { CardPreviewOverlay } from './CardPreviewOverlay';
import { COLORS, CARD_SIZES, BoardLayout } from '../layout';
import { FONT } from '../SharedStyles';
import type { GameState, CardDef } from '@/game/types';
import { getCardDefForInstance, getEffectiveStats } from '@/game/engine';

export class PileViewerOverlay extends Container {
  private previewOverlay: CardPreviewOverlay | null = null;

  constructor(
    title: string,
    cardIds: string[],
    state: GameState,
    layout: BoardLayout,
    onClose: () => void,
  ) {
    super();

    // Backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, layout.width, layout.height);
    backdrop.fill({ color: 0x000000, alpha: 0.88 });
    backdrop.eventMode = 'static';
    backdrop.on('pointerdown', () => {
      if (this.previewOverlay) return; // don't close if previewing
      onClose();
    });
    this.addChild(backdrop);

    // Content
    const content = new Container();

    // Header
    const headerTxt = new Text({
      text: `${title} (${cardIds.length})`,
      style: new TextStyle({
        fontSize: 20,
        fill: COLORS.textBright,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 4,
      }),
    });
    headerTxt.anchor.set(0.5, 0);
    headerTxt.x = layout.width / 2;
    headerTxt.y = 30;
    content.addChild(headerTxt);

    // Close hint
    const closeTxt = new Text({
      text: 'Click backdrop to close  ·  Right-click a card for details',
      style: new TextStyle({ fontSize: 11, fill: COLORS.textMuted, fontFamily: FONT }),
    });
    closeTxt.anchor.set(0.5, 0);
    closeTxt.x = layout.width / 2;
    closeTxt.y = 58;
    content.addChild(closeTxt);

    if (cardIds.length === 0) {
      const emptyTxt = new Text({
        text: 'No cards',
        style: new TextStyle({ fontSize: 14, fill: COLORS.textMuted, fontFamily: FONT, fontStyle: 'italic' }),
      });
      emptyTxt.anchor.set(0.5, 0.5);
      emptyTxt.x = layout.width / 2;
      emptyTxt.y = layout.height / 2;
      content.addChild(emptyTxt);
    } else {
      // Card grid — use lg size for better readability
      const cardSize = CARD_SIZES.lg;
      const gap = 10;
      const maxCols = Math.floor((layout.width - 60) / (cardSize.width + gap));
      const cols = Math.min(maxCols, cardIds.length);
      const rows = Math.ceil(cardIds.length / cols);

      const gridW = cols * cardSize.width + (cols - 1) * gap;
      const gridStartX = (layout.width - gridW) / 2;
      const gridStartY = 85;

      for (let idx = 0; idx < cardIds.length; idx++) {
        const instanceId = cardIds[idx];
        const inst = state.cards[instanceId];
        if (!inst) continue;

        let def: CardDef | undefined;
        let stats: { lead: number; support: number } | undefined;
        try {
          def = getCardDefForInstance(state, instanceId);
          if (def.cardType === 'character') stats = getEffectiveStats(state, instanceId);
        } catch { /* skip */ }

        const col = idx % cols;
        const row = Math.floor(idx / cols);

        const card = new CardSprite({
          defId: inst.defId,
          size: cardSize,
          cardDef: def,
          instance: inst,
          effectiveStats: stats,
          showName: true,
        });
        card.x = gridStartX + col * (cardSize.width + gap);
        card.y = gridStartY + row * (cardSize.height + gap + 4);

        // Right-click for detail preview
        if (def) {
          card.eventMode = 'static';
          card.cursor = 'pointer';
          card.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
            if (e.button === 2) {
              e.preventDefault?.();
              this.showPreview(def!, inst, stats, layout);
            }
          });
        }

        content.addChild(card);
      }
    }

    this.addChild(content);

    // Animate in
    content.alpha = 0;
    content.scale.set(0.92);
    gsap.to(content, { alpha: 1, duration: 0.2, ease: 'power2.out' });
    gsap.to(content.scale, { x: 1, y: 1, duration: 0.25, ease: 'back.out(1.3)' });
  }

  private showPreview(
    def: CardDef,
    instance: import('@/game/types').CardInstance,
    stats: { lead: number; support: number } | undefined,
    layout: BoardLayout,
  ): void {
    if (this.previewOverlay) {
      this.removeChild(this.previewOverlay);
      this.previewOverlay.dispose();
      this.previewOverlay.destroy({ children: true });
      this.previewOverlay = null;
      return;
    }
    this.previewOverlay = new CardPreviewOverlay(def, instance, stats, layout, () => {
      if (this.previewOverlay) {
        this.previewOverlay.dispose();
        this.removeChild(this.previewOverlay);
        this.previewOverlay.destroy({ children: true });
        this.previewOverlay = null;
      }
    });
    this.addChild(this.previewOverlay);
  }

  dispose(): void {
    if (this.previewOverlay) {
      this.previewOverlay.dispose();
    }
  }
}
