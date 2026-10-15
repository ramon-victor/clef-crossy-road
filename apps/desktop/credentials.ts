import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import type { CredentialInput, CredentialStatus } from "./src/bridge/types.ts";

export class CredentialValidationError extends Error {}

type CredentialSnapshot = { accountId: string | undefined; apiToken: string | undefined };

/** Keep complete dotenv assignments together, including quoted multiline values. */
function updateEnv(original: string, accountId: string, apiToken: string): string {
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const replacements = new Map([
    ["CF_ACCOUNT_ID", accountId],
    ["CF_API_TOKEN", apiToken],
  ]);
  const written = new Set<string>();
  const lines = original.split(/\r?\n/);
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const assignment = /^\uFEFF?\s*(?:export\s+)?([\w]+)\s*=(.*)$/.exec(line);
    const key = assignment?.[1] ?? "";
    const value = (assignment?.[2] ?? "").trimStart();
    const block = [line];
    const quote = value[0];
    if (quote && "\"'`".includes(quote)) {
      let tail = value.slice(1);
      while (true) {
        let closed = false;
        for (let j = 0; j < tail.length; j++) {
          if (tail[j] === quote) {
            closed = true;
            break;
          }
        }
        if (closed) break;
        if (++i >= lines.length) throw new Error("Unclosed dotenv value");
        tail = lines[i] ?? "";
        block.push(tail);
      }
    }
    const replacement = replacements.get(key);
    if (replacement === undefined) output.push(...block);
    else if (!written.has(key)) {
      output.push(`${key}=${replacement}`);
      written.add(key);
    }
  }
  while (output.at(-1) === "") output.pop();
  for (const [key, value] of replacements) {
    if (!written.has(key)) output.push(`${key}=${value}`);
  }
  return output.join(newline) + newline;
}

/** Backend only. Saved values are never returned by the status endpoint. */
export class CredentialsStore {
  private readonly path: string;
  private values: CredentialSnapshot;

  constructor(root: string, environment: NodeJS.ProcessEnv = process.env) {
    this.path = join(root, ".env");
    let saved: ReturnType<typeof parseEnv> = {};
    try {
      if (existsSync(this.path)) saved = parseEnv(readFileSync(this.path, "utf8"));
    } catch {
      // Keep the UI available so a read/write problem can be reported by the settings form.
    }
    this.values = {
      accountId: (saved.CF_ACCOUNT_ID ?? environment.CF_ACCOUNT_ID)?.trim().toLowerCase(),
      apiToken: (saved.CF_API_TOKEN ?? environment.CF_API_TOKEN)?.trim(),
    };
  }

  status(): CredentialStatus {
    return { configured: Boolean(this.values.accountId && this.values.apiToken) };
  }

  /** A coherent snapshot for one request, including its account's spend ledger. */
  current(): CredentialSnapshot {
    return { ...this.values };
  }

  save(input: unknown): CredentialStatus {
    const value = input as Partial<CredentialInput> | null;
    const accountId =
      typeof value?.accountId === "string" ? value.accountId.trim().toLowerCase() : "";
    const apiToken = typeof value?.apiToken === "string" ? value.apiToken.trim() : "";
    if (!/^[a-f0-9]{32}$/.test(accountId)) {
      throw new CredentialValidationError("Account ID must contain 32 hexadecimal characters.");
    }
    if (!apiToken || apiToken.length > 4096 || !/^[A-Za-z0-9._~+/-]+=*$/.test(apiToken)) {
      throw new CredentialValidationError("Enter the API token itself, without Bearer or spaces.");
    }
    const original = existsSync(this.path) ? readFileSync(this.path, "utf8") : "";
    const contents = updateEnv(original, accountId, apiToken);
    const temporary = `${this.path}.ccr-${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 });
      renameSync(temporary, this.path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    this.values = { accountId, apiToken };
    return this.status();
  }
}
