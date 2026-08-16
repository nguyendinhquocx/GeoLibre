/**
 * DOM helpers for plugin panels, which are built by hand: this package is framework-agnostic and
 * cannot render with React.
 */

/** Creates an element, optionally with its text content set. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
