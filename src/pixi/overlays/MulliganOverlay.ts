// ============================================================
// Primal TCG — Mulligan Overlay
// ============================================================

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CardSprite } from '../CardSprite';
import { COLORS, CARD_SIZES, BoardLayout } from '../layout';
import type { GameState, PlayerId, CardDef } from '@/game/types';
import type { UIState, UIAction } from '@/hooks/useGameEngine';
import { getCardDefForInstance, getEffectiveStats } from '@/game/engine';

export class MulliganOverlay extends Container {
  private selectedIds = new Set<string>();

  constructor(
    state: GameState,
    ui: UIState,
    layout: BoardLayout,
    dispatch: (action: UIAction) => void,
  ) {
    super();

    const humanPlayer = ui.humanPlayer;
    const handIds = state.players[humanPlayer].hand;
    const cardSize = CARD_SIZES.lg;

    // Full-screen backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, layout.width, layout.height);
    backdrop.fill({ color: 0x000000, alpha: 0.85 });
    backdrop.eventMode = 'static';
    this.addChild(backdrop);

    // Title
    const title = new Text({
      text: 'MULLIGAN',
      style: new TextStyle({
        fontSize: 28,
        fill: COLORS.textBright,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        letterSpacing: 6,
      }),
    });
    title.anchor.set(0.5, 0);
    title.x = layout.width / 2;
    title.y = layout.height * 0.08;
    this.addChild(title);

    // Subtitle
    const sub = new Text({
      text: 'Select cards to return to your deck, then draw replacements',
      style: new TextStyle({
        fontSize: 13,
        fill: COLORS.textMuted,
        fontFamily: 'Arial, sans-serif',
      }),
    });
    sub.anchor.set(0.5, 0);
    sub.x = layout.width / 2;
    sub.y = title.y + 40;
    this.addChild(sub);

    // Cards
    const gap = 12;
    const totalW = handIds.length * cardSize.width + (handIds.length - 1) * gap;
    const startX = (layout.width - totalW) / 2;
    const cardY = layout.height * 0.28;

    // Track card containers for toggle visual
    const cardContainers: { container: Container; id: string; checkmark: Container }[] = [];

    handIds.forEach((instanceId, i) => {
      const inst = state.cards[instanceId];
      if (!inst) return;

      let def: CardDef | undefined;
      let stats: { lead: number; support: number } | undefined;
      try {
        def = getCardDefForInstance(state, instanceId);
        if (def.cardType === 'character') stats = getEffectiveStats(state, instanceId);
      } catch { /* skip */ }

      const wrapper = new Container();
      wrapper.x = startX + i * (cardSize.width + gap);
      wrapper.y = cardY;

      const card = new CardSprite({
        defId: inst.defId,
        size: cardSize,
        cardDef: def,
        instance: inst,
        effectiveStats: stats,
        interactive: true,
      });
      wrapper.addChild(card);

      // Checkmark overlay (hidden initially)
      const checkOverlay = new Container();
      checkOverlay.visible = false;

      const dimBg = new Graphics();
      dimBg.roundRect(0, 0, cardSize.width, cardSize.height, 4);
      dimBg.fill({ color: 0x000000, alpha: 0.5 });
      checkOverlay.addChild(dimBg);

      const checkTxt = new Text({
        text: 'RETURN',
        style: new TextStyle({
          fontSize: 14,
          fill: COLORS.accentCyan,
          fontFamily: 'Arial, sans-serif',
          fontWeight: 'bold',
        }),
      });
      checkTxt.anchor.set(0.5, 0.5);
      checkTxt.x = cardSize.width / 2;
      checkTxt.y = cardSize.height / 2;
      checkOverlay.addChild(checkTxt);
      wrapper.addChild(checkOverlay);

      cardContainers.push({ container: wrapper, id: instanceId, checkmark: checkOverlay });

      // Click handler
      wrapper.eventMode = 'static';
      wrapper.cursor = 'pointer';
      wrapper.on('pointerdown', () => {
        if (this.selectedIds.has(instanceId)) {
          this.selectedIds.delete(instanceId);
          checkOverlay.visible = false;
          card.alpha = 1;
        } else {
          this.selectedIds.add(instanceId);
          checkOverlay.visible = true;
          card.alpha = 0.7;
        }
        // Update counter
        countTxt.text = `${this.selectedIds.size} selected`;
        mulliganBtn.alpha = this.selectedIds.size > 0 ? 1 : 0.4;
      });

      this.addChild(wrapper);
    });

    // Selection counter
    const countTxt = new Text({
      text: '0 selected',
      style: new TextStyle({
        fontSize: 12,
        fill: COLORS.textMuted,
        fontFamily: 'Arial, sans-serif',
      }),
    });
    countTxt.anchor.set(0.5, 0);
    countTxt.x = layout.width / 2;
    countTxt.y = cardY + cardSize.height + 20;
    this.addChild(countTxt);

    // Buttons
    const btnY = cardY + cardSize.height + 50;
    const btnW = 160;
    const btnH = 42;
    const btnGap = 24;

    // Keep Hand button
    const keepBtn = this.makeButton('KEEP HAND', btnW, btnH, COLORS.buttonPrimary);
    keepBtn.x = layout.width / 2 - btnW - btnGap / 2;
    keepBtn.y = btnY;
    keepBtn.on('pointerdown', () => {
      dispatch({ type: 'SUBMIT_MULLIGAN', player: humanPlayer, cardIds: [] });
    });
    this.addChild(keepBtn);

    // Mulligan button
    const mulliganBtn = this.makeButton('MULLIGAN', btnW, btnH, COLORS.accentBlue);
    mulliganBtn.x = layout.width / 2 + btnGap / 2;
    mulliganBtn.y = btnY;
    mulliganBtn.alpha = 0.4;
    mulliganBtn.on('pointerdown', () => {
      if (this.selectedIds.size === 0) return;
      dispatch({ type: 'SUBMIT_MULLIGAN', player: humanPlayer, cardIds: Array.from(this.selectedIds) });
    });
    this.addChild(mulliganBtn);
  }

  private makeButton(label: string, w: number, h: number, color: number): Container {
    const c = new Container();
    c.eventMode = 'static';
    c.cursor = 'pointer';

    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 6);
    bg.fill({ color, alpha: 0.9 });
    bg.stroke({ color: 0xffffff, width: 1, alpha: 0.15 });
    c.addChild(bg);

    const txt = new Text({
      text: label,
      style: new TextStyle({
        fontSize: 14,
        fill: COLORS.textBright,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        letterSpacing: 1,
      }),
    });
    txt.anchor.set(0.5, 0.5);
    txt.x = w / 2;
    txt.y = h / 2;
    c.addChild(txt);

    return c;
  }
}
