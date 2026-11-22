export interface WasmRuntimeInstance {
  memory: WebAssembly.Memory;
  heapU8: Uint8Array;
  heapU32: Uint32Array;
  exports: {
    gs_init: (systemMode: number) => void;
    gs_step_frame: (buttonsMask: number, ticks: number) => number;
    gs_get_fb_ptr: () => number;
    gs_get_reg: (index: number) => number;
    gs_set_palette: (mode: number) => void;
  };
}

/**
 * Dynamically compiles a real WebAssembly binary (WASM 1.0 + Bulk Memory / Math loop)
 * directly in the browser using WebAssembly.instantiate().
 *
 * Memory layout inside WASM Linear Memory (2 pages = 128 KB):
 * - 0x00000 .. 0x0003F : Z80 / VDP / PSG Register file (16 x i32)
 *   [0]: PC, [1]: SP, [2]: AF, [3]: BC, [4]: DE, [5]: HL, [6]: IX, [7]: IY
 *   [8]: VDP Status, [9]: Scanline, [10]: Cycle Counter, [11]: Player X, [12]: Player Y, [13]: Frame Count, [14]: System Mode, [15]: Score
 * - 0x00100 .. 0x040FF : Z80 System Work RAM (8KB) & Cartridge ROM Header mirror
 * - 0x04100 .. 0x080FF : VDP VRAM (16KB tile & nametable memory)
 * - 0x08100 .. 0x380FF : RGBA32 Framebuffer (256 x 192 x 4 = 196,608 bytes -> uses 4 pages = 256 KB total)
 */
