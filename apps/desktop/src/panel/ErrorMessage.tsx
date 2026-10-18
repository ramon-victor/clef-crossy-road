import type { ErrorInfo } from "../bridge/errors.ts";
import { useI18n } from "../i18n/provider.tsx";

export function ErrorMessage({ info }: { info: ErrorInfo }) {
  const { t } = useI18n();
  return (
    <>
      <p role="alert">{t(`error.${info.code}`)}</p>
      {info.detail && (
        <details class="technical-details">
          <summary>{t("common.details")}</summary>
          <p lang="en" dir="ltr">
            {info.detail}
          </p>
        </details>
      )}
    </>
  );
}
