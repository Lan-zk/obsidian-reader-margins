import { describe, it, expect } from "vitest";
import { signatureMismatch } from "src/host/source-signature";

describe("source signature", () => {
  it("matches when fingerprint and numPages equal", () => {
    expect(signatureMismatch({ pdfFingerprint: "fp", numPages: 3 }, { pdfFingerprint: "fp", numPages: 3 })).toBe(false);
  });
  it("mismatches on different fingerprint", () => {
    expect(signatureMismatch({ pdfFingerprint: "fp", numPages: 3 }, { pdfFingerprint: "other", numPages: 3 })).toBe(true);
  });
  it("mismatches on different numPages", () => {
    expect(signatureMismatch({ pdfFingerprint: "fp", numPages: 3 }, { pdfFingerprint: "fp", numPages: 4 })).toBe(true);
  });
});
