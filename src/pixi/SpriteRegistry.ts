// ============================================================
// Primal TCG — Sprite Registry
// ============================================================
// Persistent card sprite management. Prevents recreating sprites
// every frame, enabling movement animations between zones.

import { CardSprite, CardSpriteOptions } from './CardSprite';

export class SpriteRegistry {
  private sprites = new Map<string, CardSprite>();
  private activeIds = new Set<string>();

  /**
   * Returns existing sprite or creates new one.
   * Caller should update options on returned sprite if needed.
   */
  getOrCreate(instanceId: string, options: CardSpriteOptions): CardSprite {
    let sprite = this.sprites.get(instanceId);
    if (!sprite) {
      sprite = new CardSprite(options);
      sprite.instanceId = instanceId;
      this.sprites.set(instanceId, sprite);
    }
    this.activeIds.add(instanceId);
    return sprite;
  }

  /** Mark a sprite as active this frame (still visible on board). */
  markActive(instanceId: string): void {
    this.activeIds.add(instanceId);
  }

  /** Get sprite by instanceId (or undefined if not tracked). */
  get(instanceId: string): CardSprite | undefined {
    return this.sprites.get(instanceId);
  }

  /** Get current position of a sprite for animation origin tracking. */
  getSpritePosition(instanceId: string): { x: number; y: number } | null {
    const sprite = this.sprites.get(instanceId);
    if (!sprite) return null;
    return { x: sprite.x, y: sprite.y };
  }

  /**
   * Returns sprites no longer visible. Caller decides whether to
   * pool or destroy them. Clears the active set for next frame.
   */
  sweepInactive(): CardSprite[] {
    const inactive: CardSprite[] = [];
    for (const [id, sprite] of this.sprites) {
      if (!this.activeIds.has(id)) {
        inactive.push(sprite);
        this.sprites.delete(id);
      }
    }
    this.activeIds.clear();
    return inactive;
  }

  /** Total tracked sprites. */
  get size(): number {
    return this.sprites.size;
  }

  /** Clear all tracked sprites. */
  clear(): void {
    this.sprites.clear();
    this.activeIds.clear();
  }
}
