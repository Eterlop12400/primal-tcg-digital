// ============================================================
// Primal TCG — Narration Overlay
// ============================================================
// PixiJS container that displays narration text panels.
// Persists on uiLayer — not cleared each frame.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';
import { COLORS } from '../layout';
import { FONT } from '../SharedStyles';
import type { NarrationItem } from './NarrationTracker';
import { NarrationVoice } from './NarrationVoice';

const MAX_QUEUE = 3;
const PANEL_PAD_X = 20;
const PANEL_PAD_Y = 12;
const MAX_TEXT_WIDTH = 460;

export class NarrationOverlay extends Container {
  private queue: NarrationItem[] = [];
  private isShowing = false;
  private currentTween: gsap.core.Timeline | null = null;
  private panel: Container | null = null;
  private screenW = 0;
  private screenH = 0;
  private uiBarH = 44;
  private voice = new NarrationVoice();

  constructor() {
    super();
    this.zIndex = 9999;
  }

  updateLayout(screenW: number, screenH: number, uiBarH: number): void {
    this.screenW = screenW;
    this.screenH = screenH;
    this.uiBarH = uiBarH;
  }

  enqueue(items: NarrationItem[]): void {
    for (const item of items) {
      if (this.queue.length >= MAX_QUEUE) {
        // Drop lowest priority items when full
        const actionIdx = this.queue.findIndex((q) => q.priority === 'action');
        if (actionIdx >= 0 && item.priority === 'concept') {
          this.queue.splice(actionIdx, 1);
        } else if (this.queue.length >= MAX_QUEUE) {
          continue;
        }
      }
      this.queue.push(item);
    }

    if (!this.isShowing) {
      this.showNext();
    }
  }

  setVoiceEnabled(enabled: boolean): void {
    this.voice.setEnabled(enabled);
  }

  clear(): void {
    this.queue = [];
    this.voice.stop();
    if (this.currentTween) {
      this.currentTween.kill();
      this.currentTween = null;
    }
    if (this.panel) {
      this.removeChild(this.panel);
      this.panel.destroy({ children: true });
      this.panel = null;
    }
    this.isShowing = false;
  }

  private showNext(): void {
    if (this.queue.length === 0) {
      this.isShowing = false;
      return;
    }

    this.isShowing = true;
    const item = this.queue.shift()!;

    // Speak the narration text via TTS
    this.voice.speak(item.text);

    // Clean up previous panel
    if (this.panel) {
      this.removeChild(this.panel);
      this.panel.destroy({ children: true });
      this.panel = null;
    }

    const panel = new Container();
    this.panel = panel;

    // Title text
    const isConcept = item.priority === 'concept';
    const titleColor = isConcept ? COLORS.accentCyan : COLORS.textMuted;

    const titleTxt = new Text({
      text: item.title,
      style: new TextStyle({
        fontSize: 12,
        fill: titleColor,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 2,
      }),
    });

    // Body text
    const bodyTxt = new Text({
      text: item.text,
      style: new TextStyle({
        fontSize: 13,
        fill: COLORS.textBright,
        fontFamily: FONT,
        wordWrap: true,
        wordWrapWidth: MAX_TEXT_WIDTH,
        lineHeight: 18,
      }),
    });

    // Calculate panel dimensions
    const textW = Math.max(titleTxt.width, Math.min(bodyTxt.width, MAX_TEXT_WIDTH));
    const panelW = textW + PANEL_PAD_X * 2;
    const panelH = titleTxt.height + bodyTxt.height + PANEL_PAD_Y * 2 + 6;

    // Background
    const bg = new Graphics();
    bg.roundRect(0, 0, panelW, panelH, 6);
    bg.fill({ color: 0x0a0e18, alpha: 0.92 });
    panel.addChild(bg);

    // Cyan accent line on top
    const accent = new Graphics();
    accent.moveTo(PANEL_PAD_X, 0);
    accent.lineTo(panelW - PANEL_PAD_X, 0);
    accent.stroke({ color: COLORS.accentCyan, width: 2, alpha: isConcept ? 0.9 : 0.4 });
    panel.addChild(accent);

    // Border
    const border = new Graphics();
    border.roundRect(0, 0, panelW, panelH, 6);
    border.stroke({ color: COLORS.accentCyan, width: 1, alpha: 0.2 });
    panel.addChild(border);

    // Position text
    titleTxt.x = PANEL_PAD_X;
    titleTxt.y = PANEL_PAD_Y;
    panel.addChild(titleTxt);

    bodyTxt.x = PANEL_PAD_X;
    bodyTxt.y = PANEL_PAD_Y + titleTxt.height + 6;
    panel.addChild(bodyTxt);

    // Position panel: bottom-center, above UI bar
    panel.x = this.screenW / 2 - panelW / 2;
    panel.y = this.screenH - this.uiBarH - panelH - 60;

    // Animation: slide up + fade in, hold, fade out
    panel.alpha = 0;
    const startY = panel.y + 20;
    panel.y = startY;

    this.addChild(panel);

    const targetY = startY - 20;
    const holdDuration = item.duration / 1000;

    this.currentTween = gsap.timeline({
      onComplete: () => {
        if (this.panel === panel) {
          this.removeChild(panel);
          panel.destroy({ children: true });
          this.panel = null;
        }
        this.currentTween = null;
        this.showNext();
      },
    });

    this.currentTween
      .to(panel, { alpha: 1, y: targetY, duration: 0.3, ease: 'power2.out' })
      .to(panel, { alpha: 0, y: targetY - 10, duration: 0.3, ease: 'power2.in' }, `+=${holdDuration}`);
  }
}
