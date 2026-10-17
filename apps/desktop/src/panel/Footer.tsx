import { useI18n } from "../i18n/provider.tsx";

export interface FooterProps {
  fps: number;
  soundOn: boolean;
  onSound(on: boolean): void;
}

export function Footer({ fps, soundOn, onSound }: FooterProps) {
  const { t } = useI18n();
  return (
    <footer class="foot">
      <label class="check">
        <input
          type="checkbox"
          checked={soundOn}
          onChange={(e) => onSound((e.currentTarget as HTMLInputElement).checked)}
        />{" "}
        {t("footer.sound")}
      </label>
      <span>{t("footer.fps", { count: Math.round(fps) })}</span>
    </footer>
  );
}
