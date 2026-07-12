// src/session/disposable-scope.ts
export interface Disposable {
  dispose(): void;
}

export class DisposableScope implements Disposable {
  private items: Disposable[] = [];
  private disposed = false;

  get size(): number {
    return this.items.length;
  }

  add(d: Disposable): void {
    if (this.disposed) { this.safeDispose(d); return; }
    this.items.push(d);
  }

  addDispose(fn: () => void): void {
    this.add({ dispose: fn });
  }

  dispose(): void {
    this.disposeAll();
  }

  disposeAll(): void {
    if (this.disposed) return;
    this.disposed = true;
    const items = this.items;
    this.items = [];
    for (let i = items.length - 1; i >= 0; i--) {
      this.safeDispose(items[i]);
    }
  }

  private safeDispose(d: Disposable): void {
    try { d.dispose(); } catch (err) {
      // A failing disposer must not block siblings (spec §7.7).
      console.error("reader-margins: disposer threw", err);
    }
  }
}
