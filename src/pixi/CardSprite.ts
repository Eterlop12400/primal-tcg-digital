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
import gsap from 'gsap';
import { getCardTexture, getCardBackTexture } from './AssetLoader';
import { COLORS, CardSize, CARD_SIZES } from './layout';
import { FONT } from './SharedStyles';
import { TIMING } from './timing';
import type { CardInstance, CardDef, CharacterCardDef, StrategyCardDef } from '@/game/types';

export interface CardSpriteOptions {
  defId: string;
  size: CardSize;
  faceDown?: boolean;
  cardDef?: CardDef;
  instance?: CardInstance;
  effectiveStats?: { lead: number; support: number };
  selected?: boolean;
  highlighted?: boolean;
  highlightColor?: number;
  injured?: boolean;
  interactive?: boolean;
  showName?: boolean;
  /** When true, base alpha is reduced to indicate the card is not a valid target for the current selection mode. */
  dimmed?: boolean;
  /** When true, draw a pulsing outer glow ring indicating the card is playable. */
  playable?: boolean;
  /** Type color used for playable glow (defaults to card type color). */
  playableColor?: number;
  /** When true, draw a pulsing gold border indicating the card has an activatable effect. */
  activatable?: boolean;
}

export class CardSprite extends Container {
  private _size: CardSize;
  private _selected = false;
  private _highlighted = false;
  private _highlightColor: number;
  private _typeColor = 0x374151;
  private borderGfx: Graphics;
  private glowGfx: Graphics;
  private _pulseTween: gsap.core.Tween | null = null;
  private _playableGlowTween: gsap.core.Tween | null = null;
  private _activatableGlowTween: gsap.core.Tween | null = null;
  private _hoverTween: gsap.core.Tween | null = null;
  private _isHovered = false;
  public instanceId?: string;

  constructor(options: CardSpriteOptions) {
    super();
    this._size = options.size;
    this._selected = options.selected ?? false;
    this._highlighted = options.highlighted ?? false;
    this._highlightColor = options.highlightColor ?? COLORS.cardHighlight;
    this.instanceId = options.instance?.instanceId;

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

    // Type-colored border constant
    const typeColors: Record<string, number> = {
      character: 0x3b82f6,  // blue
      ability: 0xf59e0b,    // amber
      strategy: 0x10b981,   // green
      field: 0xa855f7,      // purple
    };
    const typeColor = (!faceDown && options.cardDef) ? (typeColors[options.cardDef.cardType] ?? 0x6b7280) : 0x374151;

    // Card image
    const texture = faceDown ? getCardBackTexture() : getCardTexture(options.defId);
    const img = new Sprite(texture);
    const margin = 2;
    img.x = margin;
    img.y = margin;
    img.width = size.width - margin * 2;
    img.height = size.height - margin * 2;
    this.addChild(img);

    // Bottom gradient overlay (transparent → black) for name label blending
    if (!faceDown && options.cardDef) {
      const gradH = Math.min(size.height * 0.35, 50);
      const grad = new Graphics();
      // Simulate gradient with layered rects
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * 0.7;
        const gy = size.height - gradH + (gradH * i) / steps;
        const gh = gradH / steps + 1;
        grad.rect(margin, gy, size.width - margin * 2, gh);
        grad.fill({ color: 0x000000, alpha: a });
      }
      this.addChild(grad);

      // Subtle inner shadow at top for depth
      const topShadow = new Graphics();
      topShadow.rect(margin, margin, size.width - margin * 2, 6);
      topShadow.fill({ color: 0x000000, alpha: 0.25 });
      this.addChild(topShadow);
    }

    // Glow effect (behind border, visible on hover)
    this.glowGfx = new Graphics();
    this.glowGfx.alpha = 0;
    this.addChild(this.glowGfx);

    // Border (drawn on top of everything at the end)
    this.borderGfx = new Graphics();
    this._typeColor = typeColor;

