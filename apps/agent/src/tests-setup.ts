/**
 * Test environment shims.
 *
 * The offline code needs three browser APIs and nothing else: IndexedDB for the
 * draft queue (supplied by `fake-indexeddb`), and Web Storage for the session.
 * A ~20-line Storage implementation is a fairer trade than a full DOM just to
 * get `localStorage`, and it keeps the tests honest about how small the browser
 * surface actually is.
 */

class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), writable: true });
