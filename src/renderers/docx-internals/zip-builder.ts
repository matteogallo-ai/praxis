/**
 * Minimal ZIP writer (PKZIP / APPNOTE.TXT subset) for the DOCX
 * renderer. Uses `node:zlib` (built into Bun) for DEFLATE and no
 * external dep.
 *
 * We support exactly two storage modes:
 *   - stored (compression method 0)
 *   - deflated (compression method 8)
 *
 * Everything else (encryption, spanning, ZIP64) is out of scope —
 * DOCX packages are always well under 4 GiB, always single-file,
 * always unencrypted for our use.
 *
 * Structure of a written archive:
 *
 *   Local file header + file data       (one per entry)
 *   ...
 *   Central directory header            (one per entry)
 *   ...
 *   End of central directory record     (once, at the tail)
 *
 * All numeric fields are little-endian, per the spec.
 */

import { deflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Path inside the archive, forward-slash separated. */
  path: string;
  /** File payload. */
  data: Buffer;
  /**
   * Optional storage mode. Default: "deflate". "stored" is useful for
   * short XML files where DEFLATE can grow them; the caller decides.
   */
  method?: "stored" | "deflate";
}

const SIG_LOCAL_FILE_HEADER = 0x04034b50;
const SIG_CENTRAL_DIRECTORY = 0x02014b50;
const SIG_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const VERSION_NEEDED = 20; // 2.0
const GP_BIT_FLAG = 0x0800; // language encoding flag — filename is UTF-8

// A stable DOS-format timestamp so archives are byte-reproducible
// across runs. Real dates change the SHA of every output; that noise
// is not useful.
const DOS_DATE = dosDate(2026, 8, 18);
const DOS_TIME = dosTime(12, 0, 0);

/**
 * Build a ZIP archive from the given entries. Returns a Buffer
 * containing the full archive.
 */
export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? "deflate";
    const uncompressed = entry.data;
    const crc32 = computeCrc32(uncompressed);
    const compressed =
      method === "stored" ? uncompressed : deflateRawSync(uncompressed);
    const compressionMethod = method === "stored" ? 0 : 8;

    const nameBuf = Buffer.from(entry.path, "utf-8");

    // Local file header (30 bytes fixed + filename).
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(SIG_LOCAL_FILE_HEADER, 0);
    localHeader.writeUInt16LE(VERSION_NEEDED, 4);
    localHeader.writeUInt16LE(GP_BIT_FLAG, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    const localOffset = offset;
    localChunks.push(localHeader, nameBuf, compressed);
    offset += localHeader.length + nameBuf.length + compressed.length;

    // Central directory header (46 bytes fixed + filename).
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(SIG_CENTRAL_DIRECTORY, 0);
    centralHeader.writeUInt16LE(VERSION_NEEDED, 4); // version made by
    centralHeader.writeUInt16LE(VERSION_NEEDED, 6); // version needed
    centralHeader.writeUInt16LE(GP_BIT_FLAG, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc32, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(localOffset, 42);

    centralChunks.push(centralHeader, nameBuf);
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralChunks);
  const centralSize = centralBuf.length;
  offset += centralSize;

  // End of central directory record.
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_END_OF_CENTRAL_DIRECTORY, 0);
  eocd.writeUInt16LE(0, 4); // this disk number
  eocd.writeUInt16LE(0, 6); // disk of central start
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // ZIP file comment length

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

// ---------------------------------------------------------------------------
// CRC32 (IEEE 802.3 polynomial 0xEDB88320)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC32 (little-endian output). Used by both local + central headers. */
export function computeCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]!;
    crc = (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// DOS date/time (MS-DOS packed formats used by the ZIP spec)
// ---------------------------------------------------------------------------

function dosDate(year: number, month: number, day: number): number {
  return (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
}

function dosTime(hours: number, minutes: number, seconds: number): number {
  return (
    ((hours & 0x1f) << 11) |
    ((minutes & 0x3f) << 5) |
    ((seconds >>> 1) & 0x1f)
  );
}
