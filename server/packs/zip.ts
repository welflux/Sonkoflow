// Bounded ZIP (stored WebP entries). No filesystem extraction or user filenames.
const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Buffer) {
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function imageZip(files: { name: string; bytes: Buffer }[]): Buffer {
  if (
    files.length < 1 ||
    files.length > 5 ||
    new Set(files.map((f) => f.name)).size !== files.length
  )
    throw new Error("archive_limit");
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0,
    total = 0;
  for (const f of files) {
    if (
      !/^[a-z0-9][a-z0-9._-]{0,120}\.webp$/.test(f.name) ||
      f.name.includes("..") ||
      f.bytes.length > 10 * 1024 * 1024 ||
      !f.bytes.length
    )
      throw new Error("archive_entry");
    total += f.bytes.length;
    if (total > 50 * 1024 * 1024) throw new Error("archive_limit");
    const name = Buffer.from(f.name),
      crc = crc32(f.bytes),
      header = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(f.bytes.length, 18);
    header.writeUInt32LE(f.bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(f.bytes.length, 20);
    directory.writeUInt32LE(f.bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, f.bytes);
    central.push(directory, name);
    offset += header.length + name.length + f.bytes.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