    if (!faceDown && options.cardDef) {
      const isChar = options.cardDef.cardType === 'character';

      // --- Stats badge (top, for characters) — rounded-rect pill style ---
      if (isChar && options.effectiveStats) {
        const stats = options.effectiveStats;
        const fontSize = size.width >= 72 ? 13 : 10;
        const badgeH = fontSize + 8;
        const pillPad = 4;

        // Lead stat pill (gold background)
        const leadStr = `${stats.lead}`;
        const supStr = `${stats.support}`;
        const leadTxt = new Text({
          text: leadStr,
          style: new TextStyle({ fontSize, fill: 0x000000, fontFamily: FONT, fontWeight: 'bold' }),
        });
        const supTxt = new Text({
          text: supStr,
          style: new TextStyle({ fontSize, fill: 0xffffff, fontFamily: FONT, fontWeight: 'bold' }),
        });

        const leadPillW = leadTxt.width + pillPad * 2;
        const supPillW = supTxt.width + pillPad * 2;

        // Lead pill
        const leadPill = new Graphics();
        leadPill.roundRect(2, 2, leadPillW, badgeH, 3);
        leadPill.fill({ color: COLORS.leadColor, alpha: 0.9 });
        this.addChild(leadPill);
        leadTxt.x = 2 + pillPad;
        leadTxt.y = 2 + (badgeH - leadTxt.height) / 2;
        this.addChild(leadTxt);

        // Support pill
        const supPill = new Graphics();
        supPill.roundRect(2 + leadPillW + 2, 2, supPillW, badgeH, 3);
        supPill.fill({ color: COLORS.supportColor, alpha: 0.8 });
        this.addChild(supPill);
        supTxt.x = 2 + leadPillW + 2 + pillPad;
        supTxt.y = 2 + (badgeH - supTxt.height) / 2;
        this.addChild(supTxt);

        // Health dot
        if (options.instance?.state) {
          const dotR = Math.max(3, size.width * 0.04);
          const dot = new Graphics();
          const dotColor = options.instance.state === 'healthy' ? COLORS.healthyDot : COLORS.injuredDot;
          dot.circle(size.width - dotR - 3, 2 + badgeH / 2, dotR);
          dot.fill({ color: dotColor });
          this.addChild(dot);
        }
      }

      // --- Turn cost pill (top-right corner) ---
      if ((options.cardDef.cardType === 'character' || options.cardDef.cardType === 'strategy')) {
        const turnCost = (options.cardDef as CharacterCardDef | StrategyCardDef).turnCost;
        const tcFontSize = size.width >= 72 ? 11 : 9;
        const tcBadgeH = tcFontSize + 6;
        const tcTxt = new Text({
          text: `T${turnCost}`,
          style: new TextStyle({ fontSize: tcFontSize, fill: 0xffffff, fontFamily: FONT, fontWeight: 'bold' }),
        });
        const tcPillW = tcTxt.width + 8;
        const tcPill = new Graphics();
        tcPill.roundRect(size.width - tcPillW - 2, 2, tcPillW, tcBadgeH, 3);
        tcPill.fill({ color: 0x6b21a8, alpha: 0.9 });
        this.addChild(tcPill);
        tcTxt.x = size.width - tcPillW - 2 + 4;
        tcTxt.y = 2 + (tcBadgeH - tcTxt.height) / 2;
        this.addChild(tcTxt);
      }

      // --- Counter badges ---
      if (options.instance && options.instance.counters.length > 0) {
        const inst = options.instance;
        const plusOnes = inst.counters.filter((c) => c.type === 'plus-one').length;
        const minusOnes = inst.counters.filter((c) => c.type === 'minus-one').length;
        const permanents = inst.counters.filter((c) => c.type === 'permanent').length;
        let badgeY = isChar && options.effectiveStats ? 22 : 2;
        const fontSize = size.width >= 72 ? 12 : 9;

        if (plusOnes > 0) {
          this.addChild(this.makeBadge(`+${plusOnes}/+${plusOnes}`, 0x10b981, fontSize, 2, badgeY));
          badgeY += fontSize + 5;
        }
        if (minusOnes > 0) {
          this.addChild(this.makeBadge(`-${minusOnes}/-${minusOnes}`, 0xef4444, fontSize, 2, badgeY));
          badgeY += fontSize + 5;
        }
        if (permanents > 0) {
          this.addChild(this.makePermanentBadge(permanents, fontSize, size.width, badgeY));
        }
      }

      // --- Name label (bottom) with type-colored accent ---
      if (showName) {
        const fontSize = size.width >= 72 ? 12 : 9;
        const barH = fontSize + 8;

        // Type-colored accent line above name
        const accentLine = new Graphics();
        accentLine.moveTo(4, size.height - barH);
        accentLine.lineTo(size.width - 4, size.height - barH);
        accentLine.stroke({ color: typeColor, width: 1, alpha: 0.6 });
        this.addChild(accentLine);

        const nameTxt = new Text({
          text: options.cardDef.name,
          style: new TextStyle({
            fontSize,
            fill: COLORS.textBright,
            fontFamily: FONT,
            fontWeight: 'bold',
          }),
        });
        nameTxt.anchor.set(0.5, 0.5);
        nameTxt.x = size.width / 2;
        nameTxt.y = size.height - barH / 2;
        // Truncate if too wide
        const maxNameW = size.width - 10;
        if (nameTxt.width > maxNameW) {
          nameTxt.scale.x = maxNameW / nameTxt.width;
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

    // Dimmed state for cards that aren't valid selection targets
    if (options.dimmed) {
      this.alpha = 0.45;
    }

    // Playable glow — pulsing outer glow indicating card can be played
    if (options.playable && !options.dimmed) {
      const glowColor = options.playableColor ?? typeColor;

      // Outer soft glow (wider, diffuse)
      const outerGlow = new Graphics();
      outerGlow.roundRect(-10, -10, size.width + 20, size.height + 20, 12);
      outerGlow.fill({ color: glowColor, alpha: 0.12 });
      this.addChildAt(outerGlow, 0);

      // Inner crisp border
      const playableGlow = new Graphics();
      playableGlow.roundRect(-4, -4, size.width + 8, size.height + 8, 6);
      playableGlow.fill({ color: glowColor, alpha: 0.06 });
      playableGlow.stroke({ color: glowColor, width: 2.5, alpha: 0.7 });
      this.addChildAt(playableGlow, 1);

      // Subtle upward lift for playable cards
      this.y -= 3;

      this._playableGlowTween = gsap.to(outerGlow, {
        alpha: 0.35,
        duration: TIMING.playableGlowPulse / 2,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }

    // Activatable glow — pulsing gold border indicating an activate effect is available
    if (options.activatable && !options.dimmed && !options.playable) {
      const activatableGlow = new Graphics();
      activatableGlow.roundRect(-6, -6, size.width + 12, size.height + 12, 8);
      activatableGlow.fill({ color: 0xd4a843, alpha: 0.06 });
      activatableGlow.stroke({ color: 0xd4a843, width: 2, alpha: 0.5 });
      this.addChildAt(activatableGlow, 0);
      this._activatableGlowTween = gsap.to(activatableGlow, {
        alpha: 0.4,
        duration: TIMING.playableGlowPulse / 2,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }

    if (options.interactive) {
      this.eventMode = 'static';
      this.cursor = 'pointer';

      // Hover effects
      this.on('pointerover', this.onHoverIn, this);
      this.on('pointerout', this.onHoverOut, this);

      // Press feedback — quick scale-down on pointer down, springy return on pointer up
      this.on('pointerdown', this.onPressDown, this);
      this.on('pointerup', this.onPressUp, this);
      this.on('pointerupoutside', this.onPressUp, this);
    }
  }

  private onPressDown(): void {
    if (this.eventMode === 'none') return;
    gsap.to(this.scale, {
      x: this._isHovered ? 1.05 : 0.95,
      y: this._isHovered ? 1.05 : 0.95,
      duration: TIMING.pressDown,
      ease: 'power2.out',
    });
  }

  private onPressUp(): void {
    if (this.eventMode === 'none') return;
    const restX = this._isHovered ? 1.12 : 1;
    const restY = this._isHovered ? 1.12 : 1;
    gsap.to(this.scale, {
      x: restX,
      y: restY,
      duration: TIMING.pressUp,
      ease: 'back.out(2)',
    });
  }

  private onHoverIn(): void {
    if (this._isHovered) return;
    this._isHovered = true;

    // Draw glow
    this.glowGfx.clear();
    this.glowGfx.roundRect(-3, -3, this._size.width + 6, this._size.height + 6, 6);
    this.glowGfx.fill({ color: COLORS.accentCyan, alpha: 0.15 });
    this.glowGfx.stroke({ color: COLORS.accentCyan, width: 2, alpha: 0.6 });

    // Kill any existing tween
    if (this._hoverTween) {
      this._hoverTween.kill();
    }

    // Raise zIndex
    this.zIndex = 100;

    // Scale up + lift + show glow
    gsap.to(this.scale, { x: 1.12, y: 1.12, duration: 0.15, ease: 'back.out(2)' });
    gsap.to(this, { y: this.y - 8, duration: 0.15, ease: 'power2.out' });
    this._hoverTween = gsap.to(this.glowGfx, { alpha: 1, duration: 0.15 });
  }

  private onHoverOut(): void {
    if (!this._isHovered) return;
    this._isHovered = false;

    // Reset zIndex
    this.zIndex = 0;

    // Scale back + drop + hide glow
    gsap.to(this.scale, { x: 1, y: 1, duration: 0.15, ease: 'power2.out' });
    gsap.to(this, { y: this.y + 8, duration: 0.15, ease: 'power2.out' });
    if (this._hoverTween) {
      this._hoverTween.kill();
    }
    this._hoverTween = gsap.to(this.glowGfx, { alpha: 0, duration: 0.15 });
  }

  private makePermanentBadge(count: number, fontSize: number, cardWidth: number, y: number): Container {
    const c = new Container();
    const txt = new Text({
      text: `\u23F3${count}`,
      style: new TextStyle({ fontSize, fill: COLORS.textGold ?? 0xfbbf24, fontFamily: FONT, fontWeight: 'bold' }),
    });
    const padX = 4;
    const padY = 2;
    const bg = new Graphics();
    bg.roundRect(-padX, -padY, txt.width + padX * 2, txt.height + padY * 2, 3);
    bg.fill({ color: 0x2a1f00, alpha: 0.9 });
    bg.stroke({ color: COLORS.textGold ?? 0xfbbf24, width: 1, alpha: 0.8 });
    c.addChild(bg);
    c.addChild(txt);
    // Position at top-right of card
    c.x = cardWidth - txt.width - padX - 2;
    c.y = y;
    return c;
  }

  private makeBadge(text: string, color: number, fontSize: number, x: number, y: number): Container {
    const c = new Container();
    const txt = new Text({
      text,
      style: new TextStyle({ fontSize, fill: color, fontFamily: FONT, fontWeight: 'bold' }),
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
    let color = this._typeColor;
    let width = 2;
    let alpha = 0.5;

    if (this._selected) {
      color = COLORS.cardSelectedBorder;
      width = 2;
      alpha = 1;
    } else if (this._highlighted) {
      color = this._highlightColor;
      width = 2;
      alpha = 1;
    }

    this.borderGfx.roundRect(0, 0, this._size.width, this._size.height, 4);
    this.borderGfx.stroke({ color, width, alpha });

    // Pulsing glow for highlighted (playable) cards
    if (this._pulseTween) {
      this._pulseTween.kill();
      this._pulseTween = null;
    }
    if (this._highlighted && !this._selected) {
      // Outer glow ring
      this.borderGfx.roundRect(-2, -2, this._size.width + 4, this._size.height + 4, 6);
      this.borderGfx.stroke({ color: this._highlightColor, width: 1, alpha: 0.3 });
      this._pulseTween = gsap.to(this.borderGfx, {
        alpha: 0.5,
        duration: 0.8,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }
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

  get cardWidth(): number {
    return this._size.width;
  }

  get cardHeight(): number {
    return this._size.height;
  }

  override destroy(options?: boolean | { children?: boolean; texture?: boolean; baseTexture?: boolean }): void {
    if (this._pulseTween) { this._pulseTween.kill(); this._pulseTween = null; }
    if (this._playableGlowTween) { this._playableGlowTween.kill(); this._playableGlowTween = null; }
    if (this._activatableGlowTween) { this._activatableGlowTween.kill(); this._activatableGlowTween = null; }
    if (this._hoverTween) { this._hoverTween.kill(); this._hoverTween = null; }
    gsap.killTweensOf(this);
    gsap.killTweensOf(this.scale);
    super.destroy(options);
  }

  /**
   * Card flip animation: scaleX 1→0, swap texture at midpoint, scaleX 0→1.
   * Used when opponent plays a card (face-down in hand → face-up on field).
   */
  flipToFaceUp(defId: string): Promise<void> {
    return new Promise((resolve) => {
      const duration = 0.15;
      const tl = gsap.timeline({ onComplete: resolve });

      // Flip to edge
      tl.to(this.scale, { x: 0, duration, ease: 'power2.in' })
        .call(() => {
          // At midpoint, swap the card image texture
          const children = this.children;
          for (const child of children) {
            if (child instanceof Sprite) {
              child.texture = getCardTexture(defId);
              break;
            }
          }
        })
        // Flip back open
        .to(this.scale, { x: 1, duration, ease: 'power2.out' });
    });
  }
}
