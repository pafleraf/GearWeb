import React, { useEffect, useRef, useState } from 'react';
import { Nostalgist } from 'nostalgist';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Upload,
  Maximize2,
  Gamepad2,
  Save,
  Tv,
  FolderOpen,
  Sparkles,
  Archive,
  X,
  ChevronDown,
  Check,
  SlidersHorizontal,
} from 'lucide-react';
import { compileInBrowserWasmCore, WasmRuntimeInstance } from './wasm/gearsystemWasmCore';
import {
  BUILTIN_CARTRIDGES,
  ControllerState,
  GearsystemEngine,
  RomCartridge,
  SaveSlotState,
} from './wasm/gearsystemEmulator';
import {
  ExtractedRomEntry,
  extractRomsFromUploadedFile,
  getSystemBadgeLabel,
  isEightBitSystem,
  normalizeRomPayload,
  resolveLibretroCoreWithFflate,
  SegaSystemKind,
} from './wasm/archiveExtractor';

type ConsoleState = 'IDLE_EMPTY' | 'EXTRACTING_ARCHIVE' | 'LOADING_ROM' | 'PLAYING';
type CoreMode = 'LIBRETRO_GENESIS_PLUS_GX' | 'LOCAL_WASM_ENGINE';

type MdButton =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'a'
  | 'b'
  | 'c'
  | 'x'
  | 'y'
  | 'z'
  | 'start'
  | 'mode';

// Track all browser AudioContexts created by Emscripten / OpenAL / WebAudio so we can resume them on mobile & desktop
const trackedAudioContexts = new Set<AudioContext>();

if (typeof window !== 'undefined') {
  const OriginalAudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (OriginalAudioContext && !(OriginalAudioContext as unknown as { __segaPatched?: boolean }).__segaPatched) {
    const PatchedAudioContext = function (
      this: AudioContext,
      ...args: ConstructorParameters<typeof AudioContext>
    ) {
      const ctx = new OriginalAudioContext(...args);
      trackedAudioContexts.add(ctx);
      return ctx;
    } as unknown as typeof AudioContext;

    PatchedAudioContext.prototype = OriginalAudioContext.prototype;
    Object.setPrototypeOf(PatchedAudioContext, OriginalAudioContext);
    (PatchedAudioContext as unknown as { __segaPatched?: boolean }).__segaPatched = true;

    window.AudioContext = PatchedAudioContext;
    if ('webkitAudioContext' in window) {
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext =
        PatchedAudioContext;
    }
  }
}

interface UnifiedSaveSlot {
  slotId: number;
  romTitle: string;
  system: SegaSystemKind;
  timestamp: string;
  nostalgistBlob?: Blob;
  localState?: SaveSlotState;
}

interface ConsoleOptionSpec {
  id: SegaSystemKind;
  name: string;
  shortLabel: string;
  bezelBrand: string;
  specLabel: string;
  preferredExt: string;
}

const CONSOLE_OPTIONS: ConsoleOptionSpec[] = [
  {
    id: 'GAME_GEAR',
    name: 'SEGA Game Gear',
    shortLabel: 'Game Gear',
    bezelBrand: 'SEGA GAME GEAR',
    specLabel: '8-Bit Portátil · 2 Botones · LCD 160×144',
    preferredExt: 'gg',
  },
  {
    id: 'MASTER_SYSTEM',
    name: 'SEGA Master System',
    shortLabel: 'Master System',
    bezelBrand: 'SEGA MASTER SYSTEM',
    specLabel: '8-Bit · Mando 2 Botones · 256×192',
    preferredExt: 'sms',
  },
  {
    id: 'MEGA_DRIVE',
    name: 'SEGA Mega Drive / Genesis',
    shortLabel: 'Mega Drive',
    bezelBrand: 'SEGA MEGA DRIVE 16-BIT',
    specLabel: '16-Bit · Mando 6 Botones · 320×224',
    preferredExt: 'md',
  },
  {
    id: 'SG_1000',
    name: 'SEGA SG-1000',
    shortLabel: 'SG-1000',
    bezelBrand: 'SEGA SG-1000',
    specLabel: '8-Bit Clásico · 2 Botones · 256×192',
    preferredExt: 'sg',
  },
];

const RETROARCH_KEY_MAP: Record<
  MdButton,
  { key: string; code: string; keyCode: number; retroButton: string }
> = {
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, retroButton: 'up' },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, retroButton: 'down' },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, retroButton: 'left' },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, retroButton: 'right' },
  a: { key: 'z', code: 'KeyZ', keyCode: 90, retroButton: 'b' },
  b: { key: 'x', code: 'KeyX', keyCode: 88, retroButton: 'a' },
  c: { key: 'c', code: 'KeyC', keyCode: 67, retroButton: 'r' },
  x: { key: 'a', code: 'KeyA', keyCode: 65, retroButton: 'y' },
  y: { key: 's', code: 'KeyS', keyCode: 83, retroButton: 'x' },
  z: { key: 'd', code: 'KeyD', keyCode: 68, retroButton: 'l' },
  start: { key: 'Enter', code: 'Enter', keyCode: 13, retroButton: 'start' },
  mode: { key: 'Shift', code: 'ShiftRight', keyCode: 16, retroButton: 'select' },
};

function detectIsMobileBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
    ua
  );
  const isCoarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const isNarrowViewport = window.innerWidth <= 920;
  return isMobileUA || (isCoarsePointer && isNarrowViewport);
}

