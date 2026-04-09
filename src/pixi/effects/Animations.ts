// ============================================================
// Primal TCG — PixiJS Animations & Effects
// ============================================================
// GSAP-powered animations for card game events.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';
import { COLORS } from '../layout';

// ============================================================
// Turn Banner — sweeping "YOUR TURN" / "OPPONENT'S TURN" banner
// ============================================================

export function showTurnBanner(
  parent: Container,
  text: string,
  screenW: number,
  screenH: number,
): void {
  const banner = new Container();

  // Background bar
  const bg = new Graphics();
  const barH = 60;
  bg.rect(0, 0, screenW, barH);
  bg.fill({ color: 0x000000, alpha: 0.85 });
  banner.addChild(bg);

  // Accent lines
  for (const y of [0, barH]) {
    const line = new Graphics();
    line.moveTo(0, y);
    line.lineTo(screenW, y);
    line.stroke({ color: COLORS.accentBlue, width: 2, alpha: 0.7 });
    banner.addChild(line);
  }

  // Text
  const txt = new Text({
    text: text.toUpperCase(),
    style: new TextStyle({
      fontSize: 28,
      fill: COLORS.textBright,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'bold',
      letterSpacing: 8,
    }),
  });
  txt.anchor.set(0.5, 0.5);
  txt.x = screenW / 2;
  txt.y = barH / 2;
  banner.addChild(txt);

  banner.y = screenH / 2 - barH / 2;
  banner.alpha = 0;
  parent.addChild(banner);

  // Animate
  const tl = gsap.timeline({
    onComplete: () => {
      parent.removeChild(banner);
      banner.destroy();
    },
  });

  tl.fromTo(banner, { alpha: 0, x: -screenW }, { alpha: 1, x: 0, duration: 0.3, ease: 'power2.out' })
    .to(banner, { duration: 1 }) // hold
    .to(banner, { alpha: 0, x: screenW, duration: 0.3, ease: 'power2.in' });
}

// ============================================================
// Phase Banner — smaller phase label sweep
// ============================================================

export function showPhaseBanner(
  parent: Container,
  text: string,
  screenW: number,
  screenH: number,
): void {
  const banner = new Container();

  const bg = new Graphics();
  const barH = 36;
  bg.rect(0, 0, screenW * 0.5, barH);
  bg.fill({ color: 0x0c1425, alpha: 0.9 });
  banner.addChild(bg);

  const line = new Graphics();
  line.moveTo(0, barH);
  line.lineTo(screenW * 0.5, barH);
  line.stroke({ color: COLORS.accentBlue, width: 1, alpha: 0.5 });
  banner.addChild(line);

  const txt = new Text({
    text: text.toUpperCase(),
    style: new TextStyle({
      fontSize: 16,
      fill: COLORS.accentBlue,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'bold',
      letterSpacing: 3,
    }),
  });
  txt.anchor.set(0.5, 0.5);
  txt.x = screenW * 0.25;
  txt.y = barH / 2;
  banner.addChild(txt);

  banner.x = screenW * 0.25;
  banner.y = screenH / 2 - barH / 2 - 60; // above center bar
  banner.alpha = 0;
  parent.addChild(banner);

  const tl = gsap.timeline({
    onComplete: () => {
      parent.removeChild(banner);
      banner.destroy();
    },
  });

  tl.fromTo(banner, { alpha: 0 }, { alpha: 1, duration: 0.2, ease: 'power2.out' })
    .fromTo(txt.scale, { x: 1.3, y: 1.3 }, { x: 1, y: 1, duration: 0.2, ease: 'back.out' }, '<')
    .to(banner, { duration: 0.5 })
    .to(banner, { alpha: 0, y: banner.y - 20, duration: 0.2 });
}

// ============================================================
// Damage Numbers — floating "-X" text
// ============================================================

export function showDamageNumber(
  parent: Container,
  amount: number,
  x: number,
  y: number,
): void {
  const txt = new Text({
    text: `-${amount}`,
    style: new TextStyle({
      fontSize: 24,
      fill: COLORS.injuredDot,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 3 },
    }),
  });
  txt.anchor.set(0.5, 0.5);
  txt.x = x;
  txt.y = y;
  parent.addChild(txt);

  gsap.to(txt, {
    y: y - 60,
    alpha: 0,
    duration: 1,
    ease: 'power2.out',
    onComplete: () => {
      parent.removeChild(txt);
      txt.destroy();
    },
  });

  gsap.fromTo(txt.scale, { x: 1.5, y: 1.5 }, { x: 1, y: 1, duration: 0.2, ease: 'back.out' });
}

// ============================================================
// Screen Shake
// ============================================================

export function screenShake(target: Container, intensity = 4, duration = 0.3): void {
  const origX = target.x;
  const origY = target.y;

  gsap.to(target, {
    x: origX + intensity,
    duration: 0.03,
    repeat: Math.floor(duration / 0.06),
    yoyo: true,
    ease: 'none',
    onComplete: () => {
      target.x = origX;
      target.y = origY;
    },
    onUpdate: () => {
      target.x = origX + (Math.random() - 0.5) * intensity * 2;
      target.y = origY + (Math.random() - 0.5) * intensity * 2;
    },
  });
}

