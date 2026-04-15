// ============================================================
// Primal TCG — Narration Voice (ElevenLabs TTS)
// ============================================================
// Client-side singleton that fetches TTS audio from /api/tts
// and plays it via HTML5 Audio. Caches by text to avoid
// duplicate API calls.

export class NarrationVoice {
  private enabled = true;
  private audioCache = new Map<string, Blob>();
  private currentAudio: HTMLAudioElement | null = null;
  private queue: string[] = [];
  private isSpeaking = false;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  speak(text: string): void {
    if (!this.enabled) return;
    this.queue.push(text);
    if (!this.isSpeaking) {
      this.playNext();
    }
  }

  stop(): void {
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    this.isSpeaking = false;
  }

  private async playNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isSpeaking = false;
      return;
    }

    this.isSpeaking = true;
    const text = this.queue.shift()!;

    try {
      const blob = await this.fetchAudio(text);
      if (!this.enabled) {
        this.isSpeaking = false;
        return;
      }

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;

      await new Promise<void>((resolve) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          this.currentAudio = null;
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          this.currentAudio = null;
          resolve();
        };
        audio.play().catch(() => {
          URL.revokeObjectURL(url);
          this.currentAudio = null;
          resolve();
        });
      });
    } catch {
      // Graceful degradation — text narration still shows
    }

    this.playNext();
  }

  private async fetchAudio(text: string): Promise<Blob> {
    const cached = this.audioCache.get(text);
    if (cached) return cached;

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      throw new Error(`TTS API error: ${res.status}`);
    }

    const blob = await res.blob();
    this.audioCache.set(text, blob);
    return blob;
  }
}
