const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../src/app");

test("health endpoint reports API readiness without exposing configuration", async (context) => {
  const server = app.listen(0, "127.0.0.1");
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("file and management routes require bearer authentication", async (context) => {
  const server = app.listen(0, "127.0.0.1");
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const [files, admin] = await Promise.all([
    fetch(`${base}/files`),
    fetch(`${base}/admin/users`),
  ]);
  assert.equal(files.status, 401);
  assert.equal(admin.status, 401);
});
