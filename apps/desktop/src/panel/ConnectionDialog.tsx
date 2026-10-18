import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { credentialIssue } from "../bridge/credentials.ts";
import { type ErrorInfo, errorInfo } from "../bridge/errors.ts";
import type { Bridge, CredentialStatus } from "../bridge/types.ts";
import { useI18n } from "../i18n/provider.tsx";
import { ErrorMessage } from "./ErrorMessage.tsx";

export interface ConnectionDialogProps {
  bridge: Pick<Bridge, "saveCredentials">;
  configured: boolean;
  onSaved(status: CredentialStatus): void;
  onClose(): void;
}

/** A write-only form: saved credentials are never fetched or prefilled. */
export function ConnectionDialog({ bridge, configured, onSaved, onClose }: ConnectionDialogProps) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      class="connection-dialog"
      aria-labelledby="connection-title"
      aria-describedby="connection-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <header class="info-head">
        <h2 id="connection-title">Cloudflare</h2>
        <button
          type="button"
          class="info-button"
          onClick={onClose}
          disabled={saving}
          aria-label={t("connection.close")}
        >
          ×
        </button>
      </header>
      <p id="connection-description" class="hint">
        {configured ? t("connection.replace") : t("connection.connect")}
      </p>
      <form
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving) return;
          const issue = credentialIssue({ accountId, apiToken });
          if (issue) {
            setError({ code: issue, detail: "" });
            return;
          }
          setSaving(true);
          setError(null);
          try {
            const status = await bridge.saveCredentials({
              accountId: accountId.trim(),
              apiToken: apiToken.trim(),
            });
            setAccountId("");
            setApiToken("");
            onSaved(status);
          } catch (reason) {
            setError(errorInfo(reason));
          } finally {
            setSaving(false);
          }
        }}
      >
        <label class="field-label" for="cloudflare-account">
          {t("connection.account")} <code>CF_ACCOUNT_ID</code>
        </label>
        <input
          id="cloudflare-account"
          class="input"
          value={accountId}
          onInput={(event) => setAccountId(event.currentTarget.value)}
          autoComplete="off"
          spellcheck={false}
          required
          pattern="[a-fA-F0-9]{32}"
          maxLength={32}
          placeholder={t("connection.accountPlaceholder")}
          disabled={saving}
        />
        <label class="field-label" for="cloudflare-token">
          {t("connection.token")} <code>CF_API_TOKEN</code>
        </label>
        <input
          id="cloudflare-token"
          class="input"
          type="password"
          value={apiToken}
          onInput={(event) => setApiToken(event.currentTarget.value)}
          autoComplete="off"
          spellcheck={false}
          required
          maxLength={4096}
          placeholder={t("connection.tokenPlaceholder")}
          disabled={saving}
        />
        <p class="hint">{t("connection.local")}</p>
        <p class="hint">{t("connection.noCall")}</p>
        {error && (
          <div class="connection-error">
            <ErrorMessage info={error} />
          </div>
        )}
        <div class="connection-actions">
          <button type="button" class="btn" disabled={saving} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn primary" disabled={saving}>
            {t(saving ? "connection.saving" : "connection.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
