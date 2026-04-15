// ============================================================
// Primal TCG — Mulligan Overlay
// ============================================================

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';
import { CardSprite } from '../CardSprite';
import { COLORS, CARD_SIZES, BoardLayout, CardSize } from '../layout';
import { FONT } from '../SharedStyles';
import { CardPreviewOverlay } from './CardPreviewOverlay';
import type { GameState, PlayerId, CardDef } from '@/game/types';
import type { UIState, UIAction } from '@/hooks/useGameEngine';
import { getCardDefForInstance, getEffectiveStats } from '@/game/engine';

export class MulliganOverlay extends Container {
  private selectedIds = new Set<string>();
  private previewOverlay: CardPreviewOverlay | null = null;

  constructor(
    state: GameState,
    ui: UIState,
    layout: BoardLayout,
    dispatch: (action: UIAction) => void,
  ) {
    super();

    const humanPlayer = ui.humanPlayer;
    const handIds = state.players[humanPlayer].hand;

    // Pick card size that fits — prefer larger cards
    const maxCardW = (layout.width - 80) / Math.max(handIds.length, 1) - 14;
    let cardSize: CardSize;
    if (maxCardW >= CARD_SIZES.xl.width) {
      cardSize = CARD_SIZES.xl;
    } else if (maxCardW >= CARD_SIZES.lg.width) {
      cardSize = CARD_SIZES.lg;
    } else {
      cardSize = CARD_SIZES.md;
    }

    // ---- Backdrop with radial vignette ----
    const backdrop = new Graphics();
    backdrop.rect(0, 0, layout.width, layout.height);
    backdrop.fill({ color: 0x050a14, alpha: 0.92 });
    backdrop.eventMode = 'static';
    this.addChild(backdrop);

    // Subtle radial glow in center
    const glow = new Graphics();
    glow.circle(layout.width / 2, layout.height * 0.45, Math.min(layout.width, layout.height) * 0.4);
    glow.fill({ color: COLORS.accentCyan, alpha: 0.03 });
    this.addChild(glow);

    // ---- Decorative top line ----
    const topLine = new Graphics();
    const lineW = layout.width * 0.35;
    topLine.moveTo(layout.width / 2 - lineW / 2, layout.height * 0.06);
    topLine.lineTo(layout.width / 2 + lineW / 2, layout.height * 0.06);
    topLine.stroke({ color: COLORS.accentCyan, width: 1, alpha: 0.3 });
    this.addChild(topLine);

    // ---- Title ----
    const title = new Text({
      text: 'OPENING HAND',
      style: new TextStyle({
        fontSize: 30,
        fill: COLORS.textBright,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 8,
      }),
    });
    title.anchor.set(0.5, 0);
    title.x = layout.width / 2;
    title.y = layout.height * 0.08;
    this.addChild(title);

    // Accent lines flanking title
    for (const dir of [-1, 1]) {
      const accent = new Graphics();
      const ax = layout.width / 2 + dir * (title.width / 2 + 16);
      accent.moveTo(ax, title.y + 16);
      accent.lineTo(ax + dir * 50, title.y + 16);
      accent.stroke({ color: COLORS.accentCyan, width: 2, alpha: 0.4 });
      this.addChild(accent);
    }

    // ---- Subtitle ----
    const sub = new Text({
      text: 'Tap cards to mark for replacement, then mulligan or keep',
      style: new TextStyle({
        fontSize: 13,
        fill: COLORS.textMuted,
        fontFamily: FONT,
        fontStyle: 'italic',
      }),
    });
    sub.anchor.set(0.5, 0);
    sub.x = layout.width / 2;
    sub.y = title.y + 44;
    this.addChild(sub);

    // ---- Cards ----
    const gap = 14;
    const totalW = handIds.length * cardSize.width + (handIds.length - 1) * gap;
    const startX = (layout.width - totalW) / 2;
    const cardY = layout.height * 0.26;

    const cardWrappers: { wrapper: Container; overlay: Container; card: CardSprite; id: string }[] = [];

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
      const targetX = startX + i * (cardSize.width + gap);
      wrapper.x = targetX;
      wrapper.y = cardY;

      const card = new CardSprite({
        defId: inst.defId,
        size: cardSize,
        cardDef: def,
        instance: inst,
        effectiveStats: stats,
      });
      wrapper.addChild(card);

      // Selection overlay — red-tinted with X mark
      const selOverlay = new Container();
      selOverlay.visible = false;

      const dimBg = new Graphics();
      dimBg.roundRect(0, 0, cardSize.width, cardSize.height, 4);
      dimBg.fill({ color: 0x7f1d1d, alpha: 0.45 });
      selOverlay.addChild(dimBg);

      // X mark
      const xSize = 20;
      const xGfx = new Graphics();
      const cx = cardSize.width / 2;
      const cy = cardSize.height / 2;
      xGfx.moveTo(cx - xSize / 2, cy - xSize / 2);
      xGfx.lineTo(cx + xSize / 2, cy + xSize / 2);
      xGfx.moveTo(cx + xSize / 2, cy - xSize / 2);
      xGfx.lineTo(cx - xSize / 2, cy + xSize / 2);
      xGfx.stroke({ color: 0xfca5a5, width: 3, alpha: 0.9 });
      selOverlay.addChild(xGfx);

      // "RETURN" label below X
      const returnTxt = new Text({
        text: 'RETURN',
        style: new TextStyle({
          fontSize: 11,
          fill: 0xfca5a5,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 2,
        }),
      });
      returnTxt.anchor.set(0.5, 0);
      returnTxt.x = cardSize.width / 2;
      returnTxt.y = cy + xSize / 2 + 6;
      selOverlay.addChild(returnTxt);

      // Selection border glow
      const selBorder = new Graphics();
      selBorder.roundRect(-2, -2, cardSize.width + 4, cardSize.height + 4, 6);
      selBorder.stroke({ color: 0xef4444, width: 2, alpha: 0.8 });
      selOverlay.addChild(selBorder);

      wrapper.addChild(selOverlay);

      cardWrappers.push({ wrapper, overlay: selOverlay, card, id: instanceId });

      // Click handler
      wrapper.eventMode = 'static';
      wrapper.cursor = 'pointer';
      wrapper.on('pointerdown', (e: { button?: number }) => {
        if (e.button === 2) return;
        if (this.selectedIds.has(instanceId)) {
          this.selectedIds.delete(instanceId);
          selOverlay.visible = false;
          gsap.to(wrapper, { y: cardY, duration: 0.15, ease: 'back.out(2)' });
        } else {
          this.selectedIds.add(instanceId);
          selOverlay.visible = true;
          gsap.to(wrapper, { y: cardY + 12, duration: 0.15, ease: 'power2.out' });
        }
        updateCounter();
      });

      // Right-click preview
      wrapper.on('rightdown', () => {
        if (this.previewOverlay || !def) return;
        this.previewOverlay = new CardPreviewOverlay(
          def,
          inst,
          stats,
          layout,
          () => {
            if (this.previewOverlay) {
              this.removeChild(this.previewOverlay);
              this.previewOverlay.destroy({ children: true });
              this.previewOverlay = null;
            }
          },
        );
        this.addChild(this.previewOverlay);
      });

      this.addChild(wrapper);

      // Staggered fan-in animation
      wrapper.alpha = 0;
      wrapper.y = cardY + 60;
      gsap.to(wrapper, {
        alpha: 1,
        y: cardY,
        duration: 0.35,
        delay: 0.1 + i * 0.08,
        ease: 'back.out(1.5)',
      });
    });

    // ---- Selection counter pill ----
    const counterY = cardY + cardSize.height + 24;

    const counterPill = new Graphics();
    const updateCounterPill = (count: number) => {
      counterPill.clear();
      const pillW = 140;
      const pillH = 26;
      counterPill.roundRect(layout.width / 2 - pillW / 2, counterY, pillW, pillH, pillH / 2);
      counterPill.fill({ color: count > 0 ? 0x7f1d1d : 0x111827, alpha: 0.6 });
      counterPill.stroke({ color: count > 0 ? 0xef4444 : 0x374151, width: 1, alpha: 0.4 });
    };
    updateCounterPill(0);
    this.addChild(counterPill);

    const countTxt = new Text({
      text: 'None selected',
      style: new TextStyle({
        fontSize: 11,
        fill: COLORS.textMuted,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 1,
      }),
    });
    countTxt.anchor.set(0.5, 0.5);
    countTxt.x = layout.width / 2;
    countTxt.y = counterY + 13;
    this.addChild(countTxt);

    const updateCounter = () => {
      const count = this.selectedIds.size;
      countTxt.text = count === 0 ? 'None selected' : `${count} card${count > 1 ? 's' : ''} to return`;
      countTxt.style.fill = count > 0 ? 0xfca5a5 : COLORS.textMuted;
      updateCounterPill(count);
      mulliganBtn.alpha = count > 0 ? 1 : 0.35;
    };

    // ---- Buttons ----
    const btnY = counterY + 44;
    const btnW = 170;
    const btnH = 46;
    const btnGap = 20;

    // Keep Hand
    const keepBtn = this.makeButton('KEEP HAND', btnW, btnH, COLORS.buttonPrimary, COLORS.buttonPrimary);
    keepBtn.x = layout.width / 2 - btnW - btnGap / 2;
    keepBtn.y = btnY;
    keepBtn.on('pointerdown', () => {
      dispatch({ type: 'SUBMIT_MULLIGAN', player: humanPlayer, cardIds: [] });
    });
    this.addChild(keepBtn);

    // Mulligan
    const mulliganBtn = this.makeButton('MULLIGAN', btnW, btnH, 0xdc2626, 0xef4444);
    mulliganBtn.x = layout.width / 2 + btnGap / 2;
    mulliganBtn.y = btnY;
    mulliganBtn.alpha = 0.35;
    mulliganBtn.on('pointerdown', () => {
      if (this.selectedIds.size === 0) return;
      dispatch({ type: 'SUBMIT_MULLIGAN', player: humanPlayer, cardIds: Array.from(this.selectedIds) });
    });
    this.addChild(mulliganBtn);

    // Button fade-in
    keepBtn.alpha = 0;
    mulliganBtn.alpha = 0;
    gsap.to(keepBtn, { alpha: 1, duration: 0.3, delay: 0.5 });
    gsap.to(mulliganBtn, { alpha: 0.35, duration: 0.3, delay: 0.55 });

    // ---- Bottom decorative line ----
    const botLine = new Graphics();
    botLine.moveTo(layout.width / 2 - lineW / 2, btnY + btnH + 24);
    botLine.lineTo(layout.width / 2 + lineW / 2, btnY + btnH + 24);
    botLine.stroke({ color: COLORS.accentCyan, width: 1, alpha: 0.15 });
    this.addChild(botLine);

    // ---- Floating particles (ambient) ----
    for (let p = 0; p < 12; p++) {
      const particle = new Graphics();
      const px = Math.random() * layout.width;
      const py = Math.random() * layout.height;
      const pr = 1 + Math.random() * 1.5;
      particle.circle(0, 0, pr);
      particle.fill({ color: COLORS.accentCyan, alpha: 0.15 + Math.random() * 0.15 });
      particle.x = px;
      particle.y = py;
      this.addChild(particle);

      gsap.to(particle, {
        y: py - 30 - Math.random() * 40,
        alpha: 0,
        duration: 3 + Math.random() * 4,
        repeat: -1,
        ease: 'none',
        onRepeat: () => {
          particle.x = Math.random() * layout.width;
          particle.y = layout.height + 10;
          particle.alpha = 0.15 + Math.random() * 0.15;
        },
      });
    }
  }

  private makeButton(label: string, w: number, h: number, bgColor: number, accentColor: number): Container {
    const c = new Container();
    c.eventMode = 'static';
    c.cursor = 'pointer';

    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 8);
    bg.fill({ color: bgColor, alpha: 0.85 });
    bg.stroke({ color: accentColor, width: 1, alpha: 0.3 });
    c.addChild(bg);

    // Subtle top highlight
    const highlight = new Graphics();
    highlight.roundRect(1, 1, w - 2, h / 2, 8);
    highlight.fill({ color: 0xffffff, alpha: 0.06 });
    c.addChild(highlight);

    const txt = new Text({
      text: label,
      style: new TextStyle({
        fontSize: 14,
        fill: COLORS.textBright,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 2,
      }),
    });
    txt.anchor.set(0.5, 0.5);
    txt.x = w / 2;
    txt.y = h / 2;
    c.addChild(txt);

    return c;
  }
}
