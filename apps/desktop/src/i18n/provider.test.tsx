// @vitest-environment jsdom

import { constantPolicy } from "@ccr/agent/testing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeError } from "../bridge/errors.ts";
import { Panel } from "../Panel.tsx";
import { ConnectionDialog } from "../panel/ConnectionDialog.tsx";
import { InputInspector } from "../panel/InputInspector.tsx";
import { buildPolicyChoices } from "../policies.ts";
import { Session } from "../session.ts";
import { initialLanguage, type LanguageEnvironment } from "./environment.ts";
import type { LanguagePreference } from "./locale.ts";
import { LanguageProvider, useI18n } from "./provider.tsx";

const sources = () => ({
  detect: vi.fn(async () => "pt-BR" as const),
  read: () => "system" as const,
  save: vi.fn(),
});
const dialogMethods = ["showModal", "close"] as const;
const originalDialogMethods = dialogMethods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
);
afterEach(() => {
  cleanup();
  dialogMethods.forEach((name, index) => {
    const descriptor = originalDialogMethods[index];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPanel(source: LanguageEnvironment) {
  const session = new Session({ now: () => 0 });
  session.setPolicy(
    constantPolicy("stay", {
      source: "executor",
      notice: { kind: "safe_wait" },
      note: "waiting where it is safe",
    }),
    6,
  );
  session.setPaused(true);
  const state = session.state();
  const props = {
    state,
    choices: buildPolicyChoices(null),
    selectedId: "lookahead",
    budget: { spent: 10000, limit: 10000, day: "2026-10-17" },
    credentials: { configured: false },
    onConfigure: vi.fn(),
    fps: 60,
    soundOn: false,
    autoRestart: false,
    bridgeKind: "http" as const,
    onSelect: vi.fn(),
    onTiming: vi.fn(),
    onSpeed: vi.fn(),
    onPause: vi.fn(() => session.togglePause()),
    onStep: vi.fn(),
    onRetry: vi.fn(),
    onNewMap: vi.fn(),
    onInspect: vi.fn(),
    theaterOpen: false,
    onTheater: vi.fn(),
    pace: "relaxed" as const,
    onPace: vi.fn(),
    onSeed: vi.fn((seed: number) => session.start(seed)),
    onSound: vi.fn(),
    onAutoRestart: vi.fn(),
  };
  const view = render(
    <LanguageProvider initial={{ preference: "system", detected: "pt-BR" }} source={source}>
      <Panel {...props} />
    </LanguageProvider>,
  );
  return { ...view, session, props };
}

describe("language changes in the app", () => {
  it("changes the complete panel without firing game controls or discarding an edit", async () => {
    const source = sources();
    const { container, getByLabelText, getByRole, session, props } = renderPanel(source);
    const settings = container.querySelector<HTMLDetailsElement>(".setup");
    if (settings) settings.open = true;
    const seed = getByLabelText("Semente do mapa") as HTMLInputElement;
    fireEvent.input(seed, { target: { value: "12345" } });
    const before = session.state();
    const select = getByLabelText("Idioma") as HTMLSelectElement;
    select.focus();
    fireEvent.change(select, { target: { value: "ja" } });
    await waitFor(() => expect(document.documentElement.lang).toBe("ja"));
    expect(getByRole("button", { name: /再開/ })).toBeTruthy();
    expect((getByLabelText("マップのシード値") as HTMLInputElement).value).toBe("12345");
    expect(settings?.open).toBe(true);
    expect(document.activeElement).toBe(select);
    expect(session.state()).toEqual(before);
    expect(source.save).toHaveBeenCalledWith("ja");
    for (const callback of [props.onSelect, props.onSeed, props.onPause, props.onTiming])
      expect(callback).not.toHaveBeenCalled();
    fireEvent(window, new Event("languagechange"));
    expect(source.detect).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "system" } });
    await waitFor(() => expect(document.documentElement.lang).toBe("pt-BR"));
    expect(source.detect).toHaveBeenCalledOnce();
  });

  it("keeps a late system lookup from overriding a manual choice", async () => {
    let finish = (_locale: "fr") => {};
    const source: LanguageEnvironment = {
      read: () => "system",
      save: vi.fn(),
      detect: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    };
    const { getByLabelText } = renderPanel(source);
    fireEvent(window, new Event("focus"));
    fireEvent.change(getByLabelText("Idioma"), { target: { value: "de" } });
    finish("fr");
    await waitFor(() => expect(document.documentElement.lang).toBe("de"));
  });

  it("restores the explicit preference before rendering", async () => {
    const source = { ...sources(), read: () => "fr" as LanguagePreference };
    expect(await initialLanguage(source)).toEqual({ preference: "fr", detected: "pt-BR" });
    expect(document.documentElement.lang).toBe("fr");
  });

  it("retranslates existing errors without submitting or clearing the credential form", async () => {
    const source = sources();
    const save = vi.fn(async () => {
      throw new BridgeError({
        code: "credentials_save",
        message: "Could not save local Cloudflare credentials.",
      });
    });
    const bridge = { saveCredentials: save };
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
    const Switch = () => {
      const { select } = useI18n();
      return (
        <button type="button" onClick={() => select("fr")}>
          switch
        </button>
      );
    };
    const { container, getByLabelText, getByText, getByRole } = render(
      <LanguageProvider initial={{ preference: "pt-BR", detected: "pt-BR" }} source={source}>
        <ConnectionDialog bridge={bridge} configured={false} onSaved={vi.fn()} onClose={vi.fn()} />
        <Switch />
      </LanguageProvider>,
    );
    fireEvent.input(getByLabelText(/ID da conta/), {
      target: { value: "abcdef0123456789abcdef0123456789" },
    });
    fireEvent.input(getByLabelText(/Token de API/), { target: { value: "local_test_token" } });
    fireEvent.click(getByText("Salvar credenciais"));
    await waitFor(() =>
      expect(getByRole("alert").textContent).toContain("Não foi possível salvar"),
    );
    fireEvent.click(getByText("switch"));
    await waitFor(() =>
      expect(getByRole("alert").textContent).toContain("Impossible d’enregistrer"),
    );
    expect((getByLabelText(/Jeton d’API/) as HTMLInputElement).value).toBe("local_test_token");
    expect(save).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')).not.toBeNull();
  });

  it("localizes the inspector while keeping the original request and copy payload in English", async () => {
    const sent = {
      model: "clef-flash" as const,
      state: { example: "original state" },
      questions: {
        move: {
          type: "choice" as const,
          instructions: "Keep this original instruction.",
          criteria: { stay: "Wait here." },
        },
      },
    };
    const copy = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    const { getByText, container } = render(
      <LanguageProvider initial={{ preference: "pt-BR", detected: "pt-BR" }} source={sources()}>
        <InputInspector
          policyId="clef:clef-flash:scene:route:lookup"
          onClose={vi.fn()}
          history={[
            {
              index: 0,
              tick: 0,
              row: 0,
              action: "stay",
              wallMs: 0,
              decision: { action: "stay", sent },
            },
          ]}
        />
      </LanguageProvider>,
    );
    fireEvent.click(getByText("Perguntas"));
    expect(container.querySelector('.inspector-pre[lang="en"]')?.textContent).toContain(
      sent.questions.move.instructions,
    );
    fireEvent.click(getByText("Copiar"));
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(JSON.parse(copy.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
      state: sent.state,
      questions: sent.questions,
    });
  });
});
