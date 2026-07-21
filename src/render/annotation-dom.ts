// Persisted annotation IDs are untrusted data. Keep selectors static and
// compare the dataset value exactly so hostile IDs never enter CSS syntax.
export function annotationElements<T extends Element>(
  root: ParentNode,
  staticSelector: string,
  annotationId: string,
): T[] {
  return Array.from(root.querySelectorAll<T>(staticSelector))
    .filter((element) => element.getAttribute("data-annotation-id") === annotationId);
}

export function annotationElement<T extends Element>(
  root: ParentNode,
  staticSelector: string,
  annotationId: string,
): T | null {
  return annotationElements<T>(root, staticSelector, annotationId)[0] ?? null;
}
