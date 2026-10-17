import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { accountTag } from "@ccr/clef";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialsStore } from "../credentials.ts";
import { devBridge } from "../dev-bridge.ts";

const ACCOUNT_A = "abcdef0123456789abcdef0123456789";
const ACCOUNT_B = "0123456789abcdef0123456789abcdef";
const TOKEN_A = "test_token_A_local_only";
const TOKEN_B = "test_token_B_local_only";
const roots: string[] = [];
const servers: ViteDevServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}ccr-credentials-`))
      throw new Error("Unexpected test path");
    rmSync(root, { recursive: true, force: true });
  }
});

function temporary() {
  const root = mkdtempSync(join(tmpdir(), "ccr-credentials-"));
  roots.push(root);
  return root;
}

async function runtime(root: string, fetchImpl?: typeof fetch) {
  const server = await createServer({
    configFile: false,
    root,
    publicDir: false,
    logLevel: "silent",
    plugins: [devBridge({ root, environment: {}, ...(fetchImpl ? { fetchImpl } : {}) })],
    server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
  });
  servers.push(server);
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    get: (path: string) => fetch(`${base}/__ccr${path}`),
    post: (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}/__ccr${path}`, {
        method: "POST",
        headers: { origin: base, "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
  };
}

describe("local credential storage", () => {
  it("preserves other settings and CRLF, replaces duplicates, and gives saved values precedence", () => {
    const root = temporary();
    writeFileSync(
      join(root, ".env"),
      "# local\r\nOTHER=keep\r\nexport CF_ACCOUNT_ID=old\r\nCF_API_TOKEN=old\r\nCF_API_TOKEN=duplicate\r\n",
    );
    const store = new CredentialsStore(root, {});
    expect(
      store.save({ accountId: ` ${ACCOUNT_A.toUpperCase()} `, apiToken: ` ${TOKEN_A} ` }),
    ).toEqual({ configured: true });
    const text = readFileSync(join(root, ".env"), "utf8");
    expect(text).toBe(
      `# local\r\nOTHER=keep\r\nCF_ACCOUNT_ID=${ACCOUNT_A}\r\nCF_API_TOKEN=${TOKEN_A}\r\n`,
    );
    expect(readdirSync(root)).toEqual([".env"]);
    const reloaded = new CredentialsStore(root, {
      CF_ACCOUNT_ID: ACCOUNT_B,
      CF_API_TOKEN: TOKEN_B,
    });
    expect(reloaded.current()).toEqual({ accountId: ACCOUNT_A, apiToken: TOKEN_A });
    expect(JSON.stringify(reloaded.status())).toBe('{"configured":true}');
  });

  it("rejects malformed or injectable values without changing the active pair or file", () => {
    const root = temporary();
    const store = new CredentialsStore(root, {});
    store.save({ accountId: ACCOUNT_A, apiToken: TOKEN_A });
    const before = readFileSync(join(root, ".env"), "utf8");
    for (const input of [
      null,
      {},
      { accountId: "invalid", apiToken: TOKEN_B },
      { accountId: ACCOUNT_B, apiToken: "Bearer do-not-echo-this" },
      { accountId: ACCOUNT_B, apiToken: "secret\nOTHER=injected" },
      { accountId: ACCOUNT_B, apiToken: "'quoted'" },
      { accountId: ACCOUNT_B, apiToken: "x".repeat(4097) },
    ]) {
      expect(() => store.save(input)).toThrow();
      expect(readFileSync(join(root, ".env"), "utf8")).toBe(before);
      expect(store.current()).toEqual({ accountId: ACCOUNT_A, apiToken: TOKEN_A });
    }
  });

  it("preserves quoted multiline settings and replaces complete credential assignments in place", () => {
    const root = temporary();
    const notes = "NOTES=\"keep\nCF_API_TOKEN=example\nlast line\"\nFOLDER='C:\\path\\'\n";
    writeFileSync(
      join(root, ".env"),
      `${notes}CF_ACCOUNT_ID=old\nCOPY=\${CF_ACCOUNT_ID}\nCF_API_TOKEN="old\ncontinued"\nOTHER=keep\n`,
    );
    new CredentialsStore(root, {}).save({ accountId: ACCOUNT_A, apiToken: TOKEN_A });
    expect(readFileSync(join(root, ".env"), "utf8")).toBe(
      `${notes}CF_ACCOUNT_ID=${ACCOUNT_A}\nCOPY=\${CF_ACCOUNT_ID}\nCF_API_TOKEN=${TOKEN_A}\nOTHER=keep\n`,
    );
    expect(new CredentialsStore(root, {}).current()).toEqual({
      accountId: ACCOUNT_A,
      apiToken: TOKEN_A,
    });
  });

  it("leaves an unterminated multiline file untouched instead of appending inside its value", () => {
    const root = temporary();
    const original = 'NOTES="unfinished\nOTHER=keep\n';
    writeFileSync(join(root, ".env"), original);
    const store = new CredentialsStore(root, {});
    expect(() => store.save({ accountId: ACCOUNT_A, apiToken: TOKEN_A })).toThrow();
    expect(readFileSync(join(root, ".env"), "utf8")).toBe(original);
  });

  it("only activates a new pair after persistence succeeds and keeps old snapshots independent", () => {
    const root = temporary();
    const store = new CredentialsStore(root, { CF_ACCOUNT_ID: ACCOUNT_A, CF_API_TOKEN: TOKEN_A });
    const original = store.current();
    mkdirSync(join(root, ".env"));
    expect(() => store.save({ accountId: ACCOUNT_B, apiToken: TOKEN_B })).toThrow();
    expect(store.current()).toEqual(original);
    rmdirSync(join(root, ".env"));
    store.save({ accountId: ACCOUNT_B, apiToken: TOKEN_B });
    expect(store.current()).toEqual({ accountId: ACCOUNT_B, apiToken: TOKEN_B });
    expect(original).toEqual({ accountId: ACCOUNT_A, apiToken: TOKEN_A });
  });
});

