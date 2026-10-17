import { locale } from "@tauri-apps/plugin-os";
import { afterEach, expect, it, vi } from "vitest";
import { systemLocale } from "./locale.ts";

vi.mock("@tauri-apps/plugin-os", () => ({ locale: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("uses the native system locale rather than the webview's browser locale", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" });
  vi.mocked(locale).mockResolvedValue("ja-JP");
  expect(await systemLocale()).toBe("ja");
  expect(locale).toHaveBeenCalledOnce();
});

it("falls back to English if the native locale is unavailable or unsupported", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.mocked(locale).mockRejectedValueOnce(new Error("unavailable"));
  expect(await systemLocale()).toBe("en");
  vi.mocked(locale).mockResolvedValueOnce(null);
  expect(await systemLocale()).toBe("en");
  vi.mocked(locale).mockResolvedValueOnce("zh-TW");
  expect(await systemLocale()).toBe("en");
});

it("uses the browser's primary language in development and English for unsupported languages", async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { languages: ["es-MX", "en"], language: "es-MX" });
  expect(await systemLocale()).toBe("es");
  vi.stubGlobal("navigator", { languages: ["ru-RU", "pt-BR"], language: "ru-RU" });
  expect(await systemLocale()).toBe("en");
  expect(locale).not.toHaveBeenCalled();
});
