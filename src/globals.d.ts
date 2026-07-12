// loadPdfJs is an Obsidian-provided global (not in the obsidian typings package).
// Design-asserted; verify it resolves at runtime in Task 8 (M-1 smoke gate).
export {};
declare global {
  function loadPdfJs(): Promise<unknown>;
}
