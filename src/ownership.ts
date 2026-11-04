interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface Reservation {
  key: string;
  owner: string;
  pane: string;
}
const RELEASED = "hermes.multi-chat.released.";
/** Atomic IndexedDB reservations work on LAN HTTP. No time-based stealing: a
 * throttled/frozen tab must not lose its terminal to a duplicate. pagehide's
 * synchronous release proof allows refresh even if its IDB cleanup is aborted. */
export class Ownership {
  private database: Promise<IDBDatabase>;
  constructor(
    factory: IDBFactory,
    private storage: StorageLike,
    readonly owner: string,
  ) {
    storage.setItem(RELEASED + owner, "active");
    this.database = new Promise((resolve, reject) => {
      const request = factory.open("hermes-multi-chat-ownership-v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("owners", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(
            "Multi Chat requires browser IndexedDB for safe pane ownership.",
          ),
        );
      request.onblocked = () =>
        reject(
          new Error("Close older Multi Chat tabs to unlock browser storage."),
        );
    });
  }
  async claim(keys: string[], pane: string): Promise<Reservation | null> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const tx = database.transaction("owners", "readwrite"),
        store = tx.objectStore("owners");
      let conflict: Reservation | null = null;
      const records: Reservation[] = [];
      for (const key of keys) {
        const request = store.get(key);
        request.onsuccess = () => {
          const old = request.result as Reservation | undefined;
          if (
            old &&
            !(old.owner === this.owner && old.pane === pane) &&
            this.storage.getItem(RELEASED + old.owner) !== "released"
          )
            conflict = old;
          records.push({ key, owner: this.owner, pane });
          if (records.length === keys.length && !conflict)
            for (const record of records) store.put(record);
        };
      }
      tx.oncomplete = () => resolve(conflict);
      tx.onerror = () =>
        reject(
          new Error(
            "Browser ownership storage failed; no terminal was attached.",
          ),
        );
      tx.onabort = () =>
        reject(new Error("Browser ownership transaction aborted."));
    });
  }
  async release(keys: string[], pane: string): Promise<void> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const tx = database.transaction("owners", "readwrite"),
        store = tx.objectStore("owners");
      for (const key of keys) {
        const request = store.get(key);
        request.onsuccess = () => {
          const old = request.result as Reservation | undefined;
          if (old?.owner === this.owner && old.pane === pane) store.delete(key);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(new Error("Could not release the browser reservation."));
    });
  }
  releaseDocument(): void {
    this.storage.setItem(RELEASED + this.owner, "released");
  }
  /** Only after an explicit, interruption-warning confirmation, never on timeout. */
  async recover(keys: string[]): Promise<void> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const tx = database.transaction("owners", "readwrite");
      for (const key of keys) tx.objectStore("owners").delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error("Recovery failed."));
    });
  }
}
