import { unzipSync } from 'fflate';
import SevenZip from '7z-wasm';
// @ts-ignore - Vite ?url asset import for the 7zz.wasm binary
import sevenZipWasmUrl from '7z-wasm/7zz.wasm?url';

export type SegaSystemKind = 'MEGA_DRIVE' | 'MASTER_SYSTEM' | 'GAME_GEAR' | 'SG_1000';

export interface ExtractedRomEntry {
  id: string;
  fileName: string;
  fullPath: string;
  extension: string;
  system: SegaSystemKind;
  sizeBytes: number;
  data: Uint8Array;
}

const VALID_ROM_EXTENSIONS = new Set([
  'md',
  'bin',
  'gen',
  'smd',
  'sms',
  'gg',
  'sg',
  'rom',
]);

export function detectSegaSystem(fileName: string, data?: Uint8Array): SegaSystemKind {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'sms') return 'MASTER_SYSTEM';
  if (ext === 'gg') return 'GAME_GEAR';
  if (ext === 'sg') return 'SG_1000';
  if (ext === 'md' || ext === 'gen' || ext === 'smd') return 'MEGA_DRIVE';

  // For generic .bin / .rom files, inspect header if available
  if (data && data.byteLength >= 0x2000) {
    const decoder = new TextDecoder('ascii');
    const hasCopierHeader = data.byteLength > 1024 && data.byteLength % 1024 === 512;
    const baseOffset = hasCopierHeader ? 512 : 0;

    // Check 8-bit TMR SEGA header at 0x7FF0, 0x3FF0, or 0x1FF0
    for (const candidateOffset of [0x7ff0, 0x3ff0, 0x1ff0]) {
      const off = baseOffset + candidateOffset;
      if (data.byteLength >= off + 16) {
        const tag = decoder.decode(data.subarray(off, off + 8));
        if (tag.includes('TMR SEGA')) {
          const systemRegionNibble = (data[off + 15] >> 4) & 0x0f;
          // Nibbles 5, 6, 7 indicate Game Gear (Japan, Export, International)
          if (
            systemRegionNibble === 5 ||
            systemRegionNibble === 6 ||
            systemRegionNibble === 7
          ) {
            return 'GAME_GEAR';
          }
          return 'MASTER_SYSTEM';
        }
      }
    }

    // Mega Drive header at 0x0100 starts with "SEGA MEGA DRIVE" or "SEGA GENESIS"
    if (data.byteLength >= baseOffset + 0x0110) {
      const mdTag = decoder.decode(data.subarray(baseOffset + 0x0100, baseOffset + 0x0110));
      if (mdTag.includes('SEGA')) {
        return 'MEGA_DRIVE';
      }
    }
  }

  // If file is <= 512KB and generic .rom, check filename hints
  const lower = fileName.toLowerCase();
  if (lower.includes('(gg)') || lower.includes('game gear') || lower.includes('[gg]')) {
    return 'GAME_GEAR';
  }
  if (lower.includes('(sms)') || lower.includes('master system') || lower.includes('[sms]')) {
    return 'MASTER_SYSTEM';
  }

  return 'MEGA_DRIVE';
}

/**
 * Strips legacy 512-byte copier headers from 8-bit Sega ROMs (.gg, .sms, .sg)
 * so the Z80 CPU boots cleanly at vector 0x0000.
 */
export function normalizeRomPayload(data: Uint8Array, system: SegaSystemKind): Uint8Array {
  if (isEightBitSystem(system) && data.byteLength > 1024 && data.byteLength % 1024 === 512) {
    return new Uint8Array(data.subarray(512));
  }
  return new Uint8Array(data);
}

const coreBundleCache = new Map<string, Promise<{ js: Blob; wasm: Blob }>>();

/**
 * Fetches and unzips Libretro WebAssembly cores in memory using local fflate
 * to avoid external @zip.js dynamic ESM Worker failures on mobile browsers.
 */
