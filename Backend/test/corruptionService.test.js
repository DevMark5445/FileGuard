const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { validateFileStructure } = require("../src/services/corruptionService");

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(value);
    const compressed = zlib.deflateRawSync(data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBuffer);
    localOffset += local.length + nameBuffer.length + compressed.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, end]);
}

function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([header, typeAndData, checksum]);
}

test("structural validation detects empty, unreadable, and unsupported files", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fileguard-structure-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const emptyPath = path.join(directory, "empty.txt");
  await fs.writeFile(emptyPath, "");
  const result = await validateFileStructure(emptyPath, "empty.txt");
  assert.equal(result.status, "invalid");
  assert.equal(result.message, "The file is empty.");
  assert.equal((await validateFileStructure(emptyPath, "archive.unknown")).status, "unsupported");
});

test("text and PDF checks reject invalid encodings and incomplete document markers", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fileguard-structure-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const textPath = path.join(directory, "notes.txt");
  await fs.writeFile(textPath, Buffer.from([0xc3, 0x28]));
  assert.equal((await validateFileStructure(textPath, "notes.txt")).status, "invalid");

  const pdfPath = path.join(directory, "document.pdf");
  await fs.writeFile(pdfPath, "%PDF-1.7\n%%EOF");
  assert.equal((await validateFileStructure(pdfPath, "document.pdf")).status, "invalid");
  await fs.writeFile(pdfPath, "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
  assert.equal((await validateFileStructure(pdfPath, "document.pdf")).status, "valid");
});

test("ZIP integrity and DOCX required XML parts are checked", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fileguard-structure-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));

  const zipPath = path.join(directory, "archive.zip");
  await fs.writeFile(zipPath, createZip({ "notes.txt": "valid archive" }));
  assert.equal((await validateFileStructure(zipPath, "archive.zip")).status, "valid");

  const docxPath = path.join(directory, "document.docx");
  await fs.writeFile(docxPath, createZip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types></Types>',
    "word/document.xml": '<?xml version="1.0"?><w:document></w:document>',
  }));
  assert.equal((await validateFileStructure(docxPath, "document.docx")).status, "valid");

  await fs.writeFile(docxPath, createZip({
    "[Content_Types].xml": "<Types>",
    "word/document.xml": "<w:document/>",
  }));
  assert.equal((await validateFileStructure(docxPath, "document.docx")).status, "invalid");

  const xlsxPath = path.join(directory, "workbook.xlsx");
  await fs.writeFile(xlsxPath, createZip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types></Types>',
    "xl/workbook.xml": '<?xml version="1.0"?><workbook></workbook>',
  }));
  assert.equal((await validateFileStructure(xlsxPath, "workbook.xlsx")).status, "valid");

  const brokenZip = createZip({ "notes.txt": "payload" });
  brokenZip[40] ^= 0xff;
  await fs.writeFile(zipPath, brokenZip);
  assert.equal((await validateFileStructure(zipPath, "archive.zip")).status, "invalid");
});

test("PNG chunks and JPEG markers are structurally checked", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fileguard-images-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));

  const pngPath = path.join(directory, "image.png");
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const imageData = zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  await fs.writeFile(pngPath, Buffer.concat([
    pngSignature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", imageData),
    pngChunk("IEND", Buffer.alloc(0)),
  ]));
  assert.equal((await validateFileStructure(pngPath, "image.png")).status, "valid");

  const jpegPath = path.join(directory, "image.jpg");
  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 8, 0, 1, 0, 1, 1, 1, 0x11, 0,
    0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0,
    0, 0xff, 0xd9,
  ]);
  await fs.writeFile(jpegPath, jpeg);
  assert.equal((await validateFileStructure(jpegPath, "image.jpg")).status, "valid");
  await fs.writeFile(jpegPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  assert.equal((await validateFileStructure(jpegPath, "image.jpg")).status, "invalid");
});
