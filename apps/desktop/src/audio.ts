import type { DeathCause } from "@ccr/core";

/**
 * Sound effects from the original game. Browsers only allow audio after a user gesture, so
 * nothing is loaded until `unlock()` runs from a key press or click.
 */
const HOPS = Array.from({ length: 12 }, (_, i) => `/assets/audio/buck${i + 1}.wav`);
const CAR = ["/assets/audio/carhit.mp3", "/assets/audio/carsquish3.wav"];
const DIE = ["/assets/audio/chickendeath.wav", "/assets/audio/chickendeath2.wav"];
const WATER = ["/assets/audio/watersplashlow.mp3"];
const TRAIN = ["/assets/audio/trainsplat.wav"];

export class Sounds {
  enabled = true;
  private unlocked = false;
  private hopIndex = 0;
  private readonly cache = new Map<string, HTMLAudioElement>();

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    for (const url of [...HOPS.slice(0, 3), ...CAR, ...DIE, ...WATER, ...TRAIN]) this.element(url);
  }

  private element(url: string): HTMLAudioElement {
    let el = this.cache.get(url);
    if (!el) {
      el = new Audio(url);
      el.preload = "auto";
      el.volume = 0.5;
      this.cache.set(url, el);
    }
    return el;
  }

  private play(url: string | undefined): void {
    if (!this.enabled || !this.unlocked || !url) return;
    const el = this.element(url).cloneNode(true) as HTMLAudioElement;
    el.volume = 0.5;
    void el.play().catch(() => {});
  }

  hop(): void {
    this.play(HOPS[this.hopIndex]);
    this.hopIndex = (this.hopIndex + 1) % HOPS.length;
  }

  death(cause: DeathCause | null): void {
    const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
    if (cause === "car") this.play(pick(CAR));
    else if (cause === "water") this.play(pick(WATER));
    else if (cause === "train") this.play(pick(TRAIN));
    this.play(pick(DIE));
  }
}
