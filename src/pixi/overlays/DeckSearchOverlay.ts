// ============================================================
// Primal TCG — Deck Search Overlay
// ============================================================
// Shows valid deck cards for the player to pick from (e.g., Secret Meeting).

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CardSprite } from '../CardSprite';
import { COLORS, CARD_SIZES, BoardLayout, CardSize } from '../layout';
import { FONT } from '../SharedStyles';
import type { GameState, PlayerId, CardDef } from '@/game/types';
import { getCardDefForInstance, getEffectiveStats } from '@/game/engine';
import { fadeInOverlay } from './overlayTransitions';

export class DeckSearchOverlay extends Container {
  private _selectionMade = false;

  constructor(
    state: GameState,
    player: PlayerId,
    criteria: string,
    validCardIds: string[],
    layout: BoardLayout,
    onSelect: (cardId: string | null) => void,
    displayCardIds?: string[],
    sourceCardName?: string,
    onRightClick?: (defId: string, instance?: import('@/game/types').CardInstance, stats?: { lead: number; support: number }) => void,
  ) {
    super();

    const cardSize = CARD_SIZES.md;
    const allCardIds = displayCardIds ?? validCardIds;
    const hasDisplayMode = !!displayCardIds;

    // Backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, layout.width, layout.height);
    backdrop.fill({ color: 0x000000, alpha: 0.9 });
    backdrop.eventMode = 'static';
    this.addChild(backdrop);

    // Title
    const titleText = sourceCardName
      ? `${sourceCardName.toUpperCase()}'S EFFECT`
      : 'SEARCH YOUR DECK';
    const title = new Text({
      text: titleText,
      style: new TextStyle({
        fontSize: 24,
        fill: COLORS.textBright,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 4,
      }),
    });
    title.anchor.set(0.5, 0);
    title.x = layout.width / 2;
    title.y = 20;
    this.addChild(title);

    // Criteria description
    const critText = hasDisplayMode && validCardIds.length === 0
      ? 'No valid targets found'
      : `Select a ${criteria}`;
    const critTxt = new Text({
      text: critText,
      style: new TextStyle({
        fontSize: 14,
        fill: validCardIds.length === 0 ? COLORS.textMuted : COLORS.accentGold,
        fontFamily: FONT,
        fontWeight: 'bold',
      }),
    });
    critTxt.anchor.set(0.5, 0);
    critTxt.x = layout.width / 2;
    critTxt.y = 52;
    this.addChild(critTxt);

    // Card grid
    const startY = 85;
    const gap = 10;
    const cardsPerRow = Math.max(1, Math.floor((layout.width - 60) / (cardSize.width + gap)));
    const gridStartX = (layout.width - (Math.min(allCardIds.length, cardsPerRow) * (cardSize.width + gap) - gap)) / 2;

    for (let i = 0; i < allCardIds.length; i++) {
      const cid = allCardIds[i];
      const inst = state.cards[cid];
      if (!inst) continue;

      const isValid = validCardIds.includes(cid);

      let def: CardDef | undefined;
      let stats: { lead: number; support: number } | undefined;
      try {
        def = getCardDefForInstance(state, cid);
        if (def.cardType === 'character') stats = getEffectiveStats(state, cid);
      } catch { /* skip */ }

      const col = i % cardsPerRow;
      const row = Math.floor(i / cardsPerRow);
      const cx = gridStartX + col * (cardSize.width + gap);
      const cy = startY + row * (cardSize.height + gap + 16);

      // Valid highlight border
      if (isValid) {
        const highlight = new Graphics();
        highlight.roundRect(cx - 3, cy - 3, cardSize.width + 6, cardSize.height + 6, 6);
        highlight.stroke({ color: COLORS.accentGold, width: 2, alpha: 0.8 });
        this.addChild(highlight);
      }

      const card = new CardSprite({
        defId: inst.defId,
        size: cardSize,
        cardDef: def,
        instance: inst,
        effectiveStats: stats,
        interactive: true,
        highlighted: isValid,
      });
      card.x = cx;
      card.y = cy;
      if (!isValid && hasDisplayMode) card.alpha = 0.5;

      // Card name below
      if (def) {
        const nameTxt = new Text({
          text: def.name,
          style: new TextStyle({
            fontSize: 9,
            fill: isValid ? COLORS.textBright : COLORS.textMuted,
            fontFamily: FONT,
            fontWeight: 'bold',
          }),
        });
        nameTxt.anchor.set(0.5, 0);
        nameTxt.x = cx + cardSize.width / 2;
        nameTxt.y = cy + cardSize.height + 2;
        this.addChild(nameTxt);
      }

      card.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
        if (e.button === 2) {
          e.preventDefault?.();
          onRightClick?.(inst.defId, inst, stats);
          return;
        }
        if (!isValid) return;
        if (this._selectionMade) return;
        this._selectionMade = true;
        onSelect(cid);
      });

      this.addChild(card);
    }

    // Confirm/Cancel button
    const btnW = 120;
    const btnH = 36;
    const btnLabel = hasDisplayMode ? 'CONFIRM' : 'CANCEL';
    const cancelBtn = this.makeButton(btnLabel, btnW, btnH, 0x374151);
    cancelBtn.x = layout.width / 2 - btnW / 2;
    cancelBtn.y = layout.height - 60;
    cancelBtn.on('pointerdown', () => {
      if (this._selectionMade) return;
      this._selectionMade = true;
      onSelect(null);
    });
    this.addChild(cancelBtn);

    fadeInOverlay(this);
  }

  private makeButton(label: string, w: number, h: number, color: number): Container {
    const c = new Container();
    c.eventMode = 'static';
    c.cursor = 'pointer';
    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 6);
    bg.fill({ color, alpha: 0.9 });
    bg.stroke({ color: 0xffffff, width: 1, alpha: 0.1 });
    c.addChild(bg);
    const txt = new Text({
      text: label,
      style: new TextStyle({ fontSize: 13, fill: COLORS.textBright, fontFamily: FONT, fontWeight: 'bold' }),
    });
    txt.anchor.set(0.5, 0.5);
    txt.x = w / 2;
    txt.y = h / 2;
    c.addChild(txt);
    return c;
  }

  dispose(): void {
    // Cleanup if needed
  }
}
