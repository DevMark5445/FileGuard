const test = require("node:test");
const assert = require("node:assert/strict");
const { decryptSecret, encryptSecret } = require("../src/utils/encryptedSecret");

test("MFA secrets round-trip through authenticated encryption", () => {
  process.env.JWT_SECRET = "test-only-signing-key-that-is-at-least-32-characters";
  const encrypted = encryptSecret("JBSWY3DPEHPK3PXP");
  assert.notEqual(encrypted, "JBSWY3DPEHPK3PXP");
  assert.equal(decryptSecret(encrypted), "JBSWY3DPEHPK3PXP");
});

test("MFA secret ciphertext rejects tampering", () => {
  process.env.JWT_SECRET = "test-only-signing-key-that-is-at-least-32-characters";
  const encrypted = encryptSecret("JBSWY3DPEHPK3PXP");
  const [iv, tag, data] = encrypted.split(".");
  assert.throws(() => decryptSecret(`${iv}.${tag}.${data.slice(0, -2)}AA`));
});
