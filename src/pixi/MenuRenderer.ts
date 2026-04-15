// ============================================================
// Primal TCG — Animated Menu Background Renderer
// ============================================================
// PixiJS canvas with floating particles and drifting card silhouettes
// behind the HTML main menu. Purely decorative.

import { Application, Container, Graphics } from 'pixi.js';
import gsap from 'gsap';
import { COLORS } from './layout';

interface Particle {
  gfx: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export class MenuRenderer {
  private app: Application;
  private particleLayer = new Container();
  private particles: Particle[] = [];
  private ticker: (() => void) | null = null;
  private destroyed = false;

  constructor() {
    this.app = new Application();
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      canvas,
      resizeTo: canvas.parentElement ?? undefined,
      backgroundColor: COLORS.background,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    this.app.stage.addChild(this.particleLayer);

    // Seed initial particles
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    for (let i = 0; i < 40; i++) {
      this.spawnParticle(
        Math.random() * screenW,
        Math.random() * screenH,
        true,
      );
    }

    // Add drifting card silhouettes
    this.addCardSilhouettes();

    // Animation loop
    this.ticker = () => this.updateParticles();
    this.app.ticker.add(this.ticker);
  }

  private spawnParticle(x: number, y: number, randomLife = false): void {
    const gfx = new Graphics();
    const size = 1 + Math.random() * 2;
    const color = Math.random() > 0.7 ? COLORS.accentGold : COLORS.accentCyan;
    gfx.circle(0, 0, size);
    gfx.fill({ color, alpha: 0.3 + Math.random() * 0.3 });
    gfx.x = x;
    gfx.y = y;
    this.particleLayer.addChild(gfx);

    const maxLife = 200 + Math.random() * 300;
    this.particles.push({
      gfx,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -0.1 - Math.random() * 0.3,
      life: randomLife ? Math.random() * maxLife : 0,
      maxLife,
    });
  }

  private updateParticles(): void {
    if (this.destroyed) return;

    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const toRemove: number[] = [];

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.gfx.x += p.vx;
      p.gfx.y += p.vy;
      p.life++;

      // Fade in/out
      const t = p.life / p.maxLife;
      if (t < 0.1) {
        p.gfx.alpha = t / 0.1;
      } else if (t > 0.8) {
        p.gfx.alpha = (1 - t) / 0.2;
      }

      if (p.life >= p.maxLife) {
        toRemove.push(i);
      }
    }

    // Remove dead particles and spawn replacements
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      const p = this.particles[idx];
      this.particleLayer.removeChild(p.gfx);
      p.gfx.destroy();
      this.particles.splice(idx, 1);

      // Spawn replacement from bottom
      this.spawnParticle(
        Math.random() * screenW,
        screenH + Math.random() * 20,
      );
    }
  }

  private addCardSilhouettes(): void {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const count = 5;

    for (let i = 0; i < count; i++) {
      const card = new Graphics();
      const w = 40 + Math.random() * 30;
      const h = w * 1.4;
      card.roundRect(0, 0, w, h, 4);
      card.fill({ color: COLORS.panelBg, alpha: 0.15 });
      card.stroke({ color: COLORS.panelBorder, width: 1, alpha: 0.1 });

      card.x = Math.random() * screenW;
      card.y = Math.random() * screenH;
      card.rotation = (Math.random() - 0.5) * 0.3;
      card.alpha = 0;
      this.particleLayer.addChild(card);

      // Slow drift animation
      const duration = 15 + Math.random() * 15;
      gsap.to(card, { alpha: 0.3 + Math.random() * 0.2, duration: 2, ease: 'power2.out' });
      gsap.to(card, {
        x: card.x + (Math.random() - 0.5) * 200,
        y: card.y - 50 - Math.random() * 100,
        rotation: card.rotation + (Math.random() - 0.5) * 0.5,
        duration,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }
  }

  resize(): void {
    // PixiJS handles resize via resizeTo
  }

  destroy(): void {
    this.destroyed = true;
    if (this.ticker) {
      this.app.ticker.remove(this.ticker);
    }
    gsap.killTweensOf(this.particleLayer.children);
    this.app.destroy(true, { children: true });
  }
}
