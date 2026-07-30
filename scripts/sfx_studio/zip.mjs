// Small deterministic ZIP32 writer. SFX assets are already compressed MP3s, so
// STORE keeps this zero-dependency and avoids spending CPU recompressing them.

const UTF8_FLAG = 0x0800;
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
const MAX_ZIP_BYTES = 256 * 1024 * 1024;

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function validateZipEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > 512) {
    throw new Error('ZIP entry name is invalid');
  }
  if (name.startsWith('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error(`unsafe ZIP entry name: ${name}`);
  }
  const parts = name.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`unsafe ZIP entry name: ${name}`);
  }
  return name;
}

function localHeader(name, bytes, checksum) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(bytes.length, 18);
  header.writeUInt32LE(bytes.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader(name, bytes, checksum, offset, mode) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(bytes.length, 20);
  header.writeUInt32LE(bytes.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

export function buildDeterministicZip(rawEntries) {
  if (!Array.isArray(rawEntries) || !rawEntries.length) throw new Error('ZIP has no entries');
  const seen = new Set();
  const entries = rawEntries
    .map((entry) => {
      const name = validateZipEntryName(entry?.name);
      if (seen.has(name)) throw new Error(`duplicate ZIP entry: ${name}`);
      seen.add(name);
      const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes ?? '');
      return { name, nameBytes: Buffer.from(name), bytes, mode: entry.mode ?? 0o100644 };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const body = [];
  const directory = [];
  let offset = 0;
  for (const entry of entries) {
    if (entry.nameBytes.length > 0xffff || entry.bytes.length > 0xffffffff) {
      throw new Error(`ZIP32 entry is too large: ${entry.name}`);
    }
    const checksum = crc32(entry.bytes);
    const local = localHeader(entry.nameBytes, entry.bytes, checksum);
    body.push(local, entry.nameBytes, entry.bytes);
    directory.push(
      centralHeader(entry.nameBytes, entry.bytes, checksum, offset, entry.mode),
      entry.nameBytes,
    );
    offset += local.length + entry.nameBytes.length + entry.bytes.length;
    if (offset > MAX_ZIP_BYTES) throw new Error('SFX export exceeds the ZIP size budget');
  }

  const directoryBytes = directory.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...body, ...directory, end]);
}
