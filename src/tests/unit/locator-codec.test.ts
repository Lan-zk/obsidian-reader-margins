// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { encodeLocator, decodeLocator } from "src/domain/locator-codec";

function buildTextLayer(items: string[]) {
  const layer = document.createElement("div");
  layer.className = "textLayer";
  items.forEach((text, i) => {
    const span = document.createElement("span");
    span.className = "textLayerNode";
    span.dataset.idx = String(i);
    span.textContent = text;
    layer.appendChild(span);
  });
  return layer;
}

describe("locator codec", () => {
  it("encodes a range spanning two text items into a Locator", () => {
    const layer = buildTextLayer(["foo ", "bar ", "baz"]);
    const startNode = layer.childNodes[0]; const endNode = layer.childNodes[2];
    const loc = encodeLocator(startNode, 1, endNode, 2, layer);
    expect(loc).not.toBeNull();
    expect(loc!.beginIndex).toBe(0); expect(loc!.beginOffset).toBe(1);
    expect(loc!.endIndex).toBe(2); expect(loc!.endOffset).toBe(2);
  });
  it("decode reconstructs a range with the same text", () => {
    const layer = buildTextLayer(["foo ", "bar ", "baz"]);
    const loc = { beginIndex: 0, beginOffset: 1, endIndex: 2, endOffset: 2 };
    const range = decodeLocator(loc, layer);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("oo bar ba");
  });
  it("decode returns null when indices are out of range", () => {
    const layer = buildTextLayer(["foo"]);
    expect(decodeLocator({ beginIndex: 5, beginOffset: 0, endIndex: 6, endOffset: 0 }, layer)).toBeNull();
  });
  it("encode returns null when nodes are not textLayerNode children", () => {
    const layer = buildTextLayer(["foo"]);
    const outsider = document.createElement("span");
    expect(encodeLocator(outsider, 0, layer.childNodes[0] as Node, 1, layer)).toBeNull();
  });
});
