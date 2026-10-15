import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Bridge, CredentialStatus } from "../bridge/types.ts";

export interface ConnectionDialogProps {
  bridge: Bridge;
  configured: boolean;
  onSaved(status: CredentialStatus): void;
  onClose(): void;
}

/** A write-only form: saved credentials are never fetched or prefilled. */
export function ConnectionDialog({ bridge, configured, onSaved, onClose }: ConnectionDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
          aria-label="Close Cloudflare settings"
        >
          ×
        </button>
      </header>
      <p id="connection-description" class="hint">
        {configured
          ? "Credentials are already configured. Enter both values to replace them."
          : "Connect your Cloudflare account to use Clef."}
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving) return;
          setSaving(true);
          setError("");
          try {
            const status = await bridge.saveCredentials({
              accountId: accountId.trim(),
              apiToken: apiToken.trim(),
            });
            setAccountId("");
            setApiToken("");
            onSaved(status);
          } catch (reason) {
            setError(
              typeof reason === "string"
                ? reason
                : reason instanceof Error
                  ? reason.message
                  : "Could not save credentials. Try again.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <label class="field-label" for="cloudflare-account">
          Account ID <code>CF_ACCOUNT_ID</code>
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
          placeholder="32-character account ID"
          disabled={saving}
        />
        <label class="field-label" for="cloudflare-token">
          API token <code>CF_API_TOKEN</code>
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
          placeholder="Token with Workers AI permission"
          disabled={saving}
        />
        <p class="hint">Saved locally on this computer. Saved values are never displayed here.</p>
        <p class="hint">Saving does not call the API. The game stays paused until you resume it.</p>
        {error && (
          <p class="connection-error" role="alert">
            {error}
          </p>
        )}
        <div class="connection-actions">
          <button type="button" class="btn" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" disabled={saving}>
            {saving ? "Saving…" : "Save credentials"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
