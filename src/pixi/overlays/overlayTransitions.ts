// ============================================================
// Overlay Transition Helpers
// ============================================================
// Shared fade-in / fade-out helpers for overlays so open/close
// animations are consistent across the app.
// ============================================================

import gsap from 'gsap';
import type { Container } from 'pixi.js';
import { TIMING } from '../timing';

/**
 * Fade an overlay container in from alpha 0.
 * Call from the overlay's constructor after children are added.
 */
export function fadeInOverlay(container: Container, duration: number = TIMING.overlayFadeIn): void {
  container.alpha = 0;
  gsap.to(container, {
    alpha: 1,
    duration,
    ease: 'power2.out',
  });
}

/**
 * Fade an overlay out, then call onComplete (typically .destroy()).
 * The container stays in the display list until onComplete runs so
 * input doesn't immediately "leak through" the fading overlay.
 */
export function fadeOutOverlay(
  container: Container,
  onComplete?: () => void,
  duration: number = TIMING.overlayFadeOut,
): void {
  // Immediately block further input
  (container as Container & { eventMode?: string }).eventMode = 'none';
  gsap.to(container, {
    alpha: 0,
    duration,
    ease: 'power2.in',
    onComplete: () => {
      try { onComplete?.(); } catch { /* swallow — don't crash renderer */ }
    },
  });
}

/**
 * Scale + fade pop-in — for small menus (e.g., CardActionMenuOverlay).
 * `pivotX` / `pivotY` are the scale origin relative to the container.
 */
export function popInOverlay(
  container: Container,
  pivotX: number,
  pivotY: number,
  duration: number = TIMING.overlayFadeIn,
): void {
  container.alpha = 0;
  container.scale.set(0.9);
  container.pivot.set(pivotX, pivotY);
  container.x += pivotX;
  container.y += pivotY;
  gsap.to(container, { alpha: 1, duration, ease: 'power2.out' });
  gsap.to(container.scale, { x: 1, y: 1, duration, ease: 'back.out(2)' });
}
