// ============================================================
// Primal TCG — Loading Screen
// ============================================================
// Shown while assets load. Progress bar with game title.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';
import { COLORS } from './layout';
import { FONT } from './SharedStyles';

export class LoadingScreen extends Container {
  private progressBar: Graphics;
  private progressFill: Graphics;
  private progressText: Text;
  private barWidth: number;
  private barHeight = 6;

  constructor(screenW: number, screenH: number) {
    super();

    // Background
    const bg = new Graphics();
    bg.rect(0, 0, screenW, screenH);
    bg.fill({ color: COLORS.background });
    this.addChild(bg);

    // Title
    const title = new Text({
      text: 'PRIMAL TCG',
      style: new TextStyle({
        fontSize: 32,
        fill: COLORS.textBright,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 8,
      }),
    });
    title.anchor.set(0.5, 0.5);
    title.x = screenW / 2;
    title.y = screenH / 2 - 40;
    this.addChild(title);

    // Subtitle
    const subtitle = new Text({
      text: 'DIGITAL',
      style: new TextStyle({
        fontSize: 14,
        fill: COLORS.accentGold,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 12,
      }),
    });
    subtitle.anchor.set(0.5, 0.5);
    subtitle.x = screenW / 2;
    subtitle.y = screenH / 2 - 10;
    this.addChild(subtitle);

    // Progress bar background
    this.barWidth = Math.min(300, screenW * 0.5);
    const barX = screenW / 2 - this.barWidth / 2;
    const barY = screenH / 2 + 30;

    this.progressBar = new Graphics();
    this.progressBar.roundRect(barX, barY, this.barWidth, this.barHeight, 3);
    this.progressBar.fill({ color: 0x1a2535 });
    this.addChild(this.progressBar);

    // Progress bar fill
    this.progressFill = new Graphics();
    this.progressFill.roundRect(barX, barY, 0, this.barHeight, 3);
    this.progressFill.fill({ color: COLORS.accentBlue });
    this.addChild(this.progressFill);

    // Progress text
    this.progressText = new Text({
      text: 'Loading assets...',
      style: new TextStyle({
        fontSize: 10,
        fill: COLORS.textMuted,
        fontFamily: FONT,
      }),
    });
    this.progressText.anchor.set(0.5, 0);
    this.progressText.x = screenW / 2;
    this.progressText.y = barY + this.barHeight + 8;
    this.addChild(this.progressText);

    // Animate title entrance
    title.alpha = 0;
    subtitle.alpha = 0;
    gsap.to(title, { alpha: 1, duration: 0.5, ease: 'power2.out' });
    gsap.to(subtitle, { alpha: 1, duration: 0.5, delay: 0.2, ease: 'power2.out' });
  }

  /** Update progress (0-1) */
  setProgress(progress: number, label?: string): void {
    const barX = this.progressBar.x;
    const barY = this.progressBar.y;
    const fillW = this.barWidth * Math.min(1, Math.max(0, progress));

    this.progressFill.clear();
    this.progressFill.roundRect(
      this.progressBar.getBounds().x,
      this.progressBar.getBounds().y,
      fillW,
      this.barHeight,
      3,
    );
    this.progressFill.fill({ color: COLORS.accentBlue });

    if (label) {
      this.progressText.text = label;
    }
  }

  /** Animate out and destroy */
  fadeOut(): Promise<void> {
    return new Promise((resolve) => {
      gsap.to(this, {
        alpha: 0,
        duration: 0.4,
        ease: 'power2.in',
        onComplete: () => {
          this.destroy({ children: true });
          resolve();
        },
      });
    });
  }
}
