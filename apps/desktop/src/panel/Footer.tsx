export interface FooterProps {
  fps: number;
  soundOn: boolean;
  autoRestart: boolean;
  bridgeKind: "tauri" | "http";
  onSound(on: boolean): void;
  onAutoRestart(on: boolean): void;
}

export function Footer({
  fps,
  soundOn,
  autoRestart,
  bridgeKind,
  onSound,
  onAutoRestart,
}: FooterProps) {
  return (
    <footer class="foot">
      <label class="check">
        <input
          type="checkbox"
          checked={soundOn}
          onChange={(e) => onSound((e.currentTarget as HTMLInputElement).checked)}
        />{" "}
        sound
      </label>
      <label class="check" title="Only for free players; model players never restart by themselves">
        <input
          type="checkbox"
          checked={autoRestart}
          onChange={(e) => onAutoRestart((e.currentTarget as HTMLInputElement).checked)}
        />{" "}
        auto-restart (free players)
      </label>
      <span>{Math.round(fps)} fps</span>
      <span>{bridgeKind === "tauri" ? "desktop" : "browser dev"}</span>
      <span class="keys">←↑→↓ move · space pause · N step · R retry · M new map</span>
    </footer>
  );
}
