import type { CredentialInput } from "./types.ts";

export type CredentialIssue = "account_invalid" | "token_invalid";

export function credentialIssue({ accountId, apiToken }: CredentialInput): CredentialIssue | null {
  if (!/^[a-fA-F0-9]{32}$/.test(accountId.trim())) return "account_invalid";
  const token = apiToken.trim();
  return !token || token.length > 4096 || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)
    ? "token_invalid"
    : null;
}
