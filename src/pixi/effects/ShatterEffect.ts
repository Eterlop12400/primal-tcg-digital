// ============================================================
// Primal TCG — Card Destruction Shatter Effect
// ============================================================
// Splits a card-sized area into grid fragments that fly outward
// with random velocity/rotation, falling with gravity.

import { Container, Graphics } from 'pixi.js';
import gsap from 'gsap';
import { COLORS } from '../layout';

/**
 * Create a shatter effect at the given position.
 * Simulates a card breaking into fragments.
 */
export function shatterEffect(
  parent: Container,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number = COLORS.injuredDot,
): Promise<void> {
  return new Promise((resolve) => {
    const cols = 4;
    const rows = 6;
    const fragW = width / cols;
    const fragH = height / rows;
    const fragments: Graphics[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const frag = new Graphics();
        frag.rect(0, 0, fragW - 1, fragH - 1);
        frag.fill({ color, alpha: 0.8 });

        frag.x = x + c * fragW;
        frag.y = y + r * fragH;
        frag.pivot.set(fragW / 2, fragH / 2);

        parent.addChild(frag);
        fragments.push(frag);

        // Random velocity direction (outward from center)
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const dx = frag.x - centerX;
        const dy = frag.y - centerY;
        const angle = Math.atan2(dy, dx);
        const speed = 80 + Math.random() * 120;

        const targetX = frag.x + Math.cos(angle) * speed;
        const targetY = frag.y + Math.sin(angle) * speed + 60 + Math.random() * 40; // gravity

        gsap.to(frag, {
          x: targetX,
          y: targetY,
          rotation: (Math.random() - 0.5) * Math.PI * 3,
          alpha: 0,
          duration: 0.5 + Math.random() * 0.2,
          ease: 'power2.out',
          onComplete: () => {
            parent.removeChild(frag);
            frag.destroy();
          },
        });

        gsap.to(frag.scale, {
          x: 0.3 + Math.random() * 0.3,
          y: 0.3 + Math.random() * 0.3,
          duration: 0.5,
        });
      }
    }

    // Resolve after all fragments have animated
    setTimeout(() => {
      resolve();
    }, 700);
  });
}
