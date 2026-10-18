import { afterEach, expect, it, vi } from "vitest";
import { readPreference, savePreference } from "./i18n/locale.ts";
import { browserStore, readSetting, writeSetting } from "./storage.ts";

afterEach(() => vi.unstubAllGlobals());

it("keeps language selection usable when even accessing browser storage is forbidden", () => {
  const localStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  try {
    expect(browserStore()).toBeNull();
    expect(readPreference()).toBe("system");
    expect(() => savePreference(browserStore(), "ja")).not.toThrow();
  } finally {
    if (localStorage) Object.defineProperty(globalThis, "localStorage", localStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

it("stores only the explicit setting and tolerates failed reads and writes", () => {
  const store = {
    getItem: vi.fn(() => {
      throw new Error("blocked");
    }),
    setItem: vi.fn(() => {
      throw new Error("full");
    }),
  };
  expect(readSetting("ccr.locale", store)).toBeNull();
  expect(() => writeSetting("ccr.locale", "de", store)).not.toThrow();
  expect(store.setItem).toHaveBeenCalledExactlyOnceWith("ccr.locale", "de");
});