export default function App() {
  // Detect mobile browser on startup -> default to GAME_GEAR on mobile phones
  const [activeSystem, setActiveSystem] = useState<SegaSystemKind>(() =>
    detectIsMobileBrowser() ? 'GAME_GEAR' : 'GAME_GEAR'
  );
  const [isLandscape, setIsLandscape] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  );

  // All configuration/selection menus are hidden behind the physical MENU button bottom sheet
  const [isBottomMenuOpen, setIsBottomMenuOpen] = useState<boolean>(false);
  const [isConsoleDropdownOpen, setIsConsoleDropdownOpen] = useState<boolean>(false);

  const [consoleState, setConsoleState] = useState<ConsoleState>('IDLE_EMPTY');
  const [coreMode, setCoreMode] = useState<CoreMode>('LIBRETRO_GENESIS_PLUS_GX');
  const [loadedRomTitle, setLoadedRomTitle] = useState<string>('');
  const [loadedRomSizeKB, setLoadedRomSizeKB] = useState<number>(0);

  // Archive (.zip / .7z) multi-ROM selection state
  const [archiveFileName, setArchiveFileName] = useState<string>('');
  const [archiveEntries, setArchiveEntries] = useState<ExtractedRomEntry[]>([]);
  const [isArchivePickerOpen, setIsArchivePickerOpen] = useState<boolean>(false);

  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [crtScanlines, setCrtScanlines] = useState<boolean>(true);
  const [isDraggingRom, setIsDraggingRom] = useState<boolean>(false);
  const [connectedGamepadName, setConnectedGamepadName] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Toca la pantalla para cargar una ROM (.gg, .sms, .md, .zip, .7z) o pulsa MENU'
  );

  // 3 Quick Save State Slots
  const [saveSlots, setSaveSlots] = useState<Record<number, UnifiedSaveSlot | null>>({
    1: null,
    2: null,
    3: null,
  });

  // Active button highlights
  const [activeButtons, setActiveButtons] = useState<Record<MdButton, boolean>>({
    up: false,
    down: false,
    left: false,
    right: false,
    a: false,
    b: false,
    c: false,
    x: false,
    y: false,
    z: false,
    start: false,
    mode: false,
  });

  const emulatorMountRef = useRef<HTMLDivElement | null>(null);
  const activeWebglCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const localCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentRomEntryRef = useRef<ExtractedRomEntry | null>(null);
  const isBuiltinDemoActiveRef = useRef<boolean>(false);
  const nostalgistRef = useRef<Nostalgist | null>(null);
  const localWasmRef = useRef<WasmRuntimeInstance | null>(null);
  const localEngineRef = useRef<GearsystemEngine | null>(null);
  const soundEnabledRef = useRef<boolean>(true);

  const ctrlRef = useRef<ControllerState>({
    up: false,
    down: false,
    left: false,
    right: false,
    button1: false,
    button2: false,
    button3: false,
    pause: false,
  });

  const syncAllAudioContexts = (shouldPlay: boolean) => {
    try {
      if (nostalgistRef.current) {
        const al = nostalgistRef.current.getEmscriptenAL() as
          | {
              currentCtx?: { audioCtx?: AudioContext };
              contexts?: Record<string, { audioCtx?: AudioContext }>;
            }
          | undefined;
        if (al?.currentCtx?.audioCtx) {
          trackedAudioContexts.add(al.currentCtx.audioCtx);
        }
        if (al?.contexts) {
          Object.values(al.contexts).forEach((c) => {
            if (c?.audioCtx) trackedAudioContexts.add(c.audioCtx);
          });
        }
      }
    } catch {
      // ignore if emulator AL is not ready yet
    }

    trackedAudioContexts.forEach((ctx) => {
      try {
        if (ctx.state === 'closed') {
          trackedAudioContexts.delete(ctx);
          return;
        }
        if (shouldPlay && ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        } else if (!shouldPlay && ctx.state === 'running') {
          ctx.suspend().catch(() => {});
        }
      } catch {
        // ignore audio state transitions
      }
    });
  };

  const resizeActiveEmulatorViewport = () => {
    if (!nostalgistRef.current || !emulatorMountRef.current) return;
    const rect = emulatorMountRef.current.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(240, Math.floor(rect.height));
    try {
      nostalgistRef.current.resize({ width, height });
    } catch {
      // ignore resize before postRun
    }
  };

  // Track orientation & viewport resize dynamically across Chrome/Safari on Android & iOS
  useEffect(() => {
    const updateViewportAndOrientation = () => {
      const w = window.visualViewport ? window.visualViewport.width : window.innerWidth;
      const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      setIsLandscape(w > h);
      requestAnimationFrame(() => {
        resizeActiveEmulatorViewport();
      });
    };

    updateViewportAndOrientation();
    window.addEventListener('resize', updateViewportAndOrientation);
    window.addEventListener('orientationchange', updateViewportAndOrientation);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewportAndOrientation);
    }

    if (detectIsMobileBrowser()) {
      setActiveSystem('GAME_GEAR');
    }

    return () => {
      window.removeEventListener('resize', updateViewportAndOrientation);
      window.removeEventListener('orientationchange', updateViewportAndOrientation);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateViewportAndOrientation);
      }
    };
  }, []);

  // Pre-initialize local WebAssembly core in background
  useEffect(() => {
    let mounted = true;
    compileInBrowserWasmCore().then(({ instance }) => {
      if (!mounted) return;
      localWasmRef.current = instance;
    });
    return () => {
      mounted = false;
      if (nostalgistRef.current) {
        try {
          nostalgistRef.current.exit({ removeCanvas: true });
        } catch {
          // ignore cleanup
        }
      }
    };
  }, []);

  // USB / Bluetooth Gamepad Connection & 60Hz Polling
  useEffect(() => {
    const onGamepadConnected = (e: GamepadEvent) => {
      setConnectedGamepadName(e.gamepad.id);
      setStatusMessage(`Gamepad conectado: ${e.gamepad.id}`);
    };
    const onGamepadDisconnected = () => {
      setConnectedGamepadName(null);
      setStatusMessage('Gamepad desconectado');
    };

    window.addEventListener('gamepadconnected', onGamepadConnected);
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

    let rafId = 0;
    const prevGpState: Record<MdButton, boolean> = {
      up: false,
      down: false,
      left: false,
      right: false,
      a: false,
      b: false,
      c: false,
      x: false,
      y: false,
      z: false,
      start: false,
      mode: false,
    };

    const pollGamepad = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = pads[0] || pads[1] || pads[2] || pads[3];

      if (gp) {
        if (!connectedGamepadName) {
          setConnectedGamepadName(gp.id);
        }

        const axisX = gp.axes[0] ?? 0;
        const axisY = gp.axes[1] ?? 0;

        const nextGp: Record<MdButton, boolean> = {
          up: Boolean(gp.buttons[12]?.pressed) || axisY < -0.45,
          down: Boolean(gp.buttons[13]?.pressed) || axisY > 0.45,
          left: Boolean(gp.buttons[14]?.pressed) || axisX < -0.45,
          right: Boolean(gp.buttons[15]?.pressed) || axisX > 0.45,
          a: Boolean(gp.buttons[0]?.pressed) || Boolean(gp.buttons[2]?.pressed),
          b: Boolean(gp.buttons[1]?.pressed),
          c: Boolean(gp.buttons[5]?.pressed),
          x: Boolean(gp.buttons[4]?.pressed),
          y: Boolean(gp.buttons[3]?.pressed),
          z: Boolean(gp.buttons[7]?.pressed),
          start: Boolean(gp.buttons[9]?.pressed),
          mode: Boolean(gp.buttons[8]?.pressed),
        };

        (Object.keys(nextGp) as MdButton[]).forEach((btn) => {
          if (nextGp[btn] !== prevGpState[btn]) {
            prevGpState[btn] = nextGp[btn];
            triggerButtonState(btn, nextGp[btn]);
          }
        });
      }

      rafId = requestAnimationFrame(pollGamepad);
    };

    rafId = requestAnimationFrame(pollGamepad);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
    };
  }, [connectedGamepadName]);

  // Keyboard listener
  useEffect(() => {
    const mapCodeToMd = (code: string): MdButton | null => {
      switch (code) {
        case 'ArrowUp':
          return 'up';
        case 'ArrowDown':
          return 'down';
        case 'ArrowLeft':
          return 'left';
        case 'ArrowRight':
          return 'right';
        case 'KeyZ':
          return 'a';
        case 'KeyX':
          return 'b';
        case 'KeyC':
        case 'Space':
          return 'c';
        case 'KeyA':
          return 'x';
        case 'KeyS':
          return 'y';
        case 'KeyD':
          return 'z';
        case 'Enter':
          return 'start';
        case 'ShiftRight':
        case 'ShiftLeft':
          return 'mode';
        default:
          return null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (soundEnabledRef.current) {
        syncAllAudioContexts(true);
      }
      if (e.key === 'Escape') {
        setIsBottomMenuOpen(false);
        setIsConsoleDropdownOpen(false);
        return;
      }
      const btn = mapCodeToMd(e.code);
      if (btn) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
          e.preventDefault();
        }
        updateLocalAndVisualButton(btn, true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const btn = mapCodeToMd(e.code);
      if (btn) {
        updateLocalAndVisualButton(btn, false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Local WASM Engine 60Hz Loop
  useEffect(() => {
    if (
      consoleState !== 'PLAYING' ||
      coreMode !== 'LOCAL_WASM_ENGINE' ||
      isPaused ||
      !localWasmRef.current
    ) {
      return;
    }

    let rafId = 0;
    const wasm = localWasmRef.current;
    const canvas = localCanvasRef.current;
    const ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
    const imgData = ctx ? ctx.createImageData(256, 192) : null;

    const loop = () => {
      const engine = localEngineRef.current;
      if (engine && ctx && imgData) {
        engine.stepFrame(ctrlRef.current);
        const fbPtr = wasm.exports.gs_get_fb_ptr();
        const fbSlice = new Uint8ClampedArray(wasm.memory.buffer, fbPtr, 256 * 192 * 4);
        imgData.data.set(fbSlice);
        ctx.putImageData(imgData, 0, 0);
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [consoleState, coreMode, isPaused]);

  const updateLocalAndVisualButton = (btn: MdButton, pressed: boolean) => {
    setActiveButtons((prev) => (prev[btn] === pressed ? prev : { ...prev, [btn]: pressed }));

    const c = { ...ctrlRef.current };
    if (btn === 'up') c.up = pressed;
    if (btn === 'down') c.down = pressed;
    if (btn === 'left') c.left = pressed;
    if (btn === 'right') c.right = pressed;
    if (btn === 'a' || btn === 'x') c.button1 = pressed;
    if (btn === 'b' || btn === 'y') c.button2 = pressed;
    if (btn === 'c' || btn === 'z') c.button3 = pressed;
    if (btn === 'start') c.pause = pressed;
    ctrlRef.current = c;
  };

  const triggerButtonState = (btn: MdButton, pressed: boolean) => {
    if (pressed && soundEnabledRef.current) {
      syncAllAudioContexts(true);
    }
    updateLocalAndVisualButton(btn, pressed);

    const keySpec = RETROARCH_KEY_MAP[btn];
    if (keySpec && coreMode === 'LIBRETRO_GENESIS_PLUS_GX') {
      if (nostalgistRef.current) {
        try {
          if (pressed) {
            nostalgistRef.current.pressDown(keySpec.retroButton);
          } else {
            nostalgistRef.current.pressUp(keySpec.retroButton);
          }
          return;
        } catch {
          // fallback to keyboard event dispatch
        }
      }

      const evType = pressed ? 'keydown' : 'keyup';
      const synthEvent = new KeyboardEvent(evType, {
        key: keySpec.key,
        code: keySpec.code,
        keyCode: keySpec.keyCode,
        which: keySpec.keyCode,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(synthEvent);
      document.dispatchEvent(synthEvent);
      if (activeWebglCanvasRef.current) {
        activeWebglCanvasRef.current.dispatchEvent(synthEvent);
      }
    }
  };

  const cleanupActiveInstance = () => {
    if (nostalgistRef.current) {
      try {
        nostalgistRef.current.exit({ removeCanvas: true });
      } catch {
        // ignore
      }
      nostalgistRef.current = null;
    }
    if (emulatorMountRef.current) {
      emulatorMountRef.current.innerHTML = '';
    }
    activeWebglCanvasRef.current = null;
    if (localEngineRef.current) {
      localEngineRef.current.toggleAudio(false);
    }
  };

  const createFreshEmulatorCanvas = (): {
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
  } => {
    const container = emulatorMountRef.current;
    if (!container) {
      throw new Error('Emulator screen mount not ready');
    }
    container.innerHTML = '';

    const rect = container.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width) || 480);
    const height = Math.max(240, Math.floor(rect.height) || 360);

    const freshCanvas = document.createElement('canvas');
    freshCanvas.width = width;
    freshCanvas.height = height;
    freshCanvas.className = 'pixelated w-full h-full object-contain block';
    freshCanvas.tabIndex = -1;

    container.appendChild(freshCanvas);
    activeWebglCanvasRef.current = freshCanvas;

    return { canvas: freshCanvas, width, height };
  };

  const launchNostalgistWithCore = async (
    coreName: 'genesis_plus_gx' | 'gearsystem',
    forcedFileName: string,
    romBlob: Blob,
    targetSystem: SegaSystemKind
  ): Promise<Nostalgist> => {
    const { canvas, width, height } = createFreshEmulatorCanvas();

    const retroarchCoreConfig: Record<string, string> =
      coreName === 'genesis_plus_gx'
        ? {
            genesis_plus_gx_system_hw:
              targetSystem === 'GAME_GEAR'
                ? 'game gear'
                : targetSystem === 'MASTER_SYSTEM'
                ? 'master system II'
                : targetSystem === 'SG_1000'
                ? 'sg-1000'
                : 'auto',
            genesis_plus_gx_ym2413: 'auto',
            genesis_plus_gx_lcd_filter: 'disabled',
          }
        : {};

    return await Nostalgist.launch({
      core: coreName,
      // CRITICAL: Pass { fileName, fileContent } object so Nostalgist preserves .gg / .sms / .sg / .md extension!
      rom: {
        fileName: forcedFileName,
        fileContent: romBlob,
      },
      element: canvas,
      size: { width, height },
      resolveCoreJs: async (core) => {
        const name = typeof core === 'string' ? core : coreName;
        const { js } = await resolveLibretroCoreWithFflate(name);
        return js;
      },
      resolveCoreWasm: async (core) => {
        const name = typeof core === 'string' ? core : coreName;
        const { wasm } = await resolveLibretroCoreWithFflate(name);
        return wasm;
      },
      retroarchCoreConfig,
      retroarchConfig: {
        input_player1_up: 'up',
        input_player1_down: 'down',
        input_player1_left: 'left',
        input_player1_right: 'right',
        input_player1_y: 'a',
        input_player1_b: 'z',
        input_player1_a: 'x',
        input_player1_x: 's',
        input_player1_l: 'd',
        input_player1_r: 'c',
        input_player1_start: 'enter',
        input_player1_select: 'rshift',
        audio_enable: true,
        audio_mute_enable: !soundEnabledRef.current,
        audio_out_rate: 48000,
        audio_latency: 64,
        video_aspect_ratio_auto: true,
      },
    });
  };

  const bootExtractedRomEntry = async (
    entry: ExtractedRomEntry,
    forcedSystem?: SegaSystemKind
  ) => {
    cleanupActiveInstance();
    setIsArchivePickerOpen(false);
    setIsBottomMenuOpen(false);
    setConsoleState('LOADING_ROM');
    setIsPaused(false);

    const targetSystem = forcedSystem ?? entry.system;
    setActiveSystem(targetSystem);
    currentRomEntryRef.current = { ...entry, system: targetSystem };
    isBuiltinDemoActiveRef.current = false;

    const cleanRomBytes = normalizeRomPayload(entry.data, targetSystem);
    const sizeKB = Math.max(1, Math.round(cleanRomBytes.byteLength / 1024));
    setLoadedRomTitle(entry.fileName);
    setLoadedRomSizeKB(sizeKB);
    setStatusMessage(`Cargando ${entry.fileName} (${sizeKB} KB)...`);

    const targetSpec =
      CONSOLE_OPTIONS.find((c) => c.id === targetSystem) ?? CONSOLE_OPTIONS[0];
    const safeBaseTitle =
      entry.fileName
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || 'sega_cartridge';
    const forcedFileName = `${safeBaseTitle}.${targetSpec.preferredExt}`;
    const romBlob = new Blob([new Uint8Array(cleanRomBytes)], {
      type: 'application/octet-stream',
    });

    try {
      let instance: Nostalgist;
      try {
        instance = await launchNostalgistWithCore(
          'genesis_plus_gx',
          forcedFileName,
          romBlob,
          targetSystem
        );
      } catch (primaryErr) {
        if (isEightBitSystem(targetSystem)) {
          instance = await launchNostalgistWithCore(
            'gearsystem',
            forcedFileName,
            romBlob,
            targetSystem
          );
        } else {
          throw primaryErr;
        }
      }

      nostalgistRef.current = instance;
      setCoreMode('LIBRETRO_GENESIS_PLUS_GX');
      setConsoleState('PLAYING');
      setStatusMessage(`${entry.fileName} · ${targetSpec.shortLabel}`);

      requestAnimationFrame(() => {
        resizeActiveEmulatorViewport();
        syncAllAudioContexts(soundEnabledRef.current);
      });
    } catch {
      bootLocalWasmFallback(entry.fileName, cleanRomBytes, targetSystem);
    }
  };

  const handleSelectConsoleFromDropdown = async (newSystem: SegaSystemKind) => {
    setIsConsoleDropdownOpen(false);
    setActiveSystem(newSystem);

    if (consoleState === 'PLAYING') {
      if (isBuiltinDemoActiveRef.current) {
        handleBootBuiltinSystemDemo(newSystem);
      } else if (currentRomEntryRef.current) {
        await bootExtractedRomEntry(currentRomEntryRef.current, newSystem);
      }
    } else {
      setStatusMessage(`Modo ${getSystemBadgeLabel(newSystem)} activo`);
    }
  };

  const handleProcessUploadedFile = async (file: File) => {
    const prevState = consoleState;
    setIsBottomMenuOpen(false);
    setConsoleState('EXTRACTING_ARCHIVE');
    setStatusMessage(`Descomprimiendo ${file.name}...`);

    try {
      const entries = await extractRomsFromUploadedFile(file);

      if (entries.length === 0) {
        setConsoleState(prevState === 'PLAYING' ? 'PLAYING' : 'IDLE_EMPTY');
        setStatusMessage(`Sin ROMs válidas en ${file.name}`);
        return;
      }

      if (entries.length === 1) {
        setArchiveEntries([]);
        setArchiveFileName('');
        await bootExtractedRomEntry(entries[0]);
      } else {
        setArchiveFileName(file.name);
        setArchiveEntries(entries);
        setIsArchivePickerOpen(true);
        setConsoleState(prevState === 'PLAYING' ? 'PLAYING' : 'IDLE_EMPTY');
        setStatusMessage(`${entries.length} ROMs en ${file.name}`);
      }
    } catch {
      setConsoleState(prevState === 'PLAYING' ? 'PLAYING' : 'IDLE_EMPTY');
      setStatusMessage(`Error al abrir ${file.name}`);
    }
  };

  const bootLocalWasmFallback = (
    title: string,
    bytes: Uint8Array,
    system: SegaSystemKind
  ) => {
    if (!localWasmRef.current) return;
    const romData = new Uint8Array(Math.max(bytes.length, 65536));
    romData.set(bytes);

    romData[0] =
      system === 'GAME_GEAR'
        ? 0x03
        : system === 'MASTER_SYSTEM'
        ? 0x02
        : system === 'SG_1000'
        ? 0x04
        : 0x05;

    const customCart: RomCartridge = {
      ...BUILTIN_CARTRIDGES[0],
      id: `local-${Date.now()}`,
      title,
      system:
        system === 'GAME_GEAR'
          ? 'GAME_GEAR'
          : system === 'MASTER_SYSTEM'
          ? 'SMS_NTSC'
          : system === 'SG_1000'
          ? 'SG_1000'
          : 'MEGA_DRIVE_16',
      sizeBytes: bytes.byteLength,
      data: romData,
    };

    if (localCanvasRef.current) {
      localCanvasRef.current.width = 256;
      localCanvasRef.current.height = 192;
    }

    const engine = new GearsystemEngine(localWasmRef.current, customCart);
    engine.toggleAudio(soundEnabledRef.current);
    localEngineRef.current = engine;
    setActiveSystem(system);
    setCoreMode('LOCAL_WASM_ENGINE');
    setLoadedRomTitle(title);
    setLoadedRomSizeKB(Math.max(1, Math.round(bytes.byteLength / 1024)));
    setConsoleState('PLAYING');
    setIsPaused(false);
    setStatusMessage(`${title}`);
  };

  const handleBootBuiltinSystemDemo = (sys: SegaSystemKind) => {
    cleanupActiveInstance();
    setIsBottomMenuOpen(false);
    setArchiveEntries([]);
    setArchiveFileName('');
    isBuiltinDemoActiveRef.current = true;
    const cartIndex =
      sys === 'MASTER_SYSTEM'
        ? 1
        : sys === 'GAME_GEAR'
        ? 2
        : sys === 'SG_1000'
        ? 4
        : 0;
    const demo = BUILTIN_CARTRIDGES[cartIndex];
    currentRomEntryRef.current = {
      id: demo.id,
      fileName: demo.title,
      fullPath: demo.title,
      extension: sys === 'MASTER_SYSTEM' ? 'sms' : sys === 'GAME_GEAR' ? 'gg' : 'md',
      system: sys,
      sizeBytes: demo.sizeBytes,
      data: demo.data,
    };
    bootLocalWasmFallback(demo.title, demo.data, sys);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleProcessUploadedFile(file);
    e.target.value = '';
  };

  const handleDropRom = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingRom(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleProcessUploadedFile(file);
    }
  };

  const handleTogglePause = () => {
    if (consoleState !== 'PLAYING') return;
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);

    if (coreMode === 'LIBRETRO_GENESIS_PLUS_GX' && nostalgistRef.current) {
      if (nextPaused) {
        nostalgistRef.current.pause();
      } else {
        nostalgistRef.current.resume();
        syncAllAudioContexts(soundEnabledRef.current);
      }
    }
    setStatusMessage(nextPaused ? 'En Pausa' : loadedRomTitle);
  };

  const handleRestartRom = () => {
    if (consoleState !== 'PLAYING') return;
    setIsPaused(false);
    setIsBottomMenuOpen(false);

    if (coreMode === 'LIBRETRO_GENESIS_PLUS_GX' && nostalgistRef.current) {
      nostalgistRef.current.restart();
      syncAllAudioContexts(soundEnabledRef.current);
    } else if (localEngineRef.current) {
      const cartIndex =
        activeSystem === 'MASTER_SYSTEM'
          ? 1
          : activeSystem === 'GAME_GEAR'
          ? 2
          : activeSystem === 'SG_1000'
          ? 4
          : 0;
      localEngineRef.current.loadRom(BUILTIN_CARTRIDGES[cartIndex]);
    }
    setStatusMessage(`Reiniciado: ${loadedRomTitle}`);
  };

  const handleToggleSound = () => {
    const nextSound = !soundEnabled;
    soundEnabledRef.current = nextSound;
    setSoundEnabled(nextSound);
    syncAllAudioContexts(nextSound);
    if (localEngineRef.current) {
      localEngineRef.current.toggleAudio(nextSound);
    }
  };

  const handleSaveStateSlot = async (slotId: number) => {
    if (consoleState !== 'PLAYING') return;
    const timestamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    if (coreMode === 'LIBRETRO_GENESIS_PLUS_GX' && nostalgistRef.current) {
      try {
        const { state } = await nostalgistRef.current.saveState();
        setSaveSlots((prev) => ({
          ...prev,
          [slotId]: {
            slotId,
            romTitle: loadedRomTitle,
            system: activeSystem,
            timestamp,
            nostalgistBlob: state,
          },
        }));
        setStatusMessage(`Guardado Slot #${slotId}`);
      } catch {
        setStatusMessage(`Error al guardar #${slotId}`);
      }
    } else if (localEngineRef.current) {
      const localState = localEngineRef.current.createSaveState(slotId);
      setSaveSlots((prev) => ({
        ...prev,
        [slotId]: {
          slotId,
          romTitle: loadedRomTitle,
          system: activeSystem,
          timestamp,
          localState,
        },
      }));
      setStatusMessage(`Guardado Slot #${slotId}`);
    }
  };

  const handleLoadStateSlot = async (slotId: number) => {
    const slot = saveSlots[slotId];
    if (!slot || consoleState !== 'PLAYING') return;

    if (
      coreMode === 'LIBRETRO_GENESIS_PLUS_GX' &&
      nostalgistRef.current &&
      slot.nostalgistBlob
    ) {
      try {
        await nostalgistRef.current.loadState(slot.nostalgistBlob);
        setIsBottomMenuOpen(false);
        setStatusMessage(`Cargado Slot #${slotId}`);
      } catch {
        setStatusMessage(`Error al cargar #${slotId}`);
      }
    } else if (localEngineRef.current && slot.localState) {
      localEngineRef.current.loadSaveState(slot.localState);
      setIsBottomMenuOpen(false);
      setStatusMessage(`Cargado Slot #${slotId}`);
    }
  };

  const handleFullscreen = () => {
    if (shellContainerRef.current && shellContainerRef.current.requestFullscreen) {
      shellContainerRef.current.requestFullscreen().catch(() => {});
    }
    setIsBottomMenuOpen(false);
  };

  const isTwoButtonPad = isEightBitSystem(activeSystem);
  const activeConsoleOption =
    CONSOLE_OPTIONS.find((c) => c.id === activeSystem) ?? CONSOLE_OPTIONS[0];

  // Shared Physical D-Pad Component (Sega Game Gear Rounded Cross D-Pad)
  const renderPhysicalDPad = (sizeClass: string) => (
    <div
      className={`relative ${sizeClass} rounded-full bg-[#14171D] border-2 border-[#2D333F] shadow-inner p-2 grid grid-cols-3 grid-rows-3 gap-1 shrink-0`}
    >
      <div />
      <button
        onMouseDown={() => triggerButtonState('up', true)}
        onMouseUp={() => triggerButtonState('up', false)}
        onMouseLeave={() => triggerButtonState('up', false)}
        onTouchStart={(e) => {
          e.preventDefault();
          triggerButtonState('up', true);
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          triggerButtonState('up', false);
        }}
        aria-label="Arriba"
        className={`rounded-t-lg font-mono text-xs font-bold flex items-center justify-center border transition-transform cursor-pointer ${
          activeButtons.up
            ? 'bg-sky-400 text-slate-950 border-sky-300 scale-95'
            : 'bg-[#282D38] text-slate-200 border-[#3B4252] active:scale-95'
        }`}
      >
        ▲
      </button>
      <div />

      <button
        onMouseDown={() => triggerButtonState('left', true)}
        onMouseUp={() => triggerButtonState('left', false)}
        onMouseLeave={() => triggerButtonState('left', false)}
        onTouchStart={(e) => {
          e.preventDefault();
          triggerButtonState('left', true);
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          triggerButtonState('left', false);
        }}
        aria-label="Izquierda"
        className={`rounded-l-lg font-mono text-xs font-bold flex items-center justify-center border transition-transform cursor-pointer ${
          activeButtons.left
            ? 'bg-sky-400 text-slate-950 border-sky-300 scale-95'
            : 'bg-[#282D38] text-slate-200 border-[#3B4252] active:scale-95'
        }`}
      >
        ◀
      </button>

      {/* Center D-Pad Pivot Circle */}
      <div className="bg-[#20242D] flex items-center justify-center">
        <div className="w-4 h-4 rounded-full bg-[#15181E] border border-[#323846]" />
      </div>

      <button
        onMouseDown={() => triggerButtonState('right', true)}
        onMouseUp={() => triggerButtonState('right', false)}
        onMouseLeave={() => triggerButtonState('right', false)}
        onTouchStart={(e) => {
          e.preventDefault();
          triggerButtonState('right', true);
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          triggerButtonState('right', false);
        }}
        aria-label="Derecha"
        className={`rounded-r-lg font-mono text-xs font-bold flex items-center justify-center border transition-transform cursor-pointer ${
          activeButtons.right
            ? 'bg-sky-400 text-slate-950 border-sky-300 scale-95'
            : 'bg-[#282D38] text-slate-200 border-[#3B4252] active:scale-95'
        }`}
      >
        ▶
      </button>

      <div />
      <button
        onMouseDown={() => triggerButtonState('down', true)}
        onMouseUp={() => triggerButtonState('down', false)}
        onMouseLeave={() => triggerButtonState('down', false)}
        onTouchStart={(e) => {
          e.preventDefault();
          triggerButtonState('down', true);
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          triggerButtonState('down', false);
        }}
        aria-label="Abajo"
        className={`rounded-b-lg font-mono text-xs font-bold flex items-center justify-center border transition-transform cursor-pointer ${
          activeButtons.down
            ? 'bg-sky-400 text-slate-950 border-sky-300 scale-95'
            : 'bg-[#282D38] text-slate-200 border-[#3B4252] active:scale-95'
        }`}
      >
        ▼
      </button>
      <div />
    </div>
  );

  // Shared Action Buttons (2-Button Game Gear / Master System OR 6-Button Mega Drive)
  const renderPhysicalActionButtons = (compact = false) => {
    if (isTwoButtonPad) {
      const btnSize = compact ? 'w-14 h-14 text-sm' : 'w-16 h-16 text-base';
      return (
        <div className="flex items-center gap-3.5 -rotate-12">
          {/* Button 1 (Bottom-Left) */}
          <div className="flex flex-col items-center gap-1 mt-4">
            <button
              onMouseDown={() => triggerButtonState('a', true)}
              onMouseUp={() => triggerButtonState('a', false)}
              onMouseLeave={() => triggerButtonState('a', false)}
              onTouchStart={(e) => {
                e.preventDefault();
                triggerButtonState('a', true);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                triggerButtonState('a', false);
              }}
              className={`${btnSize} rounded-full font-mono font-bold border-2 shadow-lg transition-transform cursor-pointer flex items-center justify-center ${
                activeButtons.a
                  ? 'bg-sky-400 text-slate-950 border-sky-200 scale-95'
                  : 'bg-[#2A303C] text-slate-100 border-[#434C5E] active:scale-95'
              }`}
            >
              1
            </button>
            <span className="font-mono text-[10px] font-bold tracking-wider text-slate-400">
              1
            </span>
          </div>

          {/* Button 2 (Top-Right) */}
          <div className="flex flex-col items-center gap-1 -mt-4">
            <button
              onMouseDown={() => triggerButtonState('b', true)}
              onMouseUp={() => triggerButtonState('b', false)}
              onMouseLeave={() => triggerButtonState('b', false)}
              onTouchStart={(e) => {
                e.preventDefault();
                triggerButtonState('b', true);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                triggerButtonState('b', false);
              }}
              className={`${btnSize} rounded-full font-mono font-bold border-2 shadow-lg transition-transform cursor-pointer flex items-center justify-center ${
                activeButtons.b
                  ? 'bg-sky-400 text-slate-950 border-sky-200 scale-95'
                  : 'bg-[#2A303C] text-slate-100 border-[#434C5E] active:scale-95'
              }`}
            >
              2
            </button>
            <span className="font-mono text-[10px] font-bold tracking-wider text-slate-400">
              2
            </span>
          </div>
        </div>
      );
    }

    // 6-Button Mega Drive Layout
    const mdBtnSmall = compact ? 'w-10 h-9 text-xs' : 'w-11 h-10 text-xs';
    const mdBtnLarge = compact ? 'w-11 h-11 text-xs' : 'w-12 h-12 text-sm';
    return (
      <div className="space-y-1.5 -rotate-6">
        <div className="flex items-center justify-end gap-1.5">
          {(['x', 'y', 'z'] as const).map((btn) => (
            <button
              key={btn}
              onMouseDown={() => triggerButtonState(btn, true)}
              onMouseUp={() => triggerButtonState(btn, false)}
              onMouseLeave={() => triggerButtonState(btn, false)}
              onTouchStart={(e) => {
                e.preventDefault();
                triggerButtonState(btn, true);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                triggerButtonState(btn, false);
              }}
              className={`${mdBtnSmall} rounded-full font-mono font-bold border transition-transform cursor-pointer flex items-center justify-center uppercase ${
                activeButtons[btn]
                  ? 'bg-sky-400 text-slate-950 border-sky-200 scale-95'
                  : 'bg-[#232832] text-slate-300 border-[#3B4252]'
              }`}
            >
              {btn}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-end gap-1.5">
          {(['a', 'b', 'c'] as const).map((btn) => (
            <button
              key={btn}
              onMouseDown={() => triggerButtonState(btn, true)}
              onMouseUp={() => triggerButtonState(btn, false)}
              onMouseLeave={() => triggerButtonState(btn, false)}
              onTouchStart={(e) => {
                e.preventDefault();
                triggerButtonState(btn, true);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                triggerButtonState(btn, false);
              }}
              className={`${mdBtnLarge} rounded-full font-mono font-bold border-2 transition-transform cursor-pointer flex items-center justify-center uppercase ${
                activeButtons[btn]
                  ? 'bg-amber-400 text-slate-950 border-amber-200 scale-95'
                  : 'bg-[#2A303C] text-slate-100 border-[#434C5E]'
              }`}
            >
              {btn}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Shared Physical MENU & START Pill Buttons (Integrated into the console shell)
  const renderPhysicalMenuAndStartButtons = (verticalStack = false) => (
    <div
      className={`flex ${
        verticalStack ? 'flex-col items-end gap-2.5' : 'items-center justify-center gap-5'
      }`}
    >
      {/* Physical MENU Button that opens the Bottom Sheet */}
      <div className="flex flex-col items-center gap-1">
        <button
          onClick={() => setIsBottomMenuOpen(true)}
          className="px-4 py-1.5 min-h-[34px] rounded-full bg-[#282E3A] hover:bg-[#323A48] active:scale-95 border-2 border-[#434C5E] shadow-md font-mono text-[11px] font-bold tracking-wider text-slate-200 transition-transform cursor-pointer flex items-center gap-1.5"
        >
          <SlidersHorizontal className="w-3 h-3 text-sky-400" />
          MENU
        </button>
      </div>

      {/* Classic Game Gear Blue Oval START Button */}
      <div className="flex flex-col items-center gap-1">
        <button
          onMouseDown={() => triggerButtonState('start', true)}
          onMouseUp={() => triggerButtonState('start', false)}
          onMouseLeave={() => triggerButtonState('start', false)}
          onTouchStart={(e) => {
            e.preventDefault();
            triggerButtonState('start', true);
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            triggerButtonState('start', false);
          }}
          className={`px-5 py-1.5 min-h-[34px] rounded-full font-mono text-[11px] font-bold tracking-wider border-2 shadow-md transition-transform cursor-pointer ${
            activeButtons.start
              ? 'bg-amber-400 text-slate-950 border-amber-200 scale-95'
              : 'bg-[#1D4ED8] hover:bg-[#2563EB] text-white border-[#3B82F6] active:scale-95'
          }`}
        >
          START
        </button>
      </div>
    </div>
  );

  // Shared Game Gear Screen Lens Bezel & Canvas Viewport
  const renderGameGearScreenBezel = () => (
    <div className="w-full h-full flex flex-col rounded-2xl bg-[#0B0D12] border-2 border-[#2D3340] p-2.5 sm:p-3.5 shadow-2xl overflow-hidden">
      {/* Top Bezel Header: Red BATTERY LED + SEGA GAME GEAR Logo + Red-Green-Blue Tri-Color Stripe */}
      <div className="flex items-center justify-between gap-2 pb-2 px-1 shrink-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              consoleState === 'PLAYING'
                ? 'bg-red-500 shadow-[0_0_8px_#ef4444]'
                : 'bg-red-900/70'
            }`}
          />
          <span className="font-mono text-[9px] sm:text-[10px] font-bold tracking-widest text-slate-400">
            BATTERY
          </span>
        </div>

        <div className="font-mono text-[11px] sm:text-xs font-extrabold tracking-widest text-slate-200 truncate">
          {activeConsoleOption.bezelBrand}
        </div>

        {/* Classic Game Gear Red-Green-Blue Emblem */}
        <div className="flex items-center gap-1 shrink-0" aria-hidden="true">
          <span className="w-2.5 h-3.5 bg-red-500 rounded-xs -skew-x-12" />
          <span className="w-2.5 h-3.5 bg-emerald-500 rounded-xs -skew-x-12" />
          <span className="w-2.5 h-3.5 bg-blue-500 rounded-xs -skew-x-12" />
        </div>
      </div>

      {/* Inner Recessed LCD / CRT Screen */}
      <div
        onClick={() => {
          if (consoleState === 'PLAYING' && soundEnabledRef.current) {
            syncAllAudioContexts(true);
          }
        }}
        className="relative flex-1 w-full bg-black rounded-xl border border-[#1E2430] overflow-hidden flex items-center justify-center min-h-0"
      >
        {/* Dedicated WebGL Mount Container (always laid out with non-zero dimensions) */}
        <div
          ref={emulatorMountRef}
          className={`w-full h-full flex items-center justify-center ${
            coreMode === 'LOCAL_WASM_ENGINE' && consoleState === 'PLAYING' ? 'hidden' : 'flex'
          }`}
        />

        {/* Dedicated 2D Canvas for Built-in Local WASM Demo / Fallback */}
        <canvas
          ref={localCanvasRef}
          width={256}
          height={192}
          className={`pixelated w-full h-full object-contain ${
            coreMode === 'LOCAL_WASM_ENGINE' && consoleState === 'PLAYING' ? 'block' : 'hidden'
          }`}
        />

        {/* CRT / LCD Scanline Filter */}
        {consoleState === 'PLAYING' && crtScanlines && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 opacity-25 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.85)_50%)] bg-[length:100%_4px]"
          />
        )}

        {/* Empty State inside the Game Gear Screen */}
        {consoleState === 'IDLE_EMPTY' && (
          <div className="absolute inset-0 z-20 bg-black w-full h-full p-4 flex flex-col items-center justify-center text-center space-y-3">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="max-w-xs w-full p-4 sm:p-5 rounded-xl border border-dashed border-slate-700 hover:border-sky-400 bg-slate-900/60 transition-colors cursor-pointer space-y-2"
            >
              <FolderOpen className="w-8 h-8 text-sky-400 mx-auto" />
              <div className="text-xs sm:text-sm font-bold text-slate-100">
                Toca para Cargar ROM ({activeConsoleOption.shortLabel})
              </div>
              <p className="text-[11px] text-slate-400 leading-tight">
                Archivos <span className="text-sky-300 font-mono">.gg .sms .md .bin</span> o
                comprimidos <span className="text-amber-300 font-mono">.zip .7z</span>
              </p>
            </div>

            <button
              onClick={() => handleBootBuiltinSystemDemo(activeSystem)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sky-400 text-xs font-semibold cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Probar Demo {activeConsoleOption.shortLabel}
            </button>
          </div>
        )}

        {/* Archive Extraction Spinner */}
        {consoleState === 'EXTRACTING_ARCHIVE' && (
          <div className="absolute inset-0 z-20 bg-black/95 p-4 flex flex-col items-center justify-center text-center space-y-2">
            <div className="w-7 h-7 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mx-auto" />
            <div className="text-xs font-semibold text-slate-200">
              Extrayendo .ZIP / .7Z...
            </div>
          </div>
        )}

        {/* ROM Loading Spinner */}
        {consoleState === 'LOADING_ROM' && (
          <div className="absolute inset-0 z-20 bg-black/90 p-4 flex flex-col items-center justify-center text-center space-y-2">
            <div className="w-7 h-7 rounded-full border-2 border-sky-400 border-t-transparent animate-spin mx-auto" />
            <div className="text-xs font-semibold text-slate-200 truncate max-w-xs">
              Iniciando {loadedRomTitle}...
            </div>
          </div>
        )}
      </div>

      {/* Bottom Bezel Status Micro-Line */}
      <div className="pt-1.5 px-1 flex items-center justify-between text-[10px] font-mono text-slate-400 shrink-0">
        <span className="truncate max-w-[70%]">{statusMessage}</span>
        <span className="text-slate-500">
          {connectedGamepadName ? 'PAD USB/BT' : activeConsoleOption.shortLabel.toUpperCase()}
        </span>
      </div>
    </div>
  );

  return (
    <div
      ref={shellContainerRef}
      onPointerDown={() => {
        if (soundEnabledRef.current) {
          syncAllAudioContexts(true);
        }
      }}
      className="w-full h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#181B22] text-slate-100 flex flex-col safe-shell-padding"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingRom(true);
      }}
      onDragLeave={() => setIsDraggingRom(false)}
      onDrop={handleDropRom}
    >
      {/* Hidden File Input for ROMs & .zip/.7z Archives */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".gg,.sms,.md,.bin,.gen,.smd,.sg,.rom,.zip,.7z"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Drag & Drop Overlay */}
      {isDraggingRom && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-6 pointer-events-none">
          <div className="max-w-sm w-full rounded-2xl border-2 border-dashed border-sky-400 bg-slate-900/95 p-6 text-center space-y-2">
            <Upload className="w-9 h-9 text-sky-400 mx-auto" />
            <div className="text-base font-bold text-slate-100">
              Suelta tu ROM o paquete .ZIP / .7Z
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          ORIENTATION 1: PORTRAIT MODE (Game Boy Vertical Ergonomics + Game Gear Colors)
          ===================================================================== */}
      {!isLandscape ? (
        <div className="w-full h-full max-w-md mx-auto rounded-[28px] bg-[#222731] border-2 border-[#333A48] shadow-2xl p-3.5 sm:p-4 flex flex-col justify-between gap-3 overflow-hidden">
          {/* Top Half (52% height): Game Gear Bezel + Screen */}
          <div className="w-full h-[50%] min-h-0 flex flex-col">
            {renderGameGearScreenBezel()}
          </div>

          {/* Decorative Game Gear Speaker Grille Strip */}
          <div className="flex items-center justify-between px-3 shrink-0">
            <div className="w-16 h-3 rounded-full gg-speaker-grille opacity-75" />
            <span className="font-mono text-[10px] font-bold tracking-widest text-slate-400">
              PORTABLE WASM SYSTEM
            </span>
            <div className="w-16 h-3 rounded-full gg-speaker-grille opacity-75" />
          </div>

          {/* Middle Physical Controls Row: Left D-Pad + Right 1/2 Buttons */}
          <div className="flex-1 min-h-0 flex items-center justify-between px-2 sm:px-4">
            {renderPhysicalDPad('w-32 h-32 sm:w-36 sm:h-36')}
            {renderPhysicalActionButtons(false)}
          </div>

          {/* Bottom Center Physical Buttons: [ MENU ] and [ START ] */}
          <div className="pb-1 pt-1 shrink-0">
            {renderPhysicalMenuAndStartButtons(false)}
          </div>
        </div>
      ) : (
        /* =====================================================================
           ORIENTATION 2: LANDSCAPE MODE (Classic Horizontal SEGA Game Gear Shell)
           ===================================================================== */
        <div className="w-full h-full max-w-5xl mx-auto rounded-[34px] bg-[#222731] border-2 border-[#333A48] shadow-2xl px-4 py-3 flex items-center justify-between gap-3 sm:gap-5 overflow-hidden">
          {/* Left Wing Grip: Speaker Grille + Classic D-Pad */}
          <div className="w-36 sm:w-44 h-full flex flex-col items-center justify-between py-2 shrink-0">
            <div className="w-20 h-5 rounded-lg gg-speaker-grille opacity-80" />
            {renderPhysicalDPad('w-32 h-32 sm:w-36 sm:h-36')}
            <div className="font-mono text-[10px] font-bold tracking-widest text-slate-400">
              D-PAD
            </div>
          </div>

          {/* Center Viewport: Game Gear Bezel Screen */}
          <div className="flex-1 h-full min-w-0 flex flex-col">
            {renderGameGearScreenBezel()}
          </div>

          {/* Right Wing Grip: Physical START + MENU at Top, Action Buttons 1 & 2 in Center */}
          <div className="w-36 sm:w-44 h-full flex flex-col items-center justify-between py-2 shrink-0">
            {renderPhysicalMenuAndStartButtons(false)}
            <div className="my-auto">{renderPhysicalActionButtons(true)}</div>
            <div className="w-20 h-4 rounded-lg gg-speaker-grille opacity-70" />
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM-TO-TOP SLIDE-UP MENU DRAWER (Hidden until MENU button is pressed)
          ===================================================================== */}
      {isBottomMenuOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex flex-col justify-end"
          onClick={() => {
            setIsBottomMenuOpen(false);
            setIsConsoleDropdownOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl mx-auto rounded-t-3xl border-t-2 border-slate-700 bg-[#121620] p-5 pb-8 shadow-2xl space-y-4 max-h-[86dvh] overflow-y-auto"
          >
            {/* Bottom Sheet Grab Handle */}
            <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto -mt-1" />

            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  Menú del Sistema SEGA
                </h2>
                <p className="text-xs text-slate-400">
                  Selecciona consola, carga ROMs (.zip / .7z) o gestiona tu partida
                </p>
              </div>
              <button
                onClick={() => setIsBottomMenuOpen(false)}
                className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 1. Expandable Console Dropdown Selector inside Bottom Menu */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-400">
                Consola a Emular
              </label>
              <div className="relative">
                <button
                  onClick={() => setIsConsoleDropdownOpen((prev) => !prev)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 hover:border-sky-500/50 text-left cursor-pointer"
                >
                  <div>
                    <div className="text-sm font-bold text-slate-100">
                      {activeConsoleOption.name}
                    </div>
                    <div className="text-xs font-mono text-sky-400">
                      {activeConsoleOption.specLabel}
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      isConsoleDropdownOpen ? 'rotate-180 text-sky-400' : ''
                    }`}
                  />
                </button>

                {isConsoleDropdownOpen && (
                  <div className="mt-1.5 rounded-xl border border-slate-700 bg-[#0D111A] divide-y divide-slate-800/70 overflow-hidden">
                    {CONSOLE_OPTIONS.map((option) => {
                      const isSelected = option.id === activeSystem;
                      return (
                        <button
                          key={option.id}
                          onClick={() => handleSelectConsoleFromDropdown(option.id)}
                          className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-sky-500/15 text-slate-100'
                              : 'text-slate-300 hover:bg-slate-800/70'
                          }`}
                        >
                          <div>
                            <div className="text-xs font-bold text-slate-100">
                              {option.name}
                            </div>
                            <div className="text-[11px] font-mono text-slate-400">
                              {option.specLabel}
                            </div>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-sky-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 2. Primary ROM & Archive Loader Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 font-bold text-xs cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                Cargar ROM / .ZIP / .7Z
              </button>

              {archiveEntries.length > 1 ? (
                <button
                  onClick={() => {
                    setIsBottomMenuOpen(false);
                    setIsArchivePickerOpen(true);
                  }}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-300 font-semibold text-xs cursor-pointer"
                >
                  <Archive className="w-4 h-4" />
                  Cambiar ROM del Paquete ({archiveEntries.length})
                </button>
              ) : (
                <button
                  onClick={() => handleBootBuiltinSystemDemo(activeSystem)}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-xs cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  Iniciar Demo {activeConsoleOption.shortLabel}
                </button>
              )}
            </div>

            {/* 3. Quick Save States (Slots 1, 2, 3) */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-400">
                Guardado Rápido de Partida (Save States)
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((slotId) => {
                  const slot = saveSlots[slotId];
                  return (
                    <div
                      key={slotId}
                      className="p-2.5 rounded-xl border border-slate-800 bg-slate-900/90 flex flex-col justify-between gap-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-200">Slot #{slotId}</span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {slot ? slot.timestamp : 'Vacío'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          onClick={() => handleSaveStateSlot(slotId)}
                          disabled={consoleState !== 'PLAYING'}
                          className={`py-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 ${
                            consoleState === 'PLAYING'
                              ? 'bg-slate-800 hover:bg-slate-700 text-slate-100 cursor-pointer'
                              : 'bg-slate-950 text-slate-600 cursor-not-allowed'
                          }`}
                        >
                          <Save className="w-3 h-3 text-sky-400" />
                          Guardar
                        </button>
                        <button
                          onClick={() => handleLoadStateSlot(slotId)}
                          disabled={consoleState !== 'PLAYING' || !slot}
                          className={`py-1.5 rounded-lg text-[11px] font-semibold ${
                            consoleState === 'PLAYING' && slot
                              ? 'bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 cursor-pointer'
                              : 'bg-slate-950 text-slate-600 cursor-not-allowed'
                          }`}
                        >
                          Cargar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 4. Console Hardware Toggles (Pause, Reset, Sound, CRT Scanlines, Fullscreen) */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
              <button
                onClick={handleTogglePause}
                disabled={consoleState !== 'PLAYING'}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  consoleState === 'PLAYING'
                    ? 'border-slate-700 bg-slate-800 text-slate-100 cursor-pointer'
                    : 'border-slate-800 bg-slate-900 text-slate-600 cursor-not-allowed'
                }`}
              >
                {isPaused ? (
                  <>
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                    Reanudar
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5 text-amber-400" />
                    Pausar
                  </>
                )}
              </button>

              <button
                onClick={handleRestartRom}
                disabled={consoleState !== 'PLAYING'}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  consoleState === 'PLAYING'
                    ? 'border-slate-700 bg-slate-800 text-slate-100 cursor-pointer'
                    : 'border-slate-800 bg-slate-900 text-slate-600 cursor-not-allowed'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reiniciar
              </button>

              <button
                onClick={handleToggleSound}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  soundEnabled
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-slate-700 bg-slate-800 text-slate-400'
                }`}
              >
                {soundEnabled ? (
                  <>
                    <Volume2 className="w-3.5 h-3.5" />
                    Sonido ON
                  </>
                ) : (
                  <>
                    <VolumeX className="w-3.5 h-3.5" />
                    Silencio
                  </>
                )}
              </button>

              <button
                onClick={() => setCrtScanlines(!crtScanlines)}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  crtScanlines
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                    : 'border-slate-700 bg-slate-800 text-slate-400'
                }`}
              >
                <Tv className="w-3.5 h-3.5" />
                Scanlines
              </button>

              <button
                onClick={handleFullscreen}
                className="col-span-2 sm:col-span-1 py-2.5 px-3 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Completa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-ROM Archive Picker Modal (.zip / .7z with multiple ROM files inside) */}
      {isArchivePickerOpen && archiveEntries.length > 0 && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-lg w-full rounded-2xl border border-slate-700 bg-[#121620] shadow-2xl overflow-hidden flex flex-col max-h-[82dvh]">
            <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-800 bg-slate-900">
              <div className="flex items-center gap-2.5 min-w-0">
                <Archive className="w-5 h-5 text-sky-400 shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-100 truncate">
                    Selecciona qué ROM ejecutar
                  </h2>
                  <p className="text-xs text-slate-400 font-mono truncate">
                    {archiveFileName} ({archiveEntries.length} ROMs)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsArchivePickerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2">
              {archiveEntries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => bootExtractedRomEntry(entry)}
                  className="w-full text-left flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-800 bg-slate-900/70 hover:bg-slate-800 hover:border-sky-500/50 transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-100 truncate">
                      {entry.fileName}
                    </div>
                    <div className="text-[11px] font-mono text-sky-400 mt-0.5">
                      {getSystemBadgeLabel(entry.system)} ·{' '}
                      {Math.max(1, Math.round(entry.sizeBytes / 1024))} KB
                    </div>
                  </div>
                  <span className="px-3 py-1.5 text-xs font-bold rounded-lg bg-sky-400 text-slate-950 shrink-0">
                    Jugar
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
