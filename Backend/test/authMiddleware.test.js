const test = require("node:test");
const assert = require("node:assert/strict");
const { requireRole } = require("../src/middleware/auth");

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("requireRole rejects a regular user from admin-only actions", () => {
  const response = createResponse();
  let nextCalled = false;

  requireRole("superadmin")(
    { user: { role: "user" } },
    response,
    () => { nextCalled = true; }
  );

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.message, "You do not have permission to perform this action.");
  assert.equal(nextCalled, false);
});

test("requireRole allows the configured role", () => {
  const response = createResponse();
  let nextCalled = false;

  requireRole("superadmin")(
    { user: { role: "superadmin" } },
    response,
    () => { nextCalled = true; }
  );

  assert.equal(response.statusCode, null);
  assert.equal(nextCalled, true);
});