// ============================================================
// Screen Flash
// ============================================================

export function screenFlash(
  parent: Container,
  screenW: number,
  screenH: number,
  color = 0xffffff,
): void {
  const flash = new Graphics();
  flash.rect(0, 0, screenW, screenH);
  flash.fill({ color, alpha: 0.4 });
  parent.addChild(flash);

  gsap.to(flash, {
    alpha: 0,
    duration: 0.4,
    ease: 'power2.out',
    onComplete: () => {
      parent.removeChild(flash);
      flash.destroy();
    },
  });
}

// ============================================================
// Card Summon Animation — card flies from hand to kingdom
// ============================================================

export function animateCardSummon(
  card: Container,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Promise<void> {
  return new Promise((resolve) => {
    card.x = fromX;
    card.y = fromY;
    card.alpha = 0;
    card.scale.set(0.5);

    gsap.to(card, {
      x: toX,
      y: toY,
      alpha: 1,
      duration: 0.4,
      ease: 'power2.out',
      onComplete: resolve,
    });
    gsap.to(card.scale, {
      x: 1,
      y: 1,
      duration: 0.4,
      ease: 'back.out',
    });
  });
}

// ============================================================
// Card Destroy Animation — card dissolves
// ============================================================

export function animateCardDestroy(card: Container): Promise<void> {
  return new Promise((resolve) => {
    gsap.to(card, {
      alpha: 0,
      y: card.y + 20,
      duration: 0.4,
      ease: 'power2.in',
      onComplete: () => {
        card.destroy();
        resolve();
      },
    });
    gsap.to(card.scale, {
      x: 0.8,
      y: 0.8,
      duration: 0.4,
    });
  });
}

// ============================================================
// Attack Lunge Animation
// ============================================================

export function animateAttackLunge(
  card: Container,
  targetX: number,
  targetY: number,
): Promise<void> {
  return new Promise((resolve) => {
    const origX = card.x;
    const origY = card.y;

    const tl = gsap.timeline({ onComplete: resolve });

    tl.to(card, {
      x: targetX,
      y: targetY,
      duration: 0.2,
      ease: 'power2.in',
    })
    .to(card, {
      x: origX,
      y: origY,
      duration: 0.3,
      ease: 'power2.out',
    });
  });
}

// ============================================================
// Draw Card Animation — slides from deck
// ============================================================

export function animateDrawCard(
  card: Container,
  fromX: number,
  fromY: number,
): Promise<void> {
  return new Promise((resolve) => {
    const toX = card.x;
    const toY = card.y;
    card.x = fromX;
    card.y = fromY;
    card.alpha = 0;

    gsap.to(card, {
      x: toX,
      y: toY,
      alpha: 1,
      duration: 0.35,
      ease: 'power2.out',
      onComplete: resolve,
    });
  });
}

// ============================================================
// Particle Burst — hit/impact effect
// ============================================================

export function particleBurst(
  parent: Container,
  x: number,
  y: number,
  color = COLORS.accentGold,
  count = 12,
): void {
  for (let i = 0; i < count; i++) {
    const particle = new Graphics();
    const size = 2 + Math.random() * 3;
    particle.circle(0, 0, size);
    particle.fill({ color, alpha: 0.9 });
    particle.x = x;
    particle.y = y;
    parent.addChild(particle);

    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 30 + Math.random() * 40;

    gsap.to(particle, {
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      alpha: 0,
      duration: 0.4 + Math.random() * 0.3,
      ease: 'power2.out',
      onComplete: () => {
        parent.removeChild(particle);
        particle.destroy();
      },
    });

    gsap.to(particle.scale, {
      x: 0,
      y: 0,
      duration: 0.5 + Math.random() * 0.2,
    });
  }
}

// ============================================================
// Chain Notification — card art popup in center
// ============================================================

export function showChainNotification(
  parent: Container,
  text: string,
  screenW: number,
  screenH: number,
): void {
  const c = new Container();

  const bg = new Graphics();
  const w = 200;
  const h = 40;
  bg.roundRect(-w / 2, -h / 2, w, h, 8);
  bg.fill({ color: 0x1a1a2e, alpha: 0.9 });
  bg.stroke({ color: COLORS.accentGold, width: 1, alpha: 0.6 });
  c.addChild(bg);

  const txt = new Text({
    text,
    style: new TextStyle({
      fontSize: 12,
      fill: COLORS.accentGold,
      fontFamily: 'Arial, sans-serif',
      fontWeight: 'bold',
    }),
  });
  txt.anchor.set(0.5, 0.5);
  c.addChild(txt);

  c.x = screenW / 2;
  c.y = screenH / 2;
  c.alpha = 0;
  c.scale.set(0.8);
  parent.addChild(c);

  const tl = gsap.timeline({
    onComplete: () => {
      parent.removeChild(c);
      c.destroy();
    },
  });

  tl.to(c, { alpha: 1, duration: 0.15 })
    .to(c.scale, { x: 1, y: 1, duration: 0.15, ease: 'back.out' }, '<')
    .to(c, { duration: 0.5 })
    .to(c, { alpha: 0, y: c.y - 30, duration: 0.3 });
}
