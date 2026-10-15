export interface FooterProps {
  fps: number;
  soundOn: boolean;
  onSound(on: boolean): void;
}

export function Footer({ fps, soundOn, onSound }: FooterProps) {
  return (
    <footer class="foot">
      <label class="check">
        <input
          type="checkbox"
          checked={soundOn}
          onChange={(e) => onSound((e.currentTarget as HTMLInputElement).checked)}
        />{" "}
        Sound
      </label>
      <span>{Math.round(fps)} fps</span>
    </footer>
  );
}