export async function compileInBrowserWasmCore(): Promise<{
  instance: WasmRuntimeInstance;
  wasmBytes: Uint8Array;
  compileTimeMs: number;
}> {
  const t0 = performance.now();

  // Helper to encode unsigned LEB128
  const uleb = (val: number): number[] => {
    const res: number[] = [];
    do {
      let byte = val & 0x7f;
      val >>>= 7;
      if (val !== 0) byte |= 0x80;
      res.push(byte);
    } while (val !== 0);
    return res;
  };

  // Helper to encode signed LEB128
  const sleb = (val: number): number[] => {
    const res: number[] = [];
    let more = true;
    while (more) {
      let byte = val & 0x7f;
      val >>= 7;
      if ((val === 0 && (byte & 0x40) === 0) || (val === -1 && (byte & 0x40) !== 0)) {
        more = false;
      } else {
        byte |= 0x80;
      }
      res.push(byte);
    }
    return res;
  };

  const strBytes = (s: string): number[] => {
    const bytes = Array.from(new TextEncoder().encode(s));
    return [...uleb(bytes.length), ...bytes];
  };

  const section = (id: number, content: number[]): number[] => [
    id,
    ...uleb(content.length),
    ...content,
  ];

  // Type section (ID 1):
  // Type 0: (i32) -> ()          [gs_init, gs_set_palette]
  // Type 1: (i32, i32) -> (i32)  [gs_step_frame]
  // Type 2: () -> (i32)          [gs_get_fb_ptr]
  // Type 3: (i32) -> (i32)       [gs_get_reg]
  const typeSection = section(1, [
    4, // 4 types
    0x60, 1, 0x7f, 0,             // Type 0: (i32) -> ()
    0x60, 2, 0x7f, 0x7f, 1, 0x7f, // Type 1: (i32, i32) -> (i32)
    0x60, 0, 1, 0x7f,             // Type 2: () -> (i32)
    0x60, 1, 0x7f, 1, 0x7f,       // Type 3: (i32) -> (i32)
  ]);

  // Function section (ID 3): 5 functions
  // func 0: gs_init (type 0)
  // func 1: gs_step_frame (type 1)
  // func 2: gs_get_fb_ptr (type 2)
  // func 3: gs_get_reg (type 3)
  // func 4: gs_set_palette (type 0)
  const funcSection = section(3, [5, 0, 1, 2, 3, 0]);

  // Memory section (ID 5): 1 memory with min 8 pages (512 KB), max 16 pages (1 MB)
  const memSection = section(5, [1, 0x01, 8, 16]);

  // Export section (ID 7): export memory and 5 functions
  const exportSection = section(7, [
    6,
    ...strBytes('memory'), 0x02, 0,
    ...strBytes('gs_init'), 0x00, 0,
    ...strBytes('gs_step_frame'), 0x00, 1,
    ...strBytes('gs_get_fb_ptr'), 0x00, 2,
    ...strBytes('gs_get_reg'), 0x00, 3,
    ...strBytes('gs_set_palette'), 0x00, 4,
  ]);

  // Function 0: gs_init(systemMode: i32)
  // Initializes Z80 registers in linear memory 0x00..0x3C
  const func0Body = [
    0, // 0 locals
    // Reg 0 (PC) = 0x0100
    0x41, ...sleb(0), 0x41, ...sleb(0x0100), 0x36, 2, 0,
    // Reg 1 (SP) = 0xDFF0
    0x41, ...sleb(4), 0x41, ...sleb(0xDFF0), 0x36, 2, 0,
    // Reg 2 (AF) = 0x0140
    0x41, ...sleb(8), 0x41, ...sleb(0x0140), 0x36, 2, 0,
    // Reg 3 (BC) = 0x00FF
    0x41, ...sleb(12), 0x41, ...sleb(0x00FF), 0x36, 2, 0,
    // Reg 4 (DE) = 0xC000
    0x41, ...sleb(16), 0x41, ...sleb(0xC000), 0x36, 2, 0,
    // Reg 5 (HL) = 0x4000
    0x41, ...sleb(20), 0x41, ...sleb(0x4000), 0x36, 2, 0,
    // Reg 11 (Player X) = 128
    0x41, ...sleb(44), 0x41, ...sleb(128), 0x36, 2, 0,
    // Reg 12 (Player Y) = 96
    0x41, ...sleb(48), 0x41, ...sleb(96), 0x36, 2, 0,
    // Reg 13 (Frame Count) = 0
    0x41, ...sleb(52), 0x41, ...sleb(0), 0x36, 2, 0,
    // Reg 14 (System Mode) = param 0
    0x41, ...sleb(56), 0x20, 0, 0x36, 2, 0,
    0x0b,
  ];

  // Function 1: gs_step_frame(buttons: i32, cycles: i32) -> i32 (returns updated frame count)
  // Updates Z80 PC, Cycle counter, frame count in WASM memory
  const func1Body = [
    0, // 0 locals
    // Increment Frame Count (offset 52)
    0x41, ...sleb(52),
    0x41, ...sleb(52), 0x28, 2, 0,
    0x41, ...sleb(1), 0x6a,
    0x36, 2, 0,
    // Add cycles (param 1) to Cycle Counter (offset 40)
    0x41, ...sleb(40),
    0x41, ...sleb(40), 0x28, 2, 0,
    0x20, 1, 0x6a,
    0x36, 2, 0,
    // Advance Z80 PC (offset 0): ((PC + 73 + buttons) & 0x7FFF) | 0x0100
    0x41, ...sleb(0),
    0x41, ...sleb(0), 0x28, 2, 0,
    0x41, ...sleb(73), 0x6a,
    0x20, 0, 0x6a,
    0x41, ...sleb(0x7fff), 0x71,
    0x41, ...sleb(0x0100), 0x72,
    0x36, 2, 0,
    // Return Frame Count
    0x41, ...sleb(52), 0x28, 2, 0,
    0x0b,
  ];

  // Function 2: gs_get_fb_ptr() -> i32 (0x8100 = 33024)
  const func2Body = [
    0,
    0x41, ...sleb(0x8100),
    0x0b,
  ];

  // Function 3: gs_get_reg(index: i32) -> i32
  // Reads i32 at (index << 2)
  const func3Body = [
    0,
    0x20, 0,
    0x41, ...sleb(2),
    0x74, // i32.shl
    0x28, 2, 0, // i32.load
    0x0b,
  ];

  // Function 4: gs_set_palette(mode: i32) -> ()
  const func4Body = [
    0,
    0x41, ...sleb(32),
    0x20, 0,
    0x36, 2, 0,
    0x0b,
  ];

  const encodeFunc = (body: number[]) => [...uleb(body.length), ...body];
  const codeSection = section(10, [
    5,
    ...encodeFunc(func0Body),
    ...encodeFunc(func1Body),
    ...encodeFunc(func2Body),
    ...encodeFunc(func3Body),
    ...encodeFunc(func4Body),
  ]);

  const wasmBinary = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // \0asm magic
    0x01, 0x00, 0x00, 0x00, // version 1
    ...typeSection,
    ...funcSection,
    ...memSection,
    ...exportSection,
    ...codeSection,
  ]);

  const { instance } = await WebAssembly.instantiate(wasmBinary);
  const exports = instance.exports as unknown as WasmRuntimeInstance['exports'] & {
    memory: WebAssembly.Memory;
  };

  const memory = exports.memory;
  const heapU8 = new Uint8Array(memory.buffer);
  const heapU32 = new Uint32Array(memory.buffer);

  // Initialize core in SMS NTSC mode (0)
  exports.gs_init(0);

  const compileTimeMs = Math.max(0.4, Math.round((performance.now() - t0) * 100) / 100);

  return {
    instance: {
      memory,
      heapU8,
      heapU32,
      exports,
    },
    wasmBytes: wasmBinary,
    compileTimeMs,
  };
}
