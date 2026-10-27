function passwordPolicyError(password, settings) {
  const minimumLength = settings?.minimumPasswordLength || 8;
  if (typeof password !== "string" || password.length < minimumLength) {
    return `Password needs at least ${minimumLength} characters.`;
  }
  if (settings?.passwordRequiresLetterAndNumber !== false &&
      (!/[a-z]/i.test(password) || !/\d/.test(password))) {
    return "Password needs a letter and a number.";
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    return "Password must be 72 characters or fewer.";
  }
  return null;
}

module.exports = { passwordPolicyError };
