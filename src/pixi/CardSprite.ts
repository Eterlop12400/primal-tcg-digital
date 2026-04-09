// ============================================================
// Primal TCG — PixiJS Card Sprite
// ============================================================

import {
  Container,
  Sprite,
  Graphics,
  Text,
  TextStyle,
} from 'pixi.js';
import { getCardTexture, getCardBackTexture } from './AssetLoader';
import { COLORS, CardSize, CARD_SIZES } from './layout';
import type { CardInstance, CardDef } from '@/game/types';

export interface CardSpriteOptions {
  defId: string;
  size: CardSize;
  faceDown?: boolean;
  cardDef?: CardDef;
  instance?: CardInstance;
  effectiveStats?: { lead: number; support: number };
  selected?: boolean;
  highlighted?: boolean;
  injured?: boolean;
  interactive?: boolean;
  showName?: boolean;
}

export class CardSprite extends Container {
  private _size: CardSize;
  private _selected = false;
  private _highlighted = false;
  private borderGfx: Graphics;

  constructor(options: CardSpriteOptions) {
    super();
    this._size = options.size;
    this._selected = options.selected ?? false;
    this._highlighted = options.highlighted ?? false;

    const { size } = options;
    const faceDown = options.faceDown ?? false;
    const showName = options.showName ?? (size.width >= 56);

    // Drop shadow
    const shadow = new Graphics();
    shadow.roundRect(2, 2, size.width, size.height, 4);
    shadow.fill({ color: 0x000000, alpha: 0.4 });
    this.addChild(shadow);

    // Card background
    const bg = new Graphics();
    bg.roundRect(0, 0, size.width, size.height, 4);
    bg.fill({ color: COLORS.cardBack });
    this.addChild(bg);

    // Card image
    const texture = faceDown ? getCardBackTexture() : getCardTexture(options.defId);
    const img = new Sprite(texture);
    const margin = 2;
    img.x = margin;
    img.y = margin;
    img.width = size.width - margin * 2;
    img.height = size.height - margin * 2;
    this.addChild(img);

    // Border (drawn on top of everything at the end)
    this.borderGfx = new Graphics();

    if (!faceDown && options.cardDef) {
      const isChar = options.cardDef.cardType === 'character';

      // --- Stats badge (top, for characters) ---
      if (isChar && options.effectiveStats) {
        const stats = options.effectiveStats;
        const fontSize = size.width >= 72 ? 10 : 8;
        const badgeH = fontSize + 5;

        const statBg = new Graphics();
        statBg.roundRect(0, 0, size.width, badgeH, 0);
        statBg.fill({ color: 0x000000, alpha: 0.85 });
        this.addChild(statBg);

        const leadTxt = new Text({
          text: `${stats.lead}`,
          style: new TextStyle({ fontSize, fill: COLORS.leadColor, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
        });
        leadTxt.x = 4;
        leadTxt.y = 2;
        this.addChild(leadTxt);

        const slash = new Text({
          text: '/',
          style: new TextStyle({ fontSize: fontSize - 1, fill: 0x9ca3af, fontFamily: 'Arial, sans-serif' }),
        });
        slash.x = leadTxt.x + leadTxt.width + 1;
        slash.y = 2;
        this.addChild(slash);

        const supTxt = new Text({
          text: `${stats.support}`,
          style: new TextStyle({ fontSize, fill: COLORS.supportColor, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
        });
        supTxt.x = slash.x + slash.width + 1;
        supTxt.y = 2;
        this.addChild(supTxt);

        // Health dot
        if (options.instance?.state) {
          const dotR = Math.max(3, size.width * 0.04);
          const dot = new Graphics();
          const dotColor = options.instance.state === 'healthy' ? COLORS.healthyDot : COLORS.injuredDot;
          dot.circle(size.width - dotR - 3, badgeH / 2, dotR);
          dot.fill({ color: dotColor });
          this.addChild(dot);
        }
      }

      // --- Counter badges ---
      if (options.instance && options.instance.counters.length > 0) {
        const inst = options.instance;
        const plusOnes = inst.counters.filter((c) => c.type === 'plus-one').length;
        const minusOnes = inst.counters.filter((c) => c.type === 'minus-one').length;
        let badgeY = isChar && options.effectiveStats ? 18 : 2;
        const fontSize = size.width >= 72 ? 9 : 7;

        if (plusOnes > 0) {
          this.addChild(this.makeBadge(`+${plusOnes}/+${plusOnes}`, 0x10b981, fontSize, 2, badgeY));
          badgeY += fontSize + 5;
        }
        if (minusOnes > 0) {
          this.addChild(this.makeBadge(`-${minusOnes}/-${minusOnes}`, 0xef4444, fontSize, 2, badgeY));
        }
      }

      // --- Name label (bottom) ---
      if (showName) {
        const fontSize = size.width >= 72 ? 9 : 7;
        const barH = fontSize + 6;
        const nameBg = new Graphics();
        nameBg.roundRect(0, size.height - barH, size.width, barH, 0);
        nameBg.fill({ color: 0x000000, alpha: 0.75 });
        this.addChild(nameBg);

        const nameTxt = new Text({
          text: options.cardDef.name,
          style: new TextStyle({
            fontSize,
            fill: COLORS.textBright,
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
          }),
        });
        nameTxt.anchor.set(0.5, 0.5);
        nameTxt.x = size.width / 2;
        nameTxt.y = size.height - barH / 2;
        // Truncate if too wide
        if (nameTxt.width > size.width - 6) {
          nameTxt.scale.x = (size.width - 6) / nameTxt.width;
        }
        this.addChild(nameTxt);
      }
    }

    // Add border on top
    this.addChild(this.borderGfx);
    this.drawBorder();

    // Injured rotation
    if (options.injured) {
      this.pivot.set(size.width / 2, size.height / 2);
      this.rotation = -Math.PI / 2;
      // Caller is responsible for positioning
    }

    if (options.interactive) {
      this.eventMode = 'static';
      this.cursor = 'pointer';
    }
  }

  private makeBadge(text: string, color: number, fontSize: number, x: number, y: number): Container {
    const c = new Container();
    const txt = new Text({
      text,
      style: new TextStyle({ fontSize, fill: color, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
    });
    const bg = new Graphics();
    bg.roundRect(-2, -1, txt.width + 4, txt.height + 2, 2);
    bg.fill({ color: 0x000000, alpha: 0.85 });
    c.addChild(bg);
    c.addChild(txt);
    c.x = x;
    c.y = y;
    return c;
  }

  private drawBorder(): void {
    this.borderGfx.clear();
    let color = COLORS.cardBorder;
    let width = 1;
    let alpha = 0.6;

    if (this._selected) {
      color = COLORS.cardSelectedBorder;
      width = 2;
      alpha = 1;
    } else if (this._highlighted) {
      color = COLORS.cardHighlight;
      width = 2;
      alpha = 1;
    }

    this.borderGfx.roundRect(0, 0, this._size.width, this._size.height, 4);
    this.borderGfx.stroke({ color, width, alpha });
  }

  set selected(v: boolean) {
    if (this._selected === v) return;
    this._selected = v;
    this.drawBorder();
  }

  set highlighted(v: boolean) {
    if (this._highlighted === v) return;
    this._highlighted = v;
    this.drawBorder();
  }
}