export async function resolveLibretroCoreWithFflate(
  core: string
): Promise<{ js: Blob; wasm: Blob }> {
  const cached = coreBundleCache.get(core);
  if (cached) return cached;

  const promise = (async () => {
    const url = `https://cdn.jsdelivr.net/gh/arianrhodsandlot/retroarch-emscripten-build@v1.22.2/retroarch/${core}_libretro.zip`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} loading core ${core}`);
    }
    const zipBytes = new Uint8Array(await response.arrayBuffer());
    const unzipped = unzipSync(zipBytes);

    let jsBlob: Blob | null = null;
    let wasmBlob: Blob | null = null;

    for (const [entryName, entryBytes] of Object.entries(unzipped)) {
      if (entryName.endsWith('.js')) {
        jsBlob = new Blob([new Uint8Array(entryBytes)], {
          type: 'application/javascript',
        });
      } else if (entryName.endsWith('.wasm')) {
        wasmBlob = new Blob([new Uint8Array(entryBytes)], {
          type: 'application/wasm',
        });
      }
    }

    if (!jsBlob || !wasmBlob) {
      throw new Error(`Missing .js or .wasm inside ${core}_libretro.zip`);
    }

    return { js: jsBlob, wasm: wasmBlob };
  })();

  coreBundleCache.set(core, promise);
  try {
    return await promise;
  } catch (err) {
    coreBundleCache.delete(core);
    throw err;
  }
}

export function getSystemBadgeLabel(system: SegaSystemKind): string {
  switch (system) {
    case 'MEGA_DRIVE':
      return 'SEGA Mega Drive · 6 Botones';
    case 'MASTER_SYSTEM':
      return 'SEGA Master System · 2 Botones';
    case 'GAME_GEAR':
      return 'SEGA Game Gear · 2 Botones';
    case 'SG_1000':
      return 'SEGA SG-1000 · 2 Botones';
  }
}

export function isEightBitSystem(system: SegaSystemKind): boolean {
  return system === 'MASTER_SYSTEM' || system === 'GAME_GEAR' || system === 'SG_1000';
}

function isValidRomPath(path: string, byteLength: number): boolean {
  if (byteLength < 1024) return false;
  const baseName = path.split('/').pop() || path;
  if (baseName.startsWith('.') || baseName.startsWith('__MACOSX')) return false;
  const ext = baseName.split('.').pop()?.toLowerCase() || '';
  return VALID_ROM_EXTENSIONS.has(ext);
}

/**
 * Processes an uploaded file:
 * - Direct ROM (.md, .bin, .gen, .smd, .sms, .gg, .sg, .rom) -> returns 1 entry
 * - .zip archive -> decompresses in browser via fflate and returns all valid ROM entries
 * - .7z archive -> decompresses in browser via 7z-wasm and returns all valid ROM entries
 */
export async function extractRomsFromUploadedFile(file: File): Promise<ExtractedRomEntry[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const buffer = await file.arrayBuffer();
  const rawBytes = new Uint8Array(buffer);

  // Check magic bytes for ZIP (PK\x03\x04) or 7z (7z\xBC\xAF\x27\x1C)
  const isZipMagic =
    rawBytes.length > 4 &&
    rawBytes[0] === 0x50 &&
    rawBytes[1] === 0x4b &&
    rawBytes[2] === 0x03 &&
    rawBytes[3] === 0x04;

  const is7zMagic =
    rawBytes.length > 6 &&
    rawBytes[0] === 0x37 &&
    rawBytes[1] === 0x7a &&
    rawBytes[2] === 0xbc &&
    rawBytes[3] === 0xaf &&
    rawBytes[4] === 0x27 &&
    rawBytes[5] === 0x1c;

  if (ext === 'zip' || isZipMagic) {
    return extractFromZipBytes(rawBytes);
  }

  if (ext === '7z' || is7zMagic) {
    return await extractFrom7zBytes(rawBytes);
  }

  // Direct uncompressed ROM file
  const system = detectSegaSystem(file.name, rawBytes);
  return [
    {
      id: `rom-${Date.now()}-0`,
      fileName: file.name,
      fullPath: file.name,
      extension: ext || 'bin',
      system,
      sizeBytes: rawBytes.byteLength,
      data: rawBytes,
    },
  ];
}

function extractFromZipBytes(zipBytes: Uint8Array): ExtractedRomEntry[] {
  const unzipped = unzipSync(zipBytes);
  const results: ExtractedRomEntry[] = [];
  let idx = 0;

  for (const [relativePath, fileData] of Object.entries(unzipped)) {
    if (isValidRomPath(relativePath, fileData.byteLength)) {
      const fileName = relativePath.split('/').pop() || relativePath;
      const ext = fileName.split('.').pop()?.toLowerCase() || 'bin';
      const system = detectSegaSystem(fileName, fileData);
      results.push({
        id: `zip-rom-${Date.now()}-${idx++}`,
        fileName,
        fullPath: relativePath,
        extension: ext,
        system,
        sizeBytes: fileData.byteLength,
        data: fileData,
      });
    }
  }

  // If no standard extension matched inside the ZIP, take any non-empty file > 4KB
  if (results.length === 0) {
    for (const [relativePath, fileData] of Object.entries(unzipped)) {
      if (fileData.byteLength >= 4096 && !relativePath.endsWith('/')) {
        const fileName = relativePath.split('/').pop() || relativePath;
        const ext = fileName.split('.').pop()?.toLowerCase() || 'bin';
        const system = detectSegaSystem(fileName, fileData);
        results.push({
          id: `zip-fallback-${Date.now()}-${idx++}`,
          fileName,
          fullPath: relativePath,
          extension: ext,
          system,
          sizeBytes: fileData.byteLength,
          data: fileData,
        });
      }
    }
  }

  return results;
}

async function extractFrom7zBytes(sevenZipBytes: Uint8Array): Promise<ExtractedRomEntry[]> {
  const sevenZip = await SevenZip({
    locateFile: (url: string) => {
      if (url.endsWith('.wasm')) {
        return sevenZipWasmUrl;
      }
      return url;
    },
    print: () => {},
    printErr: () => {},
  });

  const inputArchivePath = '/archive.7z';
  const outputDir = '/extracted_roms';

  sevenZip.FS.writeFile(inputArchivePath, sevenZipBytes);
  try {
    sevenZip.FS.mkdir(outputDir);
  } catch {
    // directory may already exist
  }

  // Extract all files inside the .7z archive into /extracted_roms
  sevenZip.callMain(['x', inputArchivePath, `-o${outputDir}`, '-y']);

  const collected: ExtractedRomEntry[] = [];
  let idx = 0;

  const walkFs = (dirPath: string, allowAnyBinaryFallback: boolean) => {
    let entries: string[] = [];
    try {
      entries = sevenZip.FS.readdir(dirPath);
    } catch {
      return;
    }

    for (const name of entries) {
      if (name === '.' || name === '..') continue;
      const fullPath = `${dirPath}/${name}`;
      try {
        const stat = sevenZip.FS.stat(fullPath);
        if (sevenZip.FS.isDir(stat.mode)) {
          walkFs(fullPath, allowAnyBinaryFallback);
        } else if (sevenZip.FS.isFile(stat.mode)) {
          const bytes = sevenZip.FS.readFile(fullPath);
          if (
            isValidRomPath(name, bytes.byteLength) ||
            (allowAnyBinaryFallback && bytes.byteLength >= 4096)
          ) {
            const ext = name.split('.').pop()?.toLowerCase() || 'bin';
            const system = detectSegaSystem(name, bytes);
            collected.push({
              id: `7z-rom-${Date.now()}-${idx++}`,
              fileName: name,
              fullPath: fullPath.replace(`${outputDir}/`, ''),
              extension: ext,
              system,
              sizeBytes: bytes.byteLength,
              data: new Uint8Array(bytes),
            });
          }
        }
      } catch {
        // skip unreadable node
      }
    }
  };

  walkFs(outputDir, false);
  if (collected.length === 0) {
    walkFs(outputDir, true);
  }

  return collected;
}
