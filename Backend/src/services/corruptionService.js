const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { XMLValidator } = require("fast-xml-parser");

const MAX_ARCHIVE_ENTRIES = 5000;
const MAX_EXPANDED_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_FILE_STRUCTURE_BYTES = 100 * 1024 * 1024;
const MAX_PNG_DECODE_BYTES = 64 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".txt", ".pdf", ".docx", ".xlsx", ".jpg", ".jpeg", ".png", ".zip"]);
const CRC_TABLE = new Uint32Array(256);

for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function invalid(message) {
  return { status: "invalid", message };
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 22 - 65535);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 &&
        offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) {
      return offset;
    }
  }
  return -1;
}

function validateZip(buffer, extension) {
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0 || buffer.readUInt16LE(endOffset + 4) !== 0 ||
      buffer.readUInt16LE(endOffset + 6) !== 0) {
    return invalid("The ZIP directory is missing or spans multiple disks.");
  }

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const directorySize = buffer.readUInt32LE(endOffset + 12);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount > MAX_ARCHIVE_ENTRIES ||
      directoryOffset + directorySize !== endOffset ||
      directoryOffset > buffer.length) {
    return invalid("The ZIP directory is incomplete or exceeds validation limits.");
  }

  const entries = new Map();
  let cursor = directoryOffset;
  let expandedSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > endOffset || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      return invalid("The ZIP directory contains an invalid entry.");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > endOffset || flags & 1) {
      return invalid("The ZIP contains a truncated or encrypted entry.");
    }

    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (!name || entries.has(name)) return invalid("The ZIP contains an empty or duplicate entry name.");
    if (method !== 0 && method !== 8) {
      return { status: "unavailable", message: "This ZIP compression method cannot be validated." };
    }
    if (localOffset + 30 > directoryOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50 ||
        buffer.readUInt16LE(localOffset + 6) !== flags ||
        buffer.readUInt16LE(localOffset + 8) !== method) {
      return invalid("A ZIP entry has an invalid local header.");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > directoryOffset ||
        buffer.toString("utf8", localOffset + 30, localOffset + 30 + localNameLength) !== name) {
      return invalid("A ZIP entry is incomplete or has mismatched metadata.");
    }

    if (uncompressedSize > MAX_EXPANDED_ARCHIVE_BYTES - expandedSize) {
      return invalid("The ZIP expands beyond the safe validation limit.");
    }

    let content;
    try {
      const compressed = buffer.subarray(dataStart, dataEnd);
      content = method === 0
        ? Buffer.from(compressed)
        : zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(uncompressedSize, 1) });
    } catch {
      return invalid("A ZIP entry cannot be decompressed.");
    }
    if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) {
      return invalid("A ZIP entry failed its size or checksum validation.");
    }
    expandedSize += content.length;
    entries.set(name, content);
    cursor = entryEnd;
  }

  if (cursor !== directoryOffset + directorySize) return invalid("The ZIP directory is incomplete.");
  if (extension === ".docx" || extension === ".xlsx") {
    const requiredParts = extension === ".docx"
      ? ["[Content_Types].xml", "word/document.xml"]
      : ["[Content_Types].xml", "xl/workbook.xml"];
    for (const part of requiredParts) {
      if (!entries.has(part)) return invalid(`The ${extension.slice(1).toUpperCase()} package is missing ${part}.`);
      const xml = entries.get(part).toString("utf8");
      if (XMLValidator.validate(xml) !== true) return invalid(`The package part ${part} is not valid XML.`);
    }
    const contentTypes = entries.get("[Content_Types].xml").toString("utf8");
    const mainDocument = entries.get(requiredParts[1]).toString("utf8");
    if (!/<(?:[\w.-]+:)?Types(?:\s|>)/.test(contentTypes) ||
        !new RegExp(`<(?:(?:[\\w.-]+):)?${extension === ".docx" ? "document" : "workbook"}(?:\\s|>)`).test(mainDocument)) {
      return invalid(`The ${extension.slice(1).toUpperCase()} package has an invalid document structure.`);
    }
  }
  return { status: "valid", message: "The ZIP structure and entry checksums are valid." };
}

function validatePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature)) {
    return invalid("The PNG header or image data is incomplete.");
  }

  let offset = 8;
  let hasHeader = false;
  let hasImageData = false;
  let imageHeader;
  let paletteLength = 0;
  const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) return invalid("The PNG contains a truncated chunk.");
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const chunkData = buffer.subarray(dataStart, dataEnd);
    if (crc32(buffer.subarray(offset + 4, dataEnd)) !== buffer.readUInt32BE(dataEnd)) {
      return invalid("A PNG chunk failed its checksum validation.");
    }
    if (!hasHeader) {
      if (type !== "IHDR" || length !== 13) return invalid("The PNG header chunk is invalid.");
      imageHeader = {
        width: chunkData.readUInt32BE(0),
        height: chunkData.readUInt32BE(4),
        bitDepth: chunkData[8],
        colorType: chunkData[9],
        compression: chunkData[10],
        filter: chunkData[11],
        interlace: chunkData[12],
      };
      if (!imageHeader.width || !imageHeader.height ||
          imageHeader.compression !== 0 || imageHeader.filter !== 0 ||
          imageHeader.interlace > 1) {
        return invalid("The PNG image header is invalid.");
      }
      hasHeader = true;
    }
    if (type === "PLTE") paletteLength = length;
    if (type === "IDAT") {
      hasImageData = true;
      imageData.push(chunkData);
    }
    offset = dataEnd + 4;
    if (type === "IEND") {
      if (length !== 0 || !hasImageData || offset !== buffer.length) {
        return invalid("The PNG end marker or image data is invalid.");
      }
      if (imageHeader.interlace !== 0) {
        return { status: "unavailable", message: "Interlaced PNG decoding is not available." };
      }
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[imageHeader.colorType];
      const validDepths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      }[imageHeader.colorType];
      if (!channels || !validDepths.includes(imageHeader.bitDepth) ||
          (imageHeader.colorType === 3 && (!paletteLength || paletteLength > 768 || paletteLength % 3))) {
        return invalid("The PNG color type, bit depth, or palette is invalid.");
      }
      const rowBytes = Math.ceil(imageHeader.width * channels * imageHeader.bitDepth / 8);
      const decodedSize = imageHeader.height * (rowBytes + 1);
      if (!Number.isSafeInteger(decodedSize) || decodedSize > MAX_PNG_DECODE_BYTES) {
        return { status: "unavailable", message: "The PNG exceeds the safe image decoding limit." };
      }
      let decoded;
      try {
        decoded = zlib.inflateSync(Buffer.concat(imageData), { maxOutputLength: decodedSize + 1 });
      } catch {
        return invalid("The PNG image data cannot be decompressed.");
      }
      if (decoded.length !== decodedSize) return invalid("The PNG decompressed image size is invalid.");
      for (let row = 0; row < imageHeader.height; row += 1) {
        if (decoded[row * (rowBytes + 1)] > 4) return invalid("The PNG contains an invalid row filter.");
      }
      return { status: "valid", message: "The PNG chunks and checksums are valid." };
    }
  }
  return invalid("The PNG is missing a complete end marker.");
}

function validateJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 ||
      buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
    return invalid("The JPEG start or end marker is missing.");
  }
  let offset = 2;
  let hasFrame = false;
  while (offset < buffer.length - 2) {
    if (buffer[offset] !== 0xff) return invalid("The JPEG marker sequence is invalid.");
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xda) {
      if (!hasFrame) return invalid("The JPEG has no image frame.");
      if (offset + 2 > buffer.length) return invalid("The JPEG scan header is incomplete.");
      const length = buffer.readUInt16BE(offset);
      if (length < 6 || offset + length >= buffer.length - 2) {
        return invalid("The JPEG scan data is incomplete.");
      }
      return { status: "valid", message: "The JPEG marker structure is valid." };
    }
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return invalid("The JPEG segment is incomplete.");
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return invalid("A JPEG segment has an invalid length.");
    if ((marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)) hasFrame = true;
    offset += length;
  }
  return invalid("The JPEG image data is incomplete.");
}

async function validateFileStructure(filePath, fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return { status: "unsupported", message: "Structural validation is not available for this file type." };
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return invalid("The uploaded file could not be read.");
    throw error;
  }
  if (stat.size === 0) return invalid("The file is empty.");
  if (stat.size > MAX_FILE_STRUCTURE_BYTES) {
    return { status: "unavailable", message: "The file exceeds the safe structural validation limit." };
  }
  const buffer = await fs.readFile(filePath);

  if (extension === ".txt") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (buffer.includes(0)) return invalid("The text file contains invalid binary data.");
      return { status: "valid", message: "The UTF-8 text file can be read." };
    } catch {
      return invalid("The text file is not valid UTF-8.");
    }
  }
  if (extension === ".pdf") {
    const prefix = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("latin1");
    const suffix = buffer.subarray(Math.max(0, buffer.length - 2048)).toString("latin1");
    if (!/%PDF-\d\.\d/.test(prefix) || !/%%EOF\s*$/.test(suffix) ||
        !/\/Type\s*\/Catalog\b/.test(buffer.toString("latin1"))) {
      return invalid("The PDF header, document catalog, or end marker is invalid.");
    }
    return { status: "valid", message: "The PDF header and document markers are valid." };
  }
  if (extension === ".png") return validatePng(buffer);
  if (extension === ".jpg" || extension === ".jpeg") return validateJpeg(buffer);
  return validateZip(buffer, extension);
}

module.exports = { validateFileStructure };
