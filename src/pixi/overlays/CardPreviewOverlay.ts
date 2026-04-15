// ============================================================
// Primal TCG — Card Preview Overlay (Full card detail view)
// ============================================================
// Shown on right-click / long-press on any card.
// Displays full card art + info panel with stats and effect text.

import { Container, Graphics, Text, TextStyle, Sprite } from 'pixi.js';
import gsap from 'gsap';
import { getCardTexture } from '../AssetLoader';
import { COLORS, CARD_SIZES, BoardLayout } from '../layout';
import { STYLES, FONT } from '../SharedStyles';
import type { CardDef, CharacterCardDef, StrategyCardDef, AbilityCardDef, CardInstance } from '@/game/types';

export class CardPreviewOverlay extends Container {
  private timeline: gsap.core.Timeline;

  constructor(
    cardDef: CardDef,
    instance: CardInstance | undefined,
    effectiveStats: { lead: number; support: number } | undefined,
    layout: BoardLayout,
    onClose: () => void,
  ) {
    super();

    // Scale card to fill ~60% of screen height
    const targetH = Math.min(520, layout.height * 0.65);
    const targetW = Math.round(targetH * (5 / 7));
    const previewSize = { width: targetW, height: targetH };

    // Backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, layout.width, layout.height);
    backdrop.fill({ color: 0x000000, alpha: 0.85 });
    backdrop.eventMode = 'static';
    backdrop.on('pointerdown', onClose);
    this.addChild(backdrop);

    // Content container (centered)
    const content = new Container();
    content.x = layout.width / 2;
    content.y = layout.height / 2;

    // Card image (left side)
    const cardContainer = new Container();
    const cardBg = new Graphics();
    cardBg.roundRect(0, 0, previewSize.width, previewSize.height, 8);
    cardBg.fill({ color: COLORS.cardBack });
    cardContainer.addChild(cardBg);

    const texture = getCardTexture(cardDef.id);
    const img = new Sprite(texture);
    img.x = 3;
    img.y = 3;
    img.width = previewSize.width - 6;
    img.height = previewSize.height - 6;
    cardContainer.addChild(img);

    // Card border glow
    const cardBorder = new Graphics();
    cardBorder.roundRect(-2, -2, previewSize.width + 4, previewSize.height + 4, 10);
    cardBorder.stroke({ color: COLORS.accentGold, width: 2, alpha: 0.6 });
    cardContainer.addChild(cardBorder);

    cardContainer.x = -previewSize.width - 20;
    cardContainer.y = -previewSize.height / 2;
    content.addChild(cardContainer);

    // Info panel (right side)
    const panelW = Math.min(300, layout.width * 0.3);
    const panelX = 24;
    const panelContainer = new Container();
    panelContainer.x = panelX;

    let py = -previewSize.height / 2;

    // Card name
    const nameTxt = new Text({
      text: cardDef.name,
      style: new TextStyle({
        fontSize: 22,
        fill: COLORS.textBright,
        fontFamily: FONT,
        fontWeight: 'bold',
        wordWrap: true,
        wordWrapWidth: panelW,
      }),
    });
    nameTxt.y = py;
    panelContainer.addChild(nameTxt);
    py += nameTxt.height + 10;

    // Card type + symbols
    const symbolStr = cardDef.symbols.map(s => s.toUpperCase()).join(' / ');
    const typeTxt = new Text({
      text: `${cardDef.cardType.toUpperCase()} — ${symbolStr}`,
      style: new TextStyle({
        fontSize: 12,
        fill: COLORS.accentCyan,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 1,
      }),
    });
    typeTxt.y = py;
    panelContainer.addChild(typeTxt);
    py += 22;

    // Divider
    const divider = new Graphics();
    divider.moveTo(0, py);
    divider.lineTo(panelW, py);
    divider.stroke({ color: COLORS.panelBorder, width: 1, alpha: 0.5 });
    panelContainer.addChild(divider);
    py += 12;

    // Type-specific info
    if (cardDef.cardType === 'character') {
      const charDef = cardDef as CharacterCardDef;

      // Stats
      if (effectiveStats) {
        const statsTxt = new Text({
          text: `LEAD ${effectiveStats.lead} / SUPPORT ${effectiveStats.support}`,
          style: new TextStyle({
            fontSize: 16,
            fill: COLORS.textGold,
            fontFamily: FONT,
            fontWeight: 'bold',
          }),
        });
        statsTxt.y = py;
        panelContainer.addChild(statsTxt);
        py += 24;
      }

      // Base stats
      const baseTxt = new Text({
        text: `Healthy: ${charDef.healthyStats.lead}/${charDef.healthyStats.support}  ·  Injured: ${charDef.injuredStats.lead}/${charDef.injuredStats.support}`,
        style: new TextStyle({
          fontSize: 12,
          fill: COLORS.textMuted,
          fontFamily: FONT,
        }),
      });
      baseTxt.y = py;
      panelContainer.addChild(baseTxt);
      py += 20;

      // Cost info
      const costTxt = new Text({
        text: `Turn Cost: ${charDef.turnCost}  ·  Hand Cost: ${charDef.handCost}`,
        style: new TextStyle({ fontSize: 12, fill: COLORS.textMuted, fontFamily: FONT }),
      });
      costTxt.y = py;
      panelContainer.addChild(costTxt);
      py += 20;

      // Attributes
      if (charDef.attributes.length > 0) {
        const attrTxt = new Text({
          text: charDef.attributes.join(', '),
          style: new TextStyle({ fontSize: 12, fill: COLORS.text, fontFamily: FONT, fontStyle: 'italic' }),
        });
        attrTxt.y = py;
        panelContainer.addChild(attrTxt);
        py += 20;
      }

      // State
      if (instance?.state) {
        const stateColor = instance.state === 'healthy' ? COLORS.healthyDot : COLORS.injuredDot;
        const stateTxt = new Text({
          text: instance.state.toUpperCase(),
          style: new TextStyle({ fontSize: 13, fill: stateColor, fontFamily: FONT, fontWeight: 'bold' }),
        });
        stateTxt.y = py;
        panelContainer.addChild(stateTxt);
        py += 20;
      }

      py += 6;

      // Effects
      for (const effect of charDef.effects) {
        const divider2 = new Graphics();
        divider2.moveTo(0, py);
        divider2.lineTo(panelW, py);
        divider2.stroke({ color: COLORS.panelBorder, width: 1, alpha: 0.3 });
        panelContainer.addChild(divider2);
        py += 10;

        const effectTypeTxt = new Text({
          text: `[${effect.type.toUpperCase()}]${effect.oncePerTurn ? ' (1/Turn)' : ''}`,
          style: new TextStyle({ fontSize: 11, fill: COLORS.accentGold, fontFamily: FONT, fontWeight: 'bold' }),
        });
        effectTypeTxt.y = py;
        panelContainer.addChild(effectTypeTxt);
        py += 18;

        const descTxt = new Text({
          text: effect.effectDescription,
          style: new TextStyle({
            fontSize: 13,
            fill: COLORS.text,
            fontFamily: FONT,
            wordWrap: true,
            wordWrapWidth: panelW,
            lineHeight: 18,
          }),
        });
        descTxt.y = py;
        panelContainer.addChild(descTxt);
        py += descTxt.height + 10;
      }
    } else if (cardDef.cardType === 'strategy') {
      const stratDef = cardDef as StrategyCardDef;

      const kwTxt = new Text({
        text: stratDef.keywords.map(k => k.toUpperCase()).join(' · ') || 'STRATEGY',
        style: new TextStyle({ fontSize: 11, fill: COLORS.accentGold, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
      });
      kwTxt.y = py;
      panelContainer.addChild(kwTxt);
      py += 20;

      const costTxt = new Text({
        text: `Turn Cost: ${stratDef.turnCost}  ·  Hand Cost: ${stratDef.handCost}`,
        style: new TextStyle({ fontSize: 12, fill: COLORS.textMuted, fontFamily: FONT }),
      });
      costTxt.y = py;
      panelContainer.addChild(costTxt);
      py += 20;

      for (const effect of stratDef.effects) {
        const descTxt = new Text({
          text: effect.effectDescription,
          style: new TextStyle({
            fontSize: 13,
            fill: COLORS.text,
            fontFamily: FONT,
            wordWrap: true,
            wordWrapWidth: panelW,
            lineHeight: 18,
          }),
        });
        descTxt.y = py;
        panelContainer.addChild(descTxt);
        py += descTxt.height + 10;
      }
    } else if (cardDef.cardType === 'ability') {
      const ablDef = cardDef as AbilityCardDef;

      const reqTxt = new Text({
        text: `Requirements: ${ablDef.requirements.map(r => `${r.type}: ${r.value}`).join(', ') || 'None'}`,
        style: new TextStyle({ fontSize: 12, fill: COLORS.textMuted, fontFamily: FONT }),
      });
      reqTxt.y = py;
      panelContainer.addChild(reqTxt);
      py += 20;

      for (const effect of ablDef.effects) {
        const descTxt = new Text({
          text: effect.effectDescription,
          style: new TextStyle({
            fontSize: 13,
            fill: COLORS.text,
            fontFamily: FONT,
            wordWrap: true,
            wordWrapWidth: panelW,
            lineHeight: 18,
          }),
        });
        descTxt.y = py;
        panelContainer.addChild(descTxt);
        py += descTxt.height + 10;
      }
    }

    // Close hint
    py += 10;
    const closeTxt = new Text({
      text: 'Click anywhere to close',
      style: new TextStyle({ fontSize: 11, fill: COLORS.textMuted, fontFamily: FONT, fontStyle: 'italic' }),
    });
    closeTxt.y = py;
    panelContainer.addChild(closeTxt);

    content.addChild(panelContainer);
    this.addChild(content);

    // Animate in
    content.alpha = 0;
    content.scale.set(0.85);
    this.timeline = gsap.timeline();
    this.timeline.to(content, { alpha: 1, duration: 0.2, ease: 'power2.out' });
    this.timeline.to(content.scale, { x: 1, y: 1, duration: 0.25, ease: 'back.out(1.5)' }, '<');
  }

  dispose(): void {
    this.timeline.kill();
  }
}
