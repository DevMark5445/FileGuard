const test = require("node:test");
const assert = require("node:assert/strict");
const { archiveActivity, listActivity } = require("../src/controllers/adminController");

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

test("activity archiving rejects invalid, future, and unexpected cutoff input", async () => {
  const invalidBodies = [
    { before: "not-a-date" },
    { before: new Date(Date.now() + 60_000).toISOString() },
    { before: new Date(Date.now() - 60_000).toISOString(), delete: true },
  ];

  for (const body of invalidBodies) {
    const response = createResponse();
    await archiveActivity({ body }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 400);
  }
});

test("activity listing validates the archive filter", async () => {
  const response = createResponse();
  await listActivity({ query: { archived: "yes" } }, response, (error) => { throw error; });
  assert.equal(response.statusCode, 400);
});
