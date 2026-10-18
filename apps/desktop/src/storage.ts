export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function browserStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readSetting(
  key: string,
  store: Pick<KeyValueStore, "getItem"> | null = browserStore(),
): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeSetting(
  key: string,
  value: string,
  store: Pick<KeyValueStore, "setItem"> | null = browserStore(),
): void {
  try {
    store?.setItem(key, value);
  } catch {}
}
