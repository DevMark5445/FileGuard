const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { scanImageContent } = require("../src/services/imageContentScanner");

test("image content scanner sends image bytes to Azure and returns flagged categories", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fileguard-image-scan-"));
  const imagePath = path.join(directory, "sample.png");
  await fs.writeFile(imagePath, Buffer.from("image-data"));
  const originalFetch = global.fetch;
  const previousEndpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
  const previousKey = process.env.AZURE_CONTENT_SAFETY_KEY;
  let request;
  process.env.AZURE_CONTENT_SAFETY_ENDPOINT = "https://example.test/";
  process.env.AZURE_CONTENT_SAFETY_KEY = "test-key";
  global.fetch = async (url, options) => {
    request = { url: url.toString(), options };
    return {
      ok: true,
      json: async () => ({
        categoriesAnalysis: [
          { category: "Hate", severity: 0 },
          { category: "SelfHarm", severity: 0 },
          { category: "Sexual", severity: 4 },
          { category: "Violence", severity: 0 },
        ],
      }),
    };
  };
  context.after(async () => {
    global.fetch = originalFetch;
    if (previousEndpoint === undefined) delete process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
    else process.env.AZURE_CONTENT_SAFETY_ENDPOINT = previousEndpoint;
    if (previousKey === undefined) delete process.env.AZURE_CONTENT_SAFETY_KEY;
    else process.env.AZURE_CONTENT_SAFETY_KEY = previousKey;
    await fs.rm(directory, { recursive: true, force: true });
  });

  const result = await scanImageContent(imagePath, "sample.png");
  assert.equal(result.status, "flagged");
  assert.deepEqual(result.categories, ["Sexual"]);
  assert.match(result.message, /Sexual \(severity 4\)/);
  assert.equal(request.url, "https://example.test/contentsafety/image:analyze?api-version=2024-09-01");
  assert.equal(request.options.headers["Ocp-Apim-Subscription-Key"], "test-key");
  assert.deepEqual(JSON.parse(request.options.body), {
    image: { content: Buffer.from("image-data").toString("base64") },
    categories: ["Hate", "SelfHarm", "Sexual", "Violence"],
    outputType: "FourSeverityLevels",
  });
});

test("image content scanner identifies non-images and reports missing service configuration", async (context) => {
  const previousEndpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
  const previousKey = process.env.AZURE_CONTENT_SAFETY_KEY;
  delete process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
  delete process.env.AZURE_CONTENT_SAFETY_KEY;
  context.after(() => {
    if (previousEndpoint === undefined) delete process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
    else process.env.AZURE_CONTENT_SAFETY_ENDPOINT = previousEndpoint;
    if (previousKey === undefined) delete process.env.AZURE_CONTENT_SAFETY_KEY;
    else process.env.AZURE_CONTENT_SAFETY_KEY = previousKey;
  });

  assert.equal((await scanImageContent("unused", "notes.txt")).status, "not_applicable");
  const result = await scanImageContent("unused", "picture.jpg");
  assert.equal(result.status, "unavailable");
  assert.match(result.message, /AZURE_CONTENT_SAFETY_ENDPOINT/);
});
