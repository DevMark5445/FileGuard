const test = require("node:test");
const assert = require("node:assert/strict");
const { passwordPolicyError } = require("../src/utils/passwordPolicy");

test("password policy enforces configured length and character classes", () => {
  const settings = { minimumPasswordLength: 12, passwordRequiresLetterAndNumber: true };
  assert.match(passwordPolicyError("Short1", settings), /12 characters/);
  assert.match(passwordPolicyError("LongEnoughButNoDigit", settings), /letter and a number/);
  assert.equal(passwordPolicyError("LongEnough123", settings), null);
});

test("password policy can disable the character-class requirement but caps bcrypt input", () => {
  const settings = { minimumPasswordLength: 8, passwordRequiresLetterAndNumber: false };
  assert.equal(passwordPolicyError("alllowercase", settings), null);
  assert.match(passwordPolicyError("a".repeat(73), settings), /72 characters/);
});
