// Minimal uncompressed (STORE) zip writer. JPEGs don't compress further, so this is all the dataset export needs.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export type ZipEntry = { name: string; data: Uint8Array }

export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder()
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBytes = encoder.encode(name)
    const crc = crc32(data)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true) // local file header signature
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true) // compressed size
    local.setUint32(22, data.length, true) // uncompressed size
    local.setUint16(26, nameBytes.length, true)
    parts.push(local.buffer, nameBytes as BlobPart, data as BlobPart)

    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true) // central directory signature
    dir.setUint16(4, 20, true) // version made by
    dir.setUint16(6, 20, true) // version needed
    dir.setUint16(8, 0x0800, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, data.length, true)
    dir.setUint32(24, data.length, true)
    dir.setUint16(28, nameBytes.length, true)
    dir.setUint32(42, offset, true) // local header offset
    central.push(new Uint8Array(dir.buffer), nameBytes)

    offset += 30 + nameBytes.length + data.length
  }

  const centralSize = central.reduce((n, b) => n + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true) // end of central directory signature
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  return new Blob([...parts, ...(central as BlobPart[]), end.buffer], { type: 'application/zip' })
}
