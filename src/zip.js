import fs from 'node:fs';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf, prev = 0) {
  let c = prev ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function dosDateTime(date) {
  const d = new Date(date || Date.now());
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const day = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, day };
}

function localHeader(name, { useDataDescriptor, crc, compSize, rawSize, date }) {
  const { time, day } = dosDateTime(date);
  const nameBuf = Buffer.from(name, 'utf8');
  const buf = Buffer.alloc(30 + nameBuf.length);
  buf.writeUInt32LE(0x04034b50, 0);
  buf.writeUInt16LE(useDataDescriptor ? 20 : 20, 4);
  buf.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
  buf.writeUInt16LE(0, 8); // stored
  buf.writeUInt16LE(time, 10);
  buf.writeUInt16LE(day, 12);
  buf.writeUInt32LE(useDataDescriptor ? 0 : crc, 14);
  buf.writeUInt32LE(useDataDescriptor ? 0 : compSize, 18);
  buf.writeUInt32LE(useDataDescriptor ? 0 : rawSize, 22);
  buf.writeUInt16LE(nameBuf.length, 26);
  buf.writeUInt16LE(0, 28);
  nameBuf.copy(buf, 30);
  return buf;
}

function dataDescriptor(crc, compSize, rawSize) {
  const buf = Buffer.alloc(16);
  buf.writeUInt32LE(0x08074b50, 0);
  buf.writeUInt32LE(crc, 4);
  buf.writeUInt32LE(compSize, 8);
  buf.writeUInt32LE(rawSize, 12);
  return buf;
}

function centralHeader(name, { crc, compSize, rawSize, offset, date }) {
  const { time, day } = dosDateTime(date);
  const nameBuf = Buffer.from(name, 'utf8');
  const buf = Buffer.alloc(46 + nameBuf.length);
  buf.writeUInt32LE(0x02014b50, 0);
  buf.writeUInt16LE(20, 4);
  buf.writeUInt16LE(20, 6);
  buf.writeUInt16LE(0x0800, 8);
  buf.writeUInt16LE(0, 10); // stored
  buf.writeUInt16LE(time, 12);
  buf.writeUInt16LE(day, 14);
  buf.writeUInt32LE(crc, 16);
  buf.writeUInt32LE(compSize, 20);
  buf.writeUInt32LE(rawSize, 24);
  buf.writeUInt16LE(nameBuf.length, 28);
  buf.writeUInt16LE(0, 30);
  buf.writeUInt16LE(0, 32);
  buf.writeUInt16LE(0, 34);
  buf.writeUInt16LE(0, 36);
  buf.writeUInt32LE(0, 38);
  buf.writeUInt32LE(offset, 42);
  nameBuf.copy(buf, 46);
  return buf;
}

function endOfCentral({ count, centralSize, centralOffset }) {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(0x06054b50, 0);
  buf.writeUInt16LE(0, 4);
  buf.writeUInt16LE(0, 6);
  buf.writeUInt16LE(count, 8);
  buf.writeUInt16LE(count, 10);
  buf.writeUInt32LE(centralSize, 12);
  buf.writeUInt32LE(centralOffset, 16);
  buf.writeUInt16LE(0, 20);
  return buf;
}

/** Stream a ZIP of `entries` ({ abs, name, mtime }); nothing is buffered in memory. */
export async function streamZip(res, entries, opts = {}) {
  res.writeHead(200, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${encodeURIComponent(opts.name || 'files.zip')}"; filename*=UTF-8''${encodeURIComponent(opts.name || 'files.zip')}`,
    'cache-control': 'no-store',
  });

  let offset = 0;
  const central = [];
  let aborted = false;
  res.on('close', () => { aborted = true; });

  for (const entry of entries) {
    if (aborted) return;
    const entryOffset = offset;
    const header = localHeader(entry.name, { useDataDescriptor: true, date: entry.mtime });
    res.write(header);
    offset += header.length;

    let crc = 0;
    let written = 0;
    const stream = fs.createReadStream(entry.abs, { highWaterMark: 512 * 1024 });
    for await (const chunk of stream) {
      if (aborted) { stream.destroy(); return; }
      crc = crc32(chunk, crc);
      written += chunk.length;
      res.write(chunk);
    }
    offset += written;
    const desc = dataDescriptor(crc, written, written);
    res.write(desc);
    offset += desc.length;

    central.push(centralHeader(entry.name, {
      crc, compSize: written, rawSize: written, offset: entryOffset, date: entry.mtime,
    }));
  }

  const centralBuf = Buffer.concat(central);
  res.write(centralBuf);
  res.write(endOfCentral({ count: central.length, centralSize: centralBuf.length, centralOffset: offset }));
  res.end();
}