describe("development credential bridge", () => {
  it("reports storage failures without exposing paths or the submitted credentials", async () => {
    const root = temporary();
    const app = await runtime(root);
    mkdirSync(join(root, ".env"));
    const response = await app.post("/credentials", { accountId: ACCOUNT_A, apiToken: TOKEN_A });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "credentials_save", message: "Could not save local Cloudflare credentials." },
    });
    expect(await (await app.get("/credentials")).json()).toEqual({ configured: false });
  });

  it("saves without an API call and only returns status; cross-origin and invalid requests cannot change it", async () => {
    const root = temporary();
    let calls = 0;
    const app = await runtime(root, async () => {
      calls++;
      throw new Error("No API call expected");
    });
    expect(await (await app.get("/credentials")).json()).toEqual({ configured: false });
    const saved = await app.post("/credentials", { accountId: ACCOUNT_A, apiToken: TOKEN_A });
    expect(saved.headers.get("cache-control")).toBe("no-store");
    expect(await saved.json()).toEqual({ configured: true });
    const before = readFileSync(join(root, ".env"), "utf8");
    for (const headers of [
      { origin: "https://other.invalid" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      expect(
        (await app.post("/credentials", { accountId: ACCOUNT_B, apiToken: TOKEN_B }, headers))
          .status,
      ).toBe(403);
    }
    const invalid = await app.post("/credentials", {
      accountId: ACCOUNT_B,
      apiToken: "Bearer do-not-echo-this",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("do-not-echo-this");
    expect(readFileSync(join(root, ".env"), "utf8")).toBe(before);
    expect(calls).toBe(0);
  });

  it("switches the account's budget without resetting previous spending or bypassing the ceiling", async () => {
    const root = temporary();
    mkdirSync(join(root, "runs/cache"), { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    writeFileSync(
      join(root, "runs/cache/spend.ndjson"),
      `${JSON.stringify({ day, account: accountTag(ACCOUNT_A), neurons: 10000 })}\n`,
    );
    let calls = 0;
    const app = await runtime(root, async () => {
      calls++;
      throw new Error("No API call expected");
    });
    await app.post("/credentials", { accountId: ACCOUNT_A, apiToken: TOKEN_A });
    expect((await (await app.get("/budget")).json()).spent).toBe(10000);
    expect((await app.post("/run", { model: "clef-flash", body: {} })).status).toBe(429);
    await app.post("/credentials", { accountId: ACCOUNT_B, apiToken: TOKEN_B });
    expect((await (await app.get("/budget")).json()).spent).toBe(0);
    await app.post("/credentials", { accountId: ACCOUNT_A.toUpperCase(), apiToken: TOKEN_A });
    expect((await (await app.get("/budget")).json()).spent).toBe(10000);
    expect(calls).toBe(0);
  });

  it("charges an in-flight response to its original account after credentials change", async () => {
    const root = temporary();
    let release = () => {};
    let started = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const headers: string[] = [];
    const app = await runtime(root, async (_url, init) => {
      headers.push(new Headers(init?.headers).get("Authorization") ?? "");
      if (headers.length === 1) {
        started();
        await pending;
      }
      return new Response(JSON.stringify({ result: { usage: { input_tokens: 100 } } }), {
        status: 200,
      });
    });
    await app.post("/credentials", { accountId: ACCOUNT_A, apiToken: TOKEN_A });
    const first = app.post("/run", { model: "clef-flash", body: {} });
    await requestStarted;
    await app.post("/credentials", { accountId: ACCOUNT_B, apiToken: TOKEN_B });
    release();
    expect((await first).status).toBe(200);
    expect((await (await app.get("/budget")).json()).spent).toBe(0);
    expect((await app.post("/run", { model: "clef-flash", body: {} })).status).toBe(200);
    const entries = readFileSync(join(root, "runs/cache/spend.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(entries.map((entry) => entry.account)).toEqual([
      accountTag(ACCOUNT_A),
      accountTag(ACCOUNT_B),
    ]);
    expect(headers).toEqual([`Bearer ${TOKEN_A}`, `Bearer ${TOKEN_B}`]);
    expect((await (await app.get("/budget")).json()).spent).toBeGreaterThan(0);
  });
});
