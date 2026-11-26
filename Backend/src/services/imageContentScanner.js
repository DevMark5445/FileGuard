const fs = require("node:fs/promises");
const path = require("node:path");

const IMAGE_EXTENSIONS = new Set([".bmp", ".gif", ".jpeg", ".jpg", ".png"]);
const CATEGORIES = ["Hate", "SelfHarm", "Sexual", "Violence"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const SCAN_TIMEOUT_MS = 30_000;

function unavailable(message) {
  return { status: "unavailable", message, categories: [] };
}

async function scanImageContent(filePath, fileName) {
  if (!IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase())) {
    return { status: "not_applicable", message: "Image content moderation does not apply to this file.", categories: [] };
  }

  const endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
  const key = process.env.AZURE_CONTENT_SAFETY_KEY;
  if (!endpoint || !key) {
    return unavailable("Image content moderation is not configured. Set AZURE_CONTENT_SAFETY_ENDPOINT and AZURE_CONTENT_SAFETY_KEY.");
  }

  let image;
  try {
    const file = await fs.open(filePath, "r");
    try {
      const { size } = await file.stat();
      if (size > MAX_IMAGE_BYTES) {
        return unavailable("Image content moderation supports files up to 4 MB; this image was not analyzed.");
      }
      image = await file.readFile();
    } finally {
      await file.close();
    }
  } catch (error) {
    console.error("Could not read uploaded image for content moderation:", error.message);
    return unavailable("The uploaded image could not be read for content moderation.");
  }

  let url;
  try {
    url = new URL(endpoint);
    if (url.protocol !== "https:") return unavailable("The Azure Content Safety endpoint must use HTTPS.");
    url.pathname = "/contentsafety/image:analyze";
    url.search = "?api-version=2024-09-01";
  } catch {
    return unavailable("The Azure Content Safety endpoint is invalid.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": key,
      },
      body: JSON.stringify({
        image: { content: image.toString("base64") },
        categories: CATEGORIES,
        outputType: "FourSeverityLevels",
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`Azure Content Safety image scan returned HTTP ${response.status}.`);
      return unavailable(`Azure Content Safety could not analyze this image (HTTP ${response.status}).`);
    }

    const result = await response.json();
    if (!Array.isArray(result.categoriesAnalysis) ||
        result.categoriesAnalysis.length !== CATEGORIES.length ||
        new Set(result.categoriesAnalysis.map((item) => item.category)).size !== CATEGORIES.length ||
        result.categoriesAnalysis.some((item) =>
          !CATEGORIES.includes(item.category) || ![0, 2, 4, 6].includes(item.severity))) {
      console.error("Azure Content Safety returned an invalid image analysis response.");
      return unavailable("Azure Content Safety returned an invalid image analysis result.");
    }

    const findings = result.categoriesAnalysis.filter((item) => item.severity > 0);
    if (findings.length) {
      const categories = findings.map((item) => item.category);
      const descriptions = findings.map((item) => `${item.category} (severity ${item.severity})`);
      return {
        status: "flagged",
        message: `Potentially harmful image content detected: ${descriptions.join(", ")}.`,
        categories,
      };
    }
    return { status: "clean", message: "No selected harmful image content was detected.", categories: [] };
  } catch (error) {
    console.error("Azure Content Safety image scan failed:", error.message);
    return unavailable(error.name === "AbortError"
      ? "Azure Content Safety image scan timed out."
      : "Azure Content Safety image scan could not be completed.");
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { scanImageContent };
