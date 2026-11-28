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
  Camera,
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
import {
  getAudioEngineStatus,
  inspectAndBoostEmscriptenAudio,
  installSegaAudioBridge,
  setMasterAudioSettings,
  unlockAndResumeAudioContexts,
} from './wasm/segaAudioBridge';

import {
  applyKeyboardPreset,
  assignGamepadBinding,
  assignKeyboardBinding,
  DEFAULT_GAMEPAD_BINDINGS,
  DEFAULT_KEYBOARD_BINDINGS,
  formatGamepadBindingLabel,
  formatKeyboardCodeLabel,
  GamepadBinding,
  GENESIS_PLUS_GX_DEVICE_MDPAD_3B,
  GENESIS_PLUS_GX_DEVICE_MDPAD_6B,
  getActionLabel,
  getRetroArchKeySpec,
  InputBindingsProfile,
  isGamepadBindingActive,
  KeyboardPresetId,
  loadInputBindingsProfile,
  MD_BUTTON_LIST,
  MdButton,
  MdPadType,
  RETROARCH_INTERNAL_CODES,
  saveInputBindingsProfile,
  SIX_BUTTON_EXTRA_BUTTONS,
} from './input/inputBindings';
import {
  ControlsSettingsPanel,
  ListeningBindingTarget,
} from './components/ControlsSettingsPanel';

// Install global AudioContext & AudioNode.connect interceptor immediately on module load
installSegaAudioBridge();

type ConsoleState = 'IDLE_EMPTY' | 'EXTRACTING_ARCHIVE' | 'LOADING_ROM' | 'PLAYING';
type CoreMode = 'LIBRETRO_GENESIS_PLUS_GX' | 'LOCAL_WASM_ENGINE';
type DesktopSidebarTab = 'system' | 'controls';

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
  aspectRatio: number;
  aspectLabel: string;
  bufferWidth: number;
  bufferHeight: number;
}

const CONSOLE_OPTIONS: ConsoleOptionSpec[] = [
  {
    id: 'GAME_GEAR',
    name: 'SEGA Game Gear',
    shortLabel: 'Game Gear',
    bezelBrand: 'SEGA GAME GEAR',
    specLabel: '8-Bit Portátil · 2 Botones · LCD 160×144 (10:9)',
    preferredExt: 'gg',
    aspectRatio: 10 / 9,
    aspectLabel: '10:9',
    bufferWidth: 480,
    bufferHeight: 432,
  },
  {
    id: 'MASTER_SYSTEM',
    name: 'SEGA Master System',
    shortLabel: 'Master System',
    bezelBrand: 'SEGA MASTER SYSTEM',
    specLabel: '8-Bit · Mando 2 Botones · 256×192 (4:3 CRT)',
    preferredExt: 'sms',
    aspectRatio: 4 / 3,
    aspectLabel: '4:3',
    bufferWidth: 640,
    bufferHeight: 480,
  },
  {
    id: 'MEGA_DRIVE',
    name: 'SEGA Mega Drive / Genesis',
    shortLabel: 'Mega Drive',
    bezelBrand: 'SEGA MEGA DRIVE 16-BIT',
    specLabel: '16-Bit · Mando 3/6 Botones · 320×224 (4:3 CRT)',
    preferredExt: 'md',
    aspectRatio: 4 / 3,
    aspectLabel: '4:3',
    bufferWidth: 640,
    bufferHeight: 480,
  },
  {
    id: 'SG_1000',
    name: 'SEGA SG-1000',
    shortLabel: 'SG-1000',
    bezelBrand: 'SEGA SG-1000',
    specLabel: '8-Bit Clásico · 2 Botones · 256×192 (4:3 CRT)',
    preferredExt: 'sg',
    aspectRatio: 4 / 3,
    aspectLabel: '4:3',
    bufferWidth: 640,
    bufferHeight: 480,
  },
];

function getConsoleOptionSpec(system: SegaSystemKind): ConsoleOptionSpec {
  return CONSOLE_OPTIONS.find((c) => c.id === system) ?? CONSOLE_OPTIONS[0];
}



function detectIsMobileBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(
    ua
  );
  // iPadOS 13+ reports Macintosh UA with multi-touch points
  const isTouchTablet =
    typeof navigator !== 'undefined' &&
    navigator.maxTouchPoints > 1 &&
    Math.min(window.innerWidth, window.innerHeight) <= 1024;
  const isCoarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  // Also treat tablet & mobile preview widths (<= 1024px) as handheld mode so the 380px desktop sidebar never crushes the emulator screen
  const isTabletOrMobileViewport = window.innerWidth <= 1024;
  return isMobileUA || isTouchTablet || isCoarsePointer || isTabletOrMobileViewport;
}

const DEFAULT_GAME_GEAR_SOURCE_URL =
  'https://www.smspower.org/Homebrew/GGTurrican-GG';
const DEFAULT_GAME_GEAR_ROM_PATH = '/roms/GGTurrican.gg';
const DEFAULT_GAME_GEAR_ROM_FILENAME = 'GGTurrican.gg';
const DEFAULT_GAME_GEAR_ENTRY_ID = 'smspower-ggturrican-gg';

const DEFAULT_MASTER_SYSTEM_SOURCE_URL =
  'https://www.smspower.org/Homebrew/SilverValley-SMS';
const DEFAULT_MASTER_SYSTEM_ROM_PATH = '/roms/SilverValley.sms';
const DEFAULT_MASTER_SYSTEM_ROM_FILENAME = 'SilverValley.sms';
const DEFAULT_MASTER_SYSTEM_ENTRY_ID = 'smspower-silver-valley-sms';

const DEFAULT_MEGA_DRIVE_SOURCE_URL =
  'https://mxretrodev.itch.io/final-fight-md';
const DEFAULT_MEGA_DRIVE_ROM_PATH = '/roms/FinalFightMD.md';
const DEFAULT_MEGA_DRIVE_ROM_FILENAME = 'FinalFightMD.md';
const DEFAULT_MEGA_DRIVE_ENTRY_ID = 'itch-final-fight-md';

function isDefaultBundledRomEntry(entryId?: string): boolean {
  return (
    entryId === DEFAULT_GAME_GEAR_ENTRY_ID ||
    entryId === DEFAULT_MASTER_SYSTEM_ENTRY_ID ||
    entryId === DEFAULT_MEGA_DRIVE_ENTRY_ID
  );
}

export default function App() {
  // Detect mobile phone browser vs desktop computer browser
  const [isMobileDevice, setIsMobileDevice] = useState<boolean>(() =>
    detectIsMobileBrowser()
  );

  // On mobile phones default to GAME_GEAR; on desktop browsers default to MEGA_DRIVE
  const [activeSystem, setActiveSystem] = useState<SegaSystemKind>(() =>
    detectIsMobileBrowser() ? 'GAME_GEAR' : 'MEGA_DRIVE'
  );
  const [isLandscape, setIsLandscape] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  );

  // On mobile, configuration/selection menus are hidden behind the physical MENU button bottom sheet
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
  const [masterVolume, setMasterVolume] = useState<number>(90);
  const [psgBoost, setPsgBoost] = useState<number>(1.8);
  const [audioContextRunning, setAudioContextRunning] = useState<boolean>(false);

  const [crtScanlines, setCrtScanlines] = useState<boolean>(true);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState<boolean>(false);
  const [screenshotCapturedSuccess, setScreenshotCapturedSuccess] =
    useState<boolean>(false);
  const [isDraggingRom, setIsDraggingRom] = useState<boolean>(false);
  const [connectedGamepadName, setConnectedGamepadName] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(() =>
    detectIsMobileBrowser()
      ? 'Cargando ROM por defecto Game Gear (GGTurrican.gg)...'
      : 'Cargando ROM por defecto Mega Drive (FinalFightMD.md)...'
  );

  // Desktop sidebar tabs & customizable Keyboard / USB Controller bindings (persisted in localStorage)
  const [desktopSidebarTab, setDesktopSidebarTab] = useState<DesktopSidebarTab>('system');
  const [controlsDeviceTab, setControlsDeviceTab] = useState<'keyboard' | 'gamepad'>('keyboard');
  const [inputBindings, setInputBindings] = useState<InputBindingsProfile>(() =>
    loadInputBindingsProfile()
  );
  const [listeningBinding, setListeningBinding] = useState<ListeningBindingTarget | null>(null);
  const [bindingFeedback, setBindingFeedback] = useState<string | null>(null);

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

  // Computed fitted screen box (maximizes 10:9 Game Gear or 4:3 CRT TV inside the black stage)
  const [fittedScreenBox, setFittedScreenBox] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isDesktopFullscreen, setIsDesktopFullscreen] = useState<boolean>(false);

  const screenStageRef = useRef<HTMLDivElement | null>(null);
  const screenResizeObserverRef = useRef<ResizeObserver | null>(null);
  const emulatorMountRef = useRef<HTMLDivElement | null>(null);
  const activeWebglCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const localCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellContainerRef = useRef<HTMLDivElement | null>(null);
  const desktopAsideRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentRomEntryRef = useRef<ExtractedRomEntry | null>(null);
  const isBuiltinDemoActiveRef = useRef<boolean>(false);
  const hasAutoBootedDefaultRomRef = useRef<boolean>(false);
  const bootRequestIdRef = useRef<number>(0);
  const bootAbortControllerRef = useRef<AbortController | null>(null);
  const nostalgistRef = useRef<Nostalgist | null>(null);
  const localWasmRef = useRef<WasmRuntimeInstance | null>(null);
  const localEngineRef = useRef<GearsystemEngine | null>(null);
  const coreModeRef = useRef<CoreMode>('LIBRETRO_GENESIS_PLUS_GX');
  const activeSystemRef = useRef<SegaSystemKind>(activeSystem);
  const soundEnabledRef = useRef<boolean>(true);
  const masterVolumeRef = useRef<number>(90);
  const psgBoostRef = useRef<number>(1.8);
  const isDesktopFullscreenRef = useRef<boolean>(false);

  const inputBindingsRef = useRef<InputBindingsProfile>(inputBindings);
  const listeningBindingRef = useRef<ListeningBindingTarget | null>(null);
  const connectedGamepadNameRef = useRef<string | null>(null);
  const desktopSidebarTabRef = useRef<DesktopSidebarTab>('system');
  const heldKeyboardButtonsRef = useRef<Set<MdButton>>(new Set());
  const bindingFeedbackTimerRef = useRef<number | null>(null);
  const screenshotFeedbackTimerRef = useRef<number | null>(null);
  const gamepadCaptureBaselineRef = useRef<{
    buttons: Set<number>;
    axes: Set<string>;
  }>({ buttons: new Set(), axes: new Set() });

  useEffect(() => {
    isDesktopFullscreenRef.current = isDesktopFullscreen;
  }, [isDesktopFullscreen]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && isDesktopFullscreenRef.current) {
        isDesktopFullscreenRef.current = false;
        setIsDesktopFullscreen(false);
      }
      window.requestAnimationFrame(() => {
        resizeActiveEmulatorViewport();
      });
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    coreModeRef.current = coreMode;
  }, [coreMode]);

  useEffect(() => {
    activeSystemRef.current = activeSystem;
  }, [activeSystem]);

  useEffect(() => {
    inputBindingsRef.current = inputBindings;
  }, [inputBindings]);

  useEffect(() => {
    desktopSidebarTabRef.current = desktopSidebarTab;
  }, [desktopSidebarTab]);

  useEffect(() => {
    if (isMobileDevice && !isBottomMenuOpen && listeningBindingRef.current) {
      listeningBindingRef.current = null;
      setListeningBinding(null);
    }
  }, [isMobileDevice, isBottomMenuOpen]);

  useEffect(() => {
    return () => {
      if (bindingFeedbackTimerRef.current !== null) {
        window.clearTimeout(bindingFeedbackTimerRef.current);
      }
      if (screenshotFeedbackTimerRef.current !== null) {
        window.clearTimeout(screenshotFeedbackTimerRef.current);
      }
    };
  }, []);

  const showBindingFeedback = (message: string) => {
    setBindingFeedback(message);
    if (bindingFeedbackTimerRef.current !== null) {
      window.clearTimeout(bindingFeedbackTimerRef.current);
    }
    bindingFeedbackTimerRef.current = window.setTimeout(() => {
      setBindingFeedback(null);
      bindingFeedbackTimerRef.current = null;
    }, 3200);
  };

  const commitInputBindings = (nextProfile: InputBindingsProfile, feedback: string) => {
    inputBindingsRef.current = nextProfile;
    setInputBindings(nextProfile);
    const saved = saveInputBindingsProfile(nextProfile);
    showBindingFeedback(saved ? feedback : `${feedback} (solo esta sesión)`);
  };

  const cancelListeningForBinding = () => {
    listeningBindingRef.current = null;
    setListeningBinding(null);
  };

  const startListeningForBinding = (device: 'keyboard' | 'gamepad', button: MdButton) => {
    // Release any currently held keyboard buttons before entering capture mode
    heldKeyboardButtonsRef.current.forEach((heldBtn) => {
      triggerButtonState(heldBtn, false);
    });
    heldKeyboardButtonsRef.current.clear();

    if (device === 'gamepad') {
      const baselineButtons = new Set<number>();
      const baselineAxes = new Set<string>();
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = pads[0] || pads[1] || pads[2] || pads[3];
      if (gp) {
        gp.buttons.forEach((b, idx) => {
          if (b && (b.pressed || b.value > 0.5)) {
            baselineButtons.add(idx);
          }
        });
        gp.axes.forEach((val, idx) => {
          if (val > 0.55) baselineAxes.add(`${idx}:1`);
          if (val < -0.55) baselineAxes.add(`${idx}:-1`);
        });
      }
      gamepadCaptureBaselineRef.current = {
        buttons: baselineButtons,
        axes: baselineAxes,
      };
    }

    const nextTarget: ListeningBindingTarget = { device, button };
    listeningBindingRef.current = nextTarget;
    setListeningBinding(nextTarget);
  };

  const handleChangeDesktopSidebarTab = (tab: DesktopSidebarTab) => {
    cancelListeningForBinding();
    setIsConsoleDropdownOpen(false);
    setDesktopSidebarTab(tab);
  };

  const handleChangeControlsDeviceTab = (tab: 'keyboard' | 'gamepad') => {
    cancelListeningForBinding();
    setControlsDeviceTab(tab);
  };

  const handleApplyKeyboardPreset = (preset: KeyboardPresetId) => {
    cancelListeningForBinding();
    const nextProfile = applyKeyboardPreset(inputBindingsRef.current, preset);
    const label = preset === 'wasd' ? 'WASD + J/K/L' : 'Clásico (Flechas + Z/X/C)';
    commitInputBindings(nextProfile, `Perfil ${label} guardado`);
  };

  const handleResetCurrentDeviceBindings = () => {
    cancelListeningForBinding();
    if (controlsDeviceTab === 'keyboard') {
      const nextProfile: InputBindingsProfile = {
        ...inputBindingsRef.current,
        keyboard: { ...DEFAULT_KEYBOARD_BINDINGS },
      };
      commitInputBindings(nextProfile, 'Teclado restablecido por defecto');
    } else {
      const nextGamepad = {} as Record<MdButton, GamepadBinding>;
      for (const btn of MD_BUTTON_LIST) {
        nextGamepad[btn] = { ...DEFAULT_GAMEPAD_BINDINGS[btn] };
      }
      const nextProfile: InputBindingsProfile = {
        ...inputBindingsRef.current,
        gamepad: nextGamepad,
        gamepadUseLeftStick: true,
      };
      commitInputBindings(nextProfile, 'Mando USB restablecido por defecto');
    }
  };

  const handleToggleGamepadLeftStick = (enabled: boolean) => {
    const nextProfile: InputBindingsProfile = {
      ...inputBindingsRef.current,
      gamepadUseLeftStick: enabled,
    };
    commitInputBindings(
      nextProfile,
      enabled
        ? 'Stick analógico izquierdo activado'
        : 'Stick analógico izquierdo desactivado'
    );
  };

  const syncEmscriptenControllerPortDevice = (
    instance: Nostalgist | null,
    system: SegaSystemKind,
    padType: MdPadType
  ) => {
    if (!instance || system !== 'MEGA_DRIVE') return;
    const deviceId =
      padType === '6button'
        ? GENESIS_PLUS_GX_DEVICE_MDPAD_6B
        : GENESIS_PLUS_GX_DEVICE_MDPAD_3B;
    try {
      const emModule = instance.getEmscriptenModule() as unknown as {
        _retro_set_controller_port_device?: (port: number, device: number) => void;
      };
      if (typeof emModule?._retro_set_controller_port_device === 'function') {
        emModule._retro_set_controller_port_device(0, deviceId);
      }
    } catch {
      // ignore if core has not initialized port callback yet
    }
  };

  const handleChangeMdPadType = (nextPadType: MdPadType) => {
    if (
      nextPadType === '3button' &&
      listeningBindingRef.current &&
      SIX_BUTTON_EXTRA_BUTTONS.includes(listeningBindingRef.current.button)
    ) {
      cancelListeningForBinding();
    }
    if (nextPadType === '3button') {
      for (const extraBtn of SIX_BUTTON_EXTRA_BUTTONS) {
        heldKeyboardButtonsRef.current.delete(extraBtn);
        triggerButtonState(extraBtn, false);
      }
    }
    const nextProfile: InputBindingsProfile = {
      ...inputBindingsRef.current,
      mdPadType: nextPadType,
    };
    syncEmscriptenControllerPortDevice(
      nostalgistRef.current,
      activeSystemRef.current,
      nextPadType
    );
    commitInputBindings(
      nextProfile,
      nextPadType === '3button'
        ? 'Mando Mega Drive de 3 botones (A · B · C) activado'
        : 'Mando Mega Drive de 6 botones (A-Z + MODE) activado'
    );
  };

  const handleOpenGamepadReconfigFromMenu = () => {
    cancelListeningForBinding();
    setIsConsoleDropdownOpen(false);
    setControlsDeviceTab('gamepad');
    setDesktopSidebarTab('controls');
  };

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
    setMasterAudioSettings({
      enabled: shouldPlay,
      volumePercent: masterVolumeRef.current,
      psgBoost: psgBoostRef.current,
    });
    if (nostalgistRef.current) {
      inspectAndBoostEmscriptenAudio(nostalgistRef.current);
    } else if (shouldPlay) {
      unlockAndResumeAudioContexts();
    }
    setAudioContextRunning(getAudioEngineStatus().isRunning);
  };

  const applyWebglCanvasFullBounds = (webglCanvas: HTMLCanvasElement) => {
    webglCanvas.style.position = 'absolute';
    webglCanvas.style.top = '0px';
    webglCanvas.style.left = '0px';
    webglCanvas.style.right = '0px';
    webglCanvas.style.bottom = '0px';
    webglCanvas.style.inset = '0px';
    webglCanvas.style.margin = '0px';
    webglCanvas.style.padding = '0px';
    webglCanvas.style.transform = 'none';
    webglCanvas.style.width = '100%';
    webglCanvas.style.height = '100%';
    webglCanvas.style.display = 'block';
  };

  const updateFittedScreenBox = (systemOverride?: SegaSystemKind) => {
    const stageNode = screenStageRef.current;
    if (!stageNode) return;
    const rect = stageNode.getBoundingClientRect();
    const availWidth = rect.width;
    const availHeight = rect.height;
    if (availWidth <= 0 || availHeight <= 0) return;

    const targetSpec = getConsoleOptionSpec(systemOverride ?? activeSystemRef.current);
    const targetAspect = targetSpec.aspectRatio;

    let fitWidth = availWidth;
    let fitHeight = fitWidth / targetAspect;
    if (fitHeight > availHeight) {
      fitHeight = availHeight;
      fitWidth = fitHeight * targetAspect;
    }

    const nextWidth = Math.max(1, Math.round(fitWidth));
    const nextHeight = Math.max(1, Math.round(fitHeight));

    setFittedScreenBox((prev) =>
      prev && prev.width === nextWidth && prev.height === nextHeight
        ? prev
        : { width: nextWidth, height: nextHeight }
    );
  };

  const handleScreenStageRef = (node: HTMLDivElement | null) => {
    if (screenResizeObserverRef.current) {
      screenResizeObserverRef.current.disconnect();
      screenResizeObserverRef.current = null;
    }
    screenStageRef.current = node;
    if (node) {
      updateFittedScreenBox();
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          updateFittedScreenBox();
          ensureWebglCanvasAttached();
        });
        ro.observe(node);
        screenResizeObserverRef.current = ro;
      }
    }
  };

  useEffect(() => {
    return () => {
      if (screenResizeObserverRef.current) {
        screenResizeObserverRef.current.disconnect();
        screenResizeObserverRef.current = null;
      }
    };
  }, []);

  const ensureWebglCanvasAttached = () => {
    const mountNode = emulatorMountRef.current;
    const webglCanvas = activeWebglCanvasRef.current;
    if (mountNode && webglCanvas) {
      if (!mountNode.contains(webglCanvas)) {
        mountNode.innerHTML = '';
        mountNode.appendChild(webglCanvas);
      }
      applyWebglCanvasFullBounds(webglCanvas);
    }
  };

  const handleEmulatorMountRef = (node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }
    emulatorMountRef.current = node;
    if (activeWebglCanvasRef.current) {
      if (!node.contains(activeWebglCanvasRef.current)) {
        node.innerHTML = '';
        node.appendChild(activeWebglCanvasRef.current);
      }
      applyWebglCanvasFullBounds(activeWebglCanvasRef.current);
    }
  };

  const resizeActiveEmulatorViewport = () => {
    updateFittedScreenBox();
    ensureWebglCanvasAttached();
  };

  // Seamless WebGL canvas transfer and native aspect ratio recalculation when switching console, orientation, mobile/tablet/desktop layout, or console state
  useEffect(() => {
    updateFittedScreenBox(activeSystem);
    ensureWebglCanvasAttached();
    const rafId = window.requestAnimationFrame(() => {
      updateFittedScreenBox(activeSystem);
      ensureWebglCanvasAttached();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [activeSystem, isLandscape, isMobileDevice, consoleState, coreMode]);

  // Global silent mobile gesture unlock & visibility recovery for AudioContext
  useEffect(() => {
    installSegaAudioBridge();
    setMasterAudioSettings({
      enabled: soundEnabledRef.current,
      volumePercent: masterVolumeRef.current,
      psgBoost: psgBoostRef.current,
    });

    const handleUserGestureUnlock = () => {
      if (soundEnabledRef.current) {
        if (nostalgistRef.current) {
          inspectAndBoostEmscriptenAudio(nostalgistRef.current);
        } else {
          unlockAndResumeAudioContexts();
        }
        setAudioContextRunning(getAudioEngineStatus().isRunning);
      }
    };

    const handleVisibilityRecovery = () => {
      if (document.visibilityState === 'visible' && soundEnabledRef.current) {
        handleUserGestureUnlock();
      }
    };

    window.addEventListener('touchstart', handleUserGestureUnlock, { capture: true, passive: true });
    window.addEventListener('pointerdown', handleUserGestureUnlock, { capture: true, passive: true });
    window.addEventListener('click', handleUserGestureUnlock, { capture: true });
    document.addEventListener('visibilitychange', handleVisibilityRecovery);

    return () => {
      window.removeEventListener('touchstart', handleUserGestureUnlock, { capture: true });
      window.removeEventListener('pointerdown', handleUserGestureUnlock, { capture: true });
      window.removeEventListener('click', handleUserGestureUnlock, { capture: true });
      document.removeEventListener('visibilitychange', handleVisibilityRecovery);
    };
  }, []);

  // Periodic watchdog while PLAYING so any lazily-created Emscripten AudioContext is unlocked & boosted
  useEffect(() => {
    if (consoleState !== 'PLAYING') return;
    const timer = window.setInterval(() => {
      if (nostalgistRef.current && soundEnabledRef.current) {
        inspectAndBoostEmscriptenAudio(nostalgistRef.current);
      }
      setAudioContextRunning(getAudioEngineStatus().isRunning);
    }, 600);
    return () => window.clearInterval(timer);
  }, [consoleState]);

  // Track orientation & viewport resize dynamically across Chrome/Safari on Android, iOS & Desktop
  useEffect(() => {
    const updateViewportAndOrientation = () => {
      const w = window.visualViewport ? window.visualViewport.width : window.innerWidth;
      const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      setIsLandscape(w > h);
      setIsMobileDevice(detectIsMobileBrowser());
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

  // USB / Bluetooth Gamepad Connection, Custom Remapping Capture & 60Hz Polling
  useEffect(() => {
    const onGamepadConnected = (e: GamepadEvent) => {
      connectedGamepadNameRef.current = e.gamepad.id;
      setConnectedGamepadName(e.gamepad.id);
      setStatusMessage(`Gamepad conectado: ${e.gamepad.id}`);
    };
    const onGamepadDisconnected = () => {
      connectedGamepadNameRef.current = null;
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
        if (connectedGamepadNameRef.current !== gp.id) {
          connectedGamepadNameRef.current = gp.id;
          setConnectedGamepadName(gp.id);
        }

        const listening = listeningBindingRef.current;
        if (listening && listening.device === 'gamepad') {
          const baseline = gamepadCaptureBaselineRef.current;

          // Clear baseline entries once released so the user can re-press the same input
          baseline.buttons.forEach((idx) => {
            const b = gp.buttons[idx];
            if (!b || (!b.pressed && b.value <= 0.3)) {
              baseline.buttons.delete(idx);
            }
          });
          baseline.axes.forEach((key) => {
            const [idxStr, dirStr] = key.split(':');
            const val = gp.axes[Number(idxStr)] ?? 0;
            const dir = Number(dirStr);
            if ((dir > 0 && val < 0.3) || (dir < 0 && val > -0.3)) {
              baseline.axes.delete(key);
            }
          });

          let captured: GamepadBinding | null = null;
          for (let i = 0; i < gp.buttons.length; i++) {
            const b = gp.buttons[i];
            if (b && (b.pressed || b.value > 0.55) && !baseline.buttons.has(i)) {
              captured = { type: 'button', index: i };
              break;
            }
          }

          if (!captured) {
            for (let a = 0; a < gp.axes.length; a++) {
              const val = gp.axes[a] ?? 0;
              if (val > 0.68 && !baseline.axes.has(`${a}:1`)) {
                captured = { type: 'axis', index: a, direction: 1 };
                break;
              }
              if (val < -0.68 && !baseline.axes.has(`${a}:-1`)) {
                captured = { type: 'axis', index: a, direction: -1 };
                break;
              }
            }
          }

          if (captured) {
            const { nextProfile, swappedWith } = assignGamepadBinding(
              inputBindingsRef.current,
              listening.button,
              captured
            );
            listeningBindingRef.current = null;
            setListeningBinding(null);
            const targetName = getActionLabel(listening.button);
            const msg = swappedWith
              ? `${targetName} asignado (intercambiado con ${getActionLabel(swappedWith)})`
              : `${targetName} guardado en el navegador`;
            commitInputBindings(nextProfile, msg);
          }

          rafId = requestAnimationFrame(pollGamepad);
          return;
        }

        const profile = inputBindingsRef.current;
        const axisX = gp.axes[0] ?? 0;
        const axisY = gp.axes[1] ?? 0;

        for (const btn of MD_BUTTON_LIST) {
          const isDisabledExtra =
            profile.mdPadType !== '6button' && SIX_BUTTON_EXTRA_BUTTONS.includes(btn);
          let isActive = isDisabledExtra
            ? false
            : isGamepadBindingActive(gp, profile.gamepad[btn]);
          if (!isDisabledExtra && profile.gamepadUseLeftStick) {
            if (btn === 'up' && axisY < -0.45) isActive = true;
            if (btn === 'down' && axisY > 0.45) isActive = true;
            if (btn === 'left' && axisX < -0.45) isActive = true;
            if (btn === 'right' && axisX > 0.45) isActive = true;
          }

          if (isActive !== prevGpState[btn]) {
            prevGpState[btn] = isActive;
            triggerButtonState(btn, isActive);
          }
        }
      }

      rafId = requestAnimationFrame(pollGamepad);
    };

    rafId = requestAnimationFrame(pollGamepad);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
    };
  }, []);

  // Capture-phase Keyboard Listener: live custom remapping + zero-restart translation to RetroArch & Local WASM
  useEffect(() => {
    const findMappedButton = (code: string): MdButton | null => {
      const kb = inputBindingsRef.current.keyboard;
      for (const btn of MD_BUTTON_LIST) {
        if (kb[btn] === code) return btn;
      }
      return null;
    };

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    };

    const isSidebarButtonActivation = (code: string): boolean => {
      if (desktopSidebarTabRef.current !== 'controls') return false;
      const active = document.activeElement;
      if (
        active instanceof HTMLButtonElement &&
        desktopAsideRef.current?.contains(active) &&
        (code === 'Enter' || code === 'Space' || code === 'Tab')
      ) {
        return true;
      }
      return false;
    };

    const releaseAllHeldKeys = () => {
      heldKeyboardButtonsRef.current.forEach((btn) => {
        triggerButtonState(btn, false);
      });
      heldKeyboardButtonsRef.current.clear();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // 1. Capture mode for key/gamepad remapping
      const listening = listeningBindingRef.current;
      if (listening) {
        e.preventDefault();
        e.stopImmediatePropagation();

        if (e.code === 'Escape') {
          cancelListeningForBinding();
          return;
        }

        if (listening.device === 'keyboard' && !e.repeat && e.code) {
          const { nextProfile, swappedWith } = assignKeyboardBinding(
            inputBindingsRef.current,
            listening.button,
            e.code
          );
          listeningBindingRef.current = null;
          setListeningBinding(null);
          const targetName = getActionLabel(listening.button);
          const msg = swappedWith
            ? `${targetName} → ${formatKeyboardCodeLabel(e.code)} (intercambiado con ${getActionLabel(swappedWith)})`
            : `${targetName} → ${formatKeyboardCodeLabel(e.code)} guardado`;
          commitInputBindings(nextProfile, msg);
        }
        return;
      }

      if (soundEnabledRef.current) {
        syncAllAudioContexts(true);
      }

      if (e.key === 'Escape' || e.code === 'Escape') {
        if (isDesktopFullscreenRef.current) {
          isDesktopFullscreenRef.current = false;
          setIsDesktopFullscreen(false);
        }
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
        setIsBottomMenuOpen(false);
        setIsConsoleDropdownOpen(false);
        return;
      }

      if (isEditableTarget(e.target) || isSidebarButtonActivation(e.code)) {
        return;
      }

      const btn = findMappedButton(e.code);
      const isInternalRetroKey = RETROARCH_INTERNAL_CODES.has(e.code);

      if (btn || (nostalgistRef.current && isInternalRetroKey)) {
        // Intercept before Emscripten's bubble-phase listener so remapped keys never double-fire
        e.stopImmediatePropagation();
      }

      if (btn) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
          e.preventDefault();
        }
        if (!e.repeat) {
          heldKeyboardButtonsRef.current.add(btn);
          triggerButtonState(btn, true);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (listeningBindingRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (isEditableTarget(e.target) || isSidebarButtonActivation(e.code)) {
        return;
      }

      const btn = findMappedButton(e.code);
      const isInternalRetroKey = RETROARCH_INTERNAL_CODES.has(e.code);

      if (btn || (nostalgistRef.current && isInternalRetroKey)) {
        e.stopImmediatePropagation();
      }

      if (btn) {
        heldKeyboardButtonsRef.current.delete(btn);
        triggerButtonState(btn, false);
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', releaseAllHeldKeys);
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', releaseAllHeldKeys);
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
    let cachedCanvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let imgData: ImageData | null = null;

    const loop = () => {
      const engine = localEngineRef.current;
      const currentCanvas = localCanvasRef.current;
      if (currentCanvas && currentCanvas !== cachedCanvas) {
        cachedCanvas = currentCanvas;
        ctx = currentCanvas.getContext('2d', { alpha: false });
        imgData = ctx ? ctx.createImageData(256, 192) : null;
      }
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
  }, [consoleState, coreMode, isPaused, isLandscape, isMobileDevice]);

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
    if (
      pressed &&
      inputBindingsRef.current.mdPadType !== '6button' &&
      SIX_BUTTON_EXTRA_BUTTONS.includes(btn)
    ) {
      return;
    }
    if (pressed && soundEnabledRef.current) {
      syncAllAudioContexts(true);
    }
    updateLocalAndVisualButton(btn, pressed);

    const keySpec = getRetroArchKeySpec(
      btn,
      isEightBitSystem(activeSystemRef.current)
    );
    if (keySpec && coreModeRef.current === 'LIBRETRO_GENESIS_PLUS_GX') {
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
    if (bootAbortControllerRef.current) {
      try {
        bootAbortControllerRef.current.abort();
      } catch {
        // ignore
      }
      bootAbortControllerRef.current = null;
    }
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

  const createFreshEmulatorCanvas = (
    targetSystem: SegaSystemKind
  ): {
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
  } => {
    const container = emulatorMountRef.current;
    if (!container) {
      throw new Error('Emulator screen mount not ready');
    }
    container.innerHTML = '';

    // Use the target console's native aspect ratio WebGL buffer (480x432 for 10:9 Game Gear,
    // 640x480 for 4:3 CRT consoles) and lock default-framebuffer WebGL viewport/scissor to
    // (0, 0, canvas.width, canvas.height) so WebGL's bottom-left (0,0) origin or RetroArch's
    // internal ResizeObserver never shift or distort the rendered frame.
    const targetSpec = getConsoleOptionSpec(targetSystem);
    const width = targetSpec.bufferWidth;
    const height = targetSpec.bufferHeight;

    const freshCanvas = document.createElement('canvas');
    freshCanvas.width = width;
    freshCanvas.height = height;
    freshCanvas.className = 'pixelated absolute inset-0 w-full h-full object-fill block';
    applyWebglCanvasFullBounds(freshCanvas);
    freshCanvas.tabIndex = -1;

    const origGetContext = freshCanvas.getContext.bind(freshCanvas);
    let patchedGlViewport = false;
    freshCanvas.getContext = ((contextId: string, options?: unknown) => {
      const ctx = origGetContext(contextId as never, options as never) as
        | WebGLRenderingContext
        | WebGL2RenderingContext
        | null;
      if (
        ctx &&
        !patchedGlViewport &&
        (contextId === 'webgl' ||
          contextId === 'webgl2' ||
          contextId === 'experimental-webgl')
      ) {
        patchedGlViewport = true;
        const origViewport = ctx.viewport.bind(ctx);
        const origScissor = ctx.scissor.bind(ctx);

        ctx.viewport = (x: number, y: number, w: number, h: number) => {
          try {
            if (ctx.getParameter(ctx.FRAMEBUFFER_BINDING) === null) {
              origViewport(0, 0, freshCanvas.width || width, freshCanvas.height || height);
              return;
            }
          } catch {
            // fallback to default behavior
          }
          origViewport(x, y, w, h);
        };

        ctx.scissor = (x: number, y: number, w: number, h: number) => {
          try {
            if (ctx.getParameter(ctx.FRAMEBUFFER_BINDING) === null) {
              origScissor(0, 0, freshCanvas.width || width, freshCanvas.height || height);
              return;
            }
          } catch {
            // fallback to default behavior
          }
          origScissor(x, y, w, h);
        };
      }
      return ctx;
    }) as typeof freshCanvas.getContext;

    container.appendChild(freshCanvas);
    activeWebglCanvasRef.current = freshCanvas;

    return { canvas: freshCanvas, width, height };
  };

  const launchNostalgistWithCore = async (
    coreName: 'genesis_plus_gx' | 'gearsystem',
    forcedFileName: string,
    romBlob: Blob,
    targetSystem: SegaSystemKind,
    signal?: AbortSignal
  ): Promise<Nostalgist> => {
    updateFittedScreenBox(targetSystem);
    const { canvas, width, height } = createFreshEmulatorCanvas(targetSystem);

    const retroarchCoreConfig: Record<string, string> =
      coreName === 'genesis_plus_gx'
        ? {
            genesis_plus_gx_system_hw:
              targetSystem === 'GAME_GEAR'
                ? 'game gear'
                : targetSystem === 'SG_1000'
                ? 'sg-1000'
                : 'auto',
            genesis_plus_gx_sound_output: 'stereo',
            genesis_plus_gx_psg_preamp: '150',
            genesis_plus_gx_ym2413: 'auto',
            genesis_plus_gx_lcd_filter: 'disabled',
            genesis_plus_gx_overscan: 'disabled',
            genesis_plus_gx_gg_extra: 'disabled',
          }
        : {};

    const persistedProfile = loadInputBindingsProfile();
    const resolvedPadType: MdPadType =
      persistedProfile.mdPadType ?? inputBindingsRef.current.mdPadType ?? '3button';
    if (inputBindingsRef.current.mdPadType !== resolvedPadType) {
      inputBindingsRef.current = {
        ...inputBindingsRef.current,
        mdPadType: resolvedPadType,
      };
    }

    const mdPort1DeviceId =
      targetSystem === 'MEGA_DRIVE'
        ? resolvedPadType === '6button'
          ? GENESIS_PLUS_GX_DEVICE_MDPAD_6B
          : GENESIS_PLUS_GX_DEVICE_MDPAD_3B
        : 1;

    const instance = await Nostalgist.launch({
      core: coreName,
      // CRITICAL: Pass { fileName, fileContent } object so Nostalgist preserves .gg / .sms / .sg / .md extension!
      rom: {
        fileName: forcedFileName,
        fileContent: romBlob,
      },
      element: canvas,
      size: { width, height },
      signal,
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
        // Disable RetroArch's built-in joypad auto-binding so our custom USB/BT bindings handle gamepad input cleanly
        input_autodetect_enable: false,
        input_libretro_device_p1: mdPort1DeviceId,
        input_libretro_device_p2: mdPort1DeviceId,
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
        // Always initialize RetroArch audio driver active; Master GainNode controls live mute/volume
        audio_enable: true,
        audio_mute_enable: false,
        audio_sync: true,
        audio_volume: 6.0,
        audio_out_rate: 48000,
        audio_latency: 64,
        video_aspect_ratio_auto: false,
        aspect_ratio_index: 0,
      },
    });

    syncEmscriptenControllerPortDevice(
      instance,
      targetSystem,
      resolvedPadType
    );

    return instance;
  };

  const bootExtractedRomEntry = async (
    entry: ExtractedRomEntry,
    forcedSystem?: SegaSystemKind
  ) => {
    const requestId = ++bootRequestIdRef.current;
    const hadPreviousInstance = Boolean(
      nostalgistRef.current || bootAbortControllerRef.current
    );
    cleanupActiveInstance();

    const abortController = new AbortController();
    bootAbortControllerRef.current = abortController;

    setIsArchivePickerOpen(false);
    setIsBottomMenuOpen(false);
    setCoreMode('LIBRETRO_GENESIS_PLUS_GX');
    setConsoleState('LOADING_ROM');
    setIsPaused(false);

    // Pre-unlock AudioContext synchronously while inside user selection gesture
    if (soundEnabledRef.current) {
      unlockAndResumeAudioContexts();
    }

    const targetSystem = forcedSystem ?? entry.system;
    activeSystemRef.current = targetSystem;
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

    if (hadPreviousInstance) {
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      if (requestId !== bootRequestIdRef.current || abortController.signal.aborted) {
        return;
      }
    }

    try {
      let instance: Nostalgist;
      try {
        instance = await launchNostalgistWithCore(
          'genesis_plus_gx',
          forcedFileName,
          romBlob,
          targetSystem,
          abortController.signal
        );
      } catch (primaryErr) {
        if (requestId !== bootRequestIdRef.current || abortController.signal.aborted) {
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 60));
        if (requestId !== bootRequestIdRef.current || abortController.signal.aborted) {
          return;
        }
        try {
          instance = await launchNostalgistWithCore(
            'genesis_plus_gx',
            forcedFileName,
            romBlob,
            targetSystem,
            abortController.signal
          );
        } catch {
          if (requestId !== bootRequestIdRef.current || abortController.signal.aborted) {
            return;
          }
          if (isEightBitSystem(targetSystem)) {
            instance = await launchNostalgistWithCore(
              'gearsystem',
              forcedFileName,
              romBlob,
              targetSystem,
              abortController.signal
            );
          } else {
            throw primaryErr;
          }
        }
      }

      if (requestId !== bootRequestIdRef.current || abortController.signal.aborted) {
        try {
          instance.exit({ removeCanvas: true });
        } catch {
          // ignore
        }
        return;
      }

      if (bootAbortControllerRef.current === abortController) {
        bootAbortControllerRef.current = null;
      }
      nostalgistRef.current = instance;
      syncEmscriptenControllerPortDevice(
        instance,
        targetSystem,
        inputBindingsRef.current.mdPadType
      );
      ensureWebglCanvasAttached();
      setCoreMode('LIBRETRO_GENESIS_PLUS_GX');
      setConsoleState('PLAYING');
      setStatusMessage(`${entry.fileName} · ${targetSpec.shortLabel}`);

      inspectAndBoostEmscriptenAudio(instance);
      requestAnimationFrame(() => {
        syncEmscriptenControllerPortDevice(
          instance,
          targetSystem,
          inputBindingsRef.current.mdPadType
        );
        ensureWebglCanvasAttached();
        resizeActiveEmulatorViewport();
        syncAllAudioContexts(soundEnabledRef.current);
      });
    } catch {
      if (requestId !== bootRequestIdRef.current || abortController.signal.aborted) {
        return;
      }
      bootLocalWasmFallback(entry.fileName, cleanRomBytes, targetSystem);
    }
  };

  const bootDefaultGameGearItchRom = async () => {
    cleanupActiveInstance();
    const fetchCheckId = bootRequestIdRef.current;
    setIsBottomMenuOpen(false);
    setActiveSystem('GAME_GEAR');
    setConsoleState('LOADING_ROM');
    setLoadedRomTitle(DEFAULT_GAME_GEAR_ROM_FILENAME);
    setStatusMessage('Cargando GG Turrican (Game Gear · SMS Power)...');

    try {
      const response = await fetch(encodeURI(DEFAULT_GAME_GEAR_ROM_PATH));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (fetchCheckId !== bootRequestIdRef.current) return;
      const romBytes = new Uint8Array(arrayBuffer);

      const defaultEntry: ExtractedRomEntry = {
        id: DEFAULT_GAME_GEAR_ENTRY_ID,
        fileName: DEFAULT_GAME_GEAR_ROM_FILENAME,
        fullPath: DEFAULT_GAME_GEAR_SOURCE_URL,
        extension: 'gg',
        system: 'GAME_GEAR',
        sizeBytes: romBytes.byteLength,
        data: romBytes,
      };

      await bootExtractedRomEntry(defaultEntry, 'GAME_GEAR');
    } catch {
      if (fetchCheckId !== bootRequestIdRef.current) return;
      const demo = BUILTIN_CARTRIDGES[2];
      bootLocalWasmFallback(demo.title, demo.data, 'GAME_GEAR');
    }
  };

  const bootDefaultMasterSystemRom = async () => {
    cleanupActiveInstance();
    const fetchCheckId = bootRequestIdRef.current;
    setIsBottomMenuOpen(false);
    setActiveSystem('MASTER_SYSTEM');
    setConsoleState('LOADING_ROM');
    setLoadedRomTitle(DEFAULT_MASTER_SYSTEM_ROM_FILENAME);
    setStatusMessage('Cargando Silver Valley (Master System · SMS Power)...');

    try {
      const response = await fetch(encodeURI(DEFAULT_MASTER_SYSTEM_ROM_PATH));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (fetchCheckId !== bootRequestIdRef.current) return;
      const romBytes = new Uint8Array(arrayBuffer);

      const defaultEntry: ExtractedRomEntry = {
        id: DEFAULT_MASTER_SYSTEM_ENTRY_ID,
        fileName: DEFAULT_MASTER_SYSTEM_ROM_FILENAME,
        fullPath: DEFAULT_MASTER_SYSTEM_SOURCE_URL,
        extension: 'sms',
        system: 'MASTER_SYSTEM',
        sizeBytes: romBytes.byteLength,
        data: romBytes,
      };

      await bootExtractedRomEntry(defaultEntry, 'MASTER_SYSTEM');
    } catch {
      if (fetchCheckId !== bootRequestIdRef.current) return;
      const demo = BUILTIN_CARTRIDGES[1];
      bootLocalWasmFallback(demo.title, demo.data, 'MASTER_SYSTEM');
    }
  };

  const bootDefaultMegaDriveRom = async () => {
    cleanupActiveInstance();
    const fetchCheckId = bootRequestIdRef.current;
    setIsBottomMenuOpen(false);
    setActiveSystem('MEGA_DRIVE');
    setConsoleState('LOADING_ROM');
    setLoadedRomTitle(DEFAULT_MEGA_DRIVE_ROM_FILENAME);
    setStatusMessage('Cargando Final Fight MD (Mega Drive · MXRetroDev)...');

    try {
      const response = await fetch(encodeURI(DEFAULT_MEGA_DRIVE_ROM_PATH));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (fetchCheckId !== bootRequestIdRef.current) return;
      const romBytes = new Uint8Array(arrayBuffer);

      const defaultEntry: ExtractedRomEntry = {
        id: DEFAULT_MEGA_DRIVE_ENTRY_ID,
        fileName: DEFAULT_MEGA_DRIVE_ROM_FILENAME,
        fullPath: DEFAULT_MEGA_DRIVE_SOURCE_URL,
        extension: 'md',
        system: 'MEGA_DRIVE',
        sizeBytes: romBytes.byteLength,
        data: romBytes,
      };

      await bootExtractedRomEntry(defaultEntry, 'MEGA_DRIVE');
    } catch {
      if (fetchCheckId !== bootRequestIdRef.current) return;
      const demo = BUILTIN_CARTRIDGES[0];
      bootLocalWasmFallback(demo.title, demo.data, 'MEGA_DRIVE');
    }
  };

  // Automatically boot the default ROM on initial load (Game Gear, Master System, or Mega Drive)
  useEffect(() => {
    if (hasAutoBootedDefaultRomRef.current) return;
    hasAutoBootedDefaultRomRef.current = true;
    if (activeSystem === 'GAME_GEAR') {
      void bootDefaultGameGearItchRom();
    } else if (activeSystem === 'MASTER_SYSTEM') {
      void bootDefaultMasterSystemRom();
    } else if (activeSystem === 'MEGA_DRIVE') {
      void bootDefaultMegaDriveRom();
    }
  }, [activeSystem]);

  const handleSelectConsoleFromDropdown = async (newSystem: SegaSystemKind) => {
    setIsConsoleDropdownOpen(false);
    setActiveSystem(newSystem);

    const hasCustomUserRomForNewSystem =
      currentRomEntryRef.current &&
      currentRomEntryRef.current.system === newSystem &&
      !isDefaultBundledRomEntry(currentRomEntryRef.current.id) &&
      !isBuiltinDemoActiveRef.current;

    if (newSystem === 'GAME_GEAR') {
      if (hasCustomUserRomForNewSystem && currentRomEntryRef.current) {
        await bootExtractedRomEntry(currentRomEntryRef.current, 'GAME_GEAR');
      } else {
        await bootDefaultGameGearItchRom();
      }
      return;
    }

    if (newSystem === 'MASTER_SYSTEM') {
      if (hasCustomUserRomForNewSystem && currentRomEntryRef.current) {
        await bootExtractedRomEntry(currentRomEntryRef.current, 'MASTER_SYSTEM');
      } else {
        await bootDefaultMasterSystemRom();
      }
      return;
    }

    if (newSystem === 'MEGA_DRIVE') {
      if (hasCustomUserRomForNewSystem && currentRomEntryRef.current) {
        await bootExtractedRomEntry(currentRomEntryRef.current, 'MEGA_DRIVE');
      } else {
        await bootDefaultMegaDriveRom();
      }
      return;
    }

    if (consoleState === 'PLAYING') {
      if (
        isBuiltinDemoActiveRef.current ||
        isDefaultBundledRomEntry(currentRomEntryRef.current?.id) ||
        currentRomEntryRef.current?.system !== newSystem
      ) {
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

    if (soundEnabledRef.current) {
      unlockAndResumeAudioContexts();
    }

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
    engine.setVolumeParameters(masterVolumeRef.current, psgBoostRef.current);
    engine.toggleAudio(soundEnabledRef.current);
    localEngineRef.current = engine;
    setActiveSystem(system);
    setCoreMode('LOCAL_WASM_ENGINE');
    setLoadedRomTitle(title);
    setLoadedRomSizeKB(Math.max(1, Math.round(bytes.byteLength / 1024)));
    setConsoleState('PLAYING');
    setIsPaused(false);
    setStatusMessage(`${title}`);
    syncAllAudioContexts(soundEnabledRef.current);
  };

  const handleBootBuiltinSystemDemo = (sys: SegaSystemKind) => {
    if (sys === 'GAME_GEAR') {
      void bootDefaultGameGearItchRom();
      return;
    }
    if (sys === 'MASTER_SYSTEM') {
      void bootDefaultMasterSystemRom();
      return;
    }
    if (sys === 'MEGA_DRIVE') {
      void bootDefaultMegaDriveRom();
      return;
    }
    cleanupActiveInstance();
    setIsBottomMenuOpen(false);
    setArchiveEntries([]);
    setArchiveFileName('');
    isBuiltinDemoActiveRef.current = true;
    const cartIndex = sys === 'SG_1000' ? 4 : 0;
    const demo = BUILTIN_CARTRIDGES[cartIndex];
    currentRomEntryRef.current = {
      id: demo.id,
      fileName: demo.title,
      fullPath: demo.title,
      extension: 'md',
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
      setStatusMessage(`Reiniciado: ${loadedRomTitle}`);
      return;
    }

    if (currentRomEntryRef.current && !isBuiltinDemoActiveRef.current) {
      void bootExtractedRomEntry(currentRomEntryRef.current, activeSystem);
      return;
    }

    if (activeSystem === 'MASTER_SYSTEM') {
      void bootDefaultMasterSystemRom();
      return;
    }
    if (activeSystem === 'GAME_GEAR') {
      void bootDefaultGameGearItchRom();
      return;
    }
    if (activeSystem === 'MEGA_DRIVE') {
      void bootDefaultMegaDriveRom();
      return;
    }

    if (localEngineRef.current) {
      const cartIndex = activeSystem === 'SG_1000' ? 4 : 0;
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

  const handleMasterVolumeChange = (nextVol: number) => {
    const clamped = Math.max(0, Math.min(100, nextVol));
    masterVolumeRef.current = clamped;
    setMasterVolume(clamped);

    const autoEnable = clamped > 0;
    if (autoEnable !== soundEnabledRef.current) {
      soundEnabledRef.current = autoEnable;
      setSoundEnabled(autoEnable);
    }

    setMasterAudioSettings({
      enabled: autoEnable,
      volumePercent: clamped,
      psgBoost: psgBoostRef.current,
    });

    if (localEngineRef.current) {
      localEngineRef.current.setVolumeParameters(clamped, psgBoostRef.current);
      localEngineRef.current.toggleAudio(autoEnable);
    }
    if (nostalgistRef.current) {
      inspectAndBoostEmscriptenAudio(nostalgistRef.current);
    } else if (autoEnable) {
      unlockAndResumeAudioContexts();
    }
    setAudioContextRunning(getAudioEngineStatus().isRunning);
  };

  const handlePsgBoostChange = (nextBoost: number) => {
    const clamped = Number(Math.max(1.0, Math.min(3.0, nextBoost)).toFixed(1));
    psgBoostRef.current = clamped;
    setPsgBoost(clamped);

    setMasterAudioSettings({
      enabled: soundEnabledRef.current,
      volumePercent: masterVolumeRef.current,
      psgBoost: clamped,
    });

    if (localEngineRef.current) {
      localEngineRef.current.setVolumeParameters(masterVolumeRef.current, clamped);
    }
    if (nostalgistRef.current) {
      inspectAndBoostEmscriptenAudio(nostalgistRef.current);
    } else if (soundEnabledRef.current) {
      unlockAndResumeAudioContexts();
    }
    setAudioContextRunning(getAudioEngineStatus().isRunning);
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
    if (!isMobileDevice) {
      const nextState = !isDesktopFullscreenRef.current;
      isDesktopFullscreenRef.current = nextState;
      setIsDesktopFullscreen(nextState);
      if (nextState) {
        if (shellContainerRef.current && shellContainerRef.current.requestFullscreen) {
          shellContainerRef.current.requestFullscreen().catch(() => {});
        }
      } else if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      window.requestAnimationFrame(() => {
        resizeActiveEmulatorViewport();
      });
    } else if (shellContainerRef.current && shellContainerRef.current.requestFullscreen) {
      shellContainerRef.current.requestFullscreen().catch(() => {});
    }
    setIsBottomMenuOpen(false);
  };

  const handleCaptureScreenshot = async () => {
    if (consoleState !== 'PLAYING' || isCapturingScreenshot) return;
    setIsCapturingScreenshot(true);

    const canvasToPngBlob = (targetCanvas: HTMLCanvasElement): Promise<Blob | null> =>
      new Promise((resolve) => {
        try {
          targetCanvas.toBlob((blob) => resolve(blob), 'image/png');
        } catch {
          resolve(null);
        }
      });

    try {
      let pngBlob: Blob | null = null;

      if (coreMode === 'LIBRETRO_GENESIS_PLUS_GX') {
        if (nostalgistRef.current) {
          try {
            if (isPaused) {
              nostalgistRef.current.resume();
            }
            pngBlob = await nostalgistRef.current.screenshot();
            if (isPaused) {
              nostalgistRef.current.pause();
            }
          } catch {
            if (isPaused && nostalgistRef.current) {
              try {
                nostalgistRef.current.pause();
              } catch {
                // ignore
              }
            }
          }
        }
        if ((!pngBlob || pngBlob.size < 128) && activeWebglCanvasRef.current) {
          pngBlob = await canvasToPngBlob(activeWebglCanvasRef.current);
        }
      } else if (localCanvasRef.current) {
        pngBlob = await canvasToPngBlob(localCanvasRef.current);
      }

      if (!pngBlob) {
        setStatusMessage('No se pudo capturar la pantalla');
        return;
      }

      const systemSlug = activeSystem.toLowerCase().replace(/_/g, '-');
      const romSlug =
        (loadedRomTitle || 'partida')
          .replace(/\.[^/.]+$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'cartucho';
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
        now.getDate()
      )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const fileName = `sega-${systemSlug}-${romSlug}-${stamp}.png`;

      const objectUrl = URL.createObjectURL(pngBlob);
      const downloadLink = document.createElement('a');
      downloadLink.href = objectUrl;
      downloadLink.download = fileName;
      downloadLink.style.display = 'none';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);

      setScreenshotCapturedSuccess(true);
      if (screenshotFeedbackTimerRef.current !== null) {
        window.clearTimeout(screenshotFeedbackTimerRef.current);
      }
      screenshotFeedbackTimerRef.current = window.setTimeout(() => {
        setScreenshotCapturedSuccess(false);
        screenshotFeedbackTimerRef.current = null;
      }, 1800);

      setStatusMessage(`Captura descargada: ${fileName}`);
    } catch {
      setStatusMessage('Error al guardar la captura PNG');
    } finally {
      setIsCapturingScreenshot(false);
    }
  };

  const isTwoButtonPad = isEightBitSystem(activeSystem);
  const activeConsoleOption =
    CONSOLE_OPTIONS.find((c) => c.id === activeSystem) ?? CONSOLE_OPTIONS[0];

  // Shared Physical D-Pad Component (Sega Game Gear Rounded Cross D-Pad)
  const renderPhysicalDPad = (sizeClass: string, compact = false) => (
    <div
      className={`relative ${sizeClass} rounded-full bg-[#14171D] border-2 border-[#2D333F] shadow-inner ${
        compact ? 'p-1.5 gap-0.5' : 'p-2 gap-1'
      } grid grid-cols-3 grid-rows-3 shrink-0`}
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
        className={`rounded-t-md font-mono ${
          compact ? 'text-[10px]' : 'text-xs'
        } font-bold flex items-center justify-center border transition-transform cursor-pointer ${
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
        className={`rounded-l-md font-mono ${
          compact ? 'text-[10px]' : 'text-xs'
        } font-bold flex items-center justify-center border transition-transform cursor-pointer ${
          activeButtons.left
            ? 'bg-sky-400 text-slate-950 border-sky-300 scale-95'
            : 'bg-[#282D38] text-slate-200 border-[#3B4252] active:scale-95'
        }`}
      >
        ◀
      </button>

      {/* Center D-Pad Pivot Circle */}
      <div className="bg-[#20242D] flex items-center justify-center">
        <div
          className={`${
            compact ? 'w-3 h-3' : 'w-4 h-4'
          } rounded-full bg-[#15181E] border border-[#323846]`}
        />
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
        className={`rounded-r-md font-mono ${
          compact ? 'text-[10px]' : 'text-xs'
        } font-bold flex items-center justify-center border transition-transform cursor-pointer ${
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
        className={`rounded-b-md font-mono ${
          compact ? 'text-[10px]' : 'text-xs'
        } font-bold flex items-center justify-center border transition-transform cursor-pointer ${
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

  // Shared Action Buttons:
  // - 8-Bit (Game Gear / Master System / SG-1000): 2 Buttons (1 & 2)
  // - 16-Bit Mega Drive (Default 3-Button Pad): Single ergonomic row (A, B, C)
  // - 16-Bit Mega Drive (6-Button Pad): Dual row (X, Y, Z on top + A, B, C on bottom)
  const renderPhysicalActionButtons = (compact = false) => {
    if (isTwoButtonPad) {
      const btnSize = compact
        ? 'w-11 h-11 sm:w-12 sm:h-12 text-xs'
        : 'w-16 h-16 text-base';
      const gapClass = compact ? 'gap-2 sm:gap-2.5' : 'gap-3.5';
      const offsetBtn1 = compact ? 'mt-2' : 'mt-4';
      const offsetBtn2 = compact ? '-mt-2' : '-mt-4';
      return (
        <div className={`flex items-center ${gapClass} -rotate-12`}>
          {/* Button 1 (Bottom-Left) */}
          <div className={`flex flex-col items-center gap-0.5 ${offsetBtn1}`}>
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
            <span className="font-mono text-[9px] font-bold tracking-wider text-slate-400">
              1
            </span>
          </div>

          {/* Button 2 (Top-Right) */}
          <div className={`flex flex-col items-center gap-0.5 ${offsetBtn2}`}>
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
            <span className="font-mono text-[9px] font-bold tracking-wider text-slate-400">
              2
            </span>
          </div>
        </div>
      );
    }

    const isThreeButtonMdPad = inputBindings.mdPadType !== '6button';

    if (isThreeButtonMdPad) {
      // Classic 3-Button Mega Drive Pad (A, B, C)
      const md3BtnSize = compact
        ? 'w-9 h-9 sm:w-10 sm:h-10 text-xs'
        : 'w-13 h-13 sm:w-14 sm:h-14 text-sm';
      return (
        <div className="flex items-center justify-end gap-1.5 sm:gap-2 -rotate-12">
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
              className={`${md3BtnSize} rounded-full font-mono font-bold border-2 shadow-lg transition-transform cursor-pointer flex items-center justify-center uppercase ${
                activeButtons[btn]
                  ? 'bg-amber-400 text-slate-950 border-amber-200 scale-95'
                  : 'bg-[#2A303C] text-slate-100 border-[#434C5E] active:scale-95'
              }`}
            >
              {btn}
            </button>
          ))}
        </div>
      );
    }

    // 6-Button Mega Drive Layout (X, Y, Z + A, B, C)
    const mdBtnSmall = compact ? 'w-7 h-7 sm:w-8 sm:h-8 text-[10px]' : 'w-11 h-10 text-xs';
    const mdBtnLarge = compact ? 'w-8 h-8 sm:w-9 sm:h-9 text-[11px]' : 'w-12 h-12 text-sm';
    return (
      <div className="space-y-1 -rotate-6">
        <div className="flex items-center justify-end gap-1">
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
        <div className="flex items-center justify-end gap-1">
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

  // Physical MENU Button (opens the Bottom Sheet)
  const renderPhysicalMenuButton = (compact = false) => (
    <button
      onClick={() => setIsBottomMenuOpen(true)}
      className={`${
        compact ? 'px-3 py-1 min-h-[28px] text-[10px]' : 'px-4 py-1.5 min-h-[34px] text-[11px]'
      } rounded-full bg-[#282E3A] hover:bg-[#323A48] active:scale-95 border-2 border-[#434C5E] shadow-md font-mono font-bold tracking-wider text-slate-200 transition-transform cursor-pointer flex items-center gap-1.5`}
    >
      <SlidersHorizontal className="w-3 h-3 text-sky-400 shrink-0" />
      MENU
    </button>
  );

  // Classic Game Gear Blue Oval START Button
  const renderPhysicalStartButton = (compact = false) => (
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
      className={`${
        compact ? 'px-3.5 py-1 min-h-[28px] text-[10px]' : 'px-5 py-1.5 min-h-[34px] text-[11px]'
      } rounded-full font-mono font-bold tracking-wider border-2 shadow-md transition-transform cursor-pointer ${
        activeButtons.start
          ? 'bg-amber-400 text-slate-950 border-amber-200 scale-95'
          : 'bg-[#1D4ED8] hover:bg-[#2563EB] text-white border-[#3B82F6] active:scale-95'
      }`}
    >
      START
    </button>
  );

  // Shared Physical MENU & START Pill Buttons for Portrait Mode
  const renderPhysicalMenuAndStartButtons = (verticalStack = false) => (
    <div
      className={`flex ${
        verticalStack ? 'flex-col items-end gap-2.5' : 'items-center justify-center gap-5'
      }`}
    >
      <div className="flex flex-col items-center gap-1">{renderPhysicalMenuButton(false)}</div>
      <div className="flex flex-col items-center gap-1">{renderPhysicalStartButton(false)}</div>
    </div>
  );

  // Game Screen Viewport:
  // - Preserves the native aspect ratio of each emulated console (10:9 for Game Gear, 4:3 CRT TV for Mega Drive, Master System, and SG-1000)
  // - Centered inside the black screen stage maximizing the active display area with dark letterbox/pillarbox borders across all devices and orientations
  const renderGameGearScreenBezel = (fullHeightLandscape = false) => {
    const fittedStyle: React.CSSProperties = fittedScreenBox
      ? {
          width: `${fittedScreenBox.width}px`,
          height: `${fittedScreenBox.height}px`,
        }
      : {
          aspectRatio: `${activeConsoleOption.bufferWidth} / ${activeConsoleOption.bufferHeight}`,
          maxWidth: '100%',
          maxHeight: '100%',
        };

    return (
      <div className="w-full h-full flex-1 min-h-0 flex flex-col bg-black overflow-hidden">
        {/* Outer Black Screen Chamber: Centers the Native Aspect Ratio Game Frame */}
        <div
          ref={handleScreenStageRef}
          onClick={() => {
            if (consoleState === 'PLAYING' && soundEnabledRef.current) {
              syncAllAudioContexts(true);
            }
          }}
          className="relative flex-1 w-full h-full min-h-0 min-w-0 bg-black flex items-center justify-center overflow-hidden"
        >
          {/* Active Inscribed Console Aspect-Ratio Frame (10:9 Game Gear or 4:3 CRT TV) */}
          <div
            style={fittedStyle}
            className="relative bg-black overflow-hidden shrink-0"
          >
            {/* Dedicated WebGL Mount Container (anchored to all 4 edges via absolute inset-0) */}
            <div
              ref={handleEmulatorMountRef}
              className={`emulator-screen-mount absolute top-0 left-0 right-0 bottom-0 inset-0 w-full h-full overflow-hidden ${
                coreMode === 'LOCAL_WASM_ENGINE' && consoleState === 'PLAYING'
                  ? 'opacity-0 pointer-events-none'
                  : 'opacity-100'
              }`}
            />

            {/* Dedicated 2D Canvas for Built-in Local WASM Demo / Fallback */}
            <canvas
              ref={localCanvasRef}
              width={256}
              height={192}
              className={`pixelated absolute inset-0 w-full h-full object-fill ${
                coreMode === 'LOCAL_WASM_ENGINE' && consoleState === 'PLAYING'
                  ? 'block'
                  : 'hidden'
              }`}
            />

            {/* CRT / LCD Scanline Filter (strictly confined to the active game image box) */}
            {consoleState === 'PLAYING' && crtScanlines && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-10 opacity-25 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.85)_50%)] bg-[length:100%_4px]"
              />
            )}
          </div>

          {/* Empty State inside the Screen Chamber */}
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
                {activeSystem === 'GAME_GEAR'
                  ? 'Iniciar GG Turrican (GG)'
                  : activeSystem === 'MASTER_SYSTEM'
                    ? 'Iniciar Silver Valley (SMS)'
                    : activeSystem === 'MEGA_DRIVE'
                      ? 'Iniciar Final Fight MD'
                      : `Probar Demo ${activeConsoleOption.shortLabel}`}
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

        {/* Slim Bottom Bezel Bar only in Portrait / Desktop mode so Landscape screen uses 100% of vertical height */}
        {!fullHeightLandscape && (
          <div className="w-full px-3 py-1 bg-[#0B0D12] border-y border-[#2D3340] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  consoleState === 'PLAYING'
                    ? 'bg-red-500 shadow-[0_0_8px_#ef4444]'
                    : 'bg-red-900/70'
                }`}
              />
              <span className="font-mono text-[9px] font-bold tracking-widest text-slate-400 shrink-0">
                BATTERY
              </span>
              <span className="text-slate-700">·</span>
              <span className="font-mono text-[10px] text-slate-400 truncate">
                {statusMessage}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[10px] text-sky-400 font-bold">
                {activeConsoleOption.aspectLabel}
              </span>
              <span className="text-slate-700">·</span>
              <span className="font-mono text-[10px] font-extrabold tracking-widest text-slate-200">
                {activeConsoleOption.bezelBrand}
              </span>
              <div className="flex items-center gap-0.5" aria-hidden="true">
                <span className="w-2 h-3 bg-red-500 rounded-xs -skew-x-12" />
                <span className="w-2 h-3 bg-emerald-500 rounded-xs -skew-x-12" />
                <span className="w-2 h-3 bg-blue-500 rounded-xs -skew-x-12" />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Shared System Options Content:
  // - Rendered inside the persistent Right Panel on Desktop browsers
  // - Rendered inside the slide-up MENU bottom sheet on Mobile phones
  const renderSystemOptionsContent = (isDesktopSidebar = false) => (
    <div className="space-y-4">
      {/* 1. Expandable Console Dropdown Selector */}
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
      <div className="grid grid-cols-1 gap-2">
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
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-300 font-semibold text-xs cursor-pointer"
          >
            <Archive className="w-4 h-4" />
            Cambiar ROM del Paquete ({archiveEntries.length})
          </button>
        ) : (
          <button
            onClick={() => handleBootBuiltinSystemDemo(activeSystem)}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-xs cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-sky-400" />
            {activeSystem === 'GAME_GEAR'
              ? 'GG Turrican GG (Por Defecto)'
              : activeSystem === 'MASTER_SYSTEM'
                ? 'Silver Valley SMS (Por Defecto)'
                : activeSystem === 'MEGA_DRIVE'
                  ? 'Final Fight MD (Por Defecto)'
                  : `Iniciar Demo ${activeConsoleOption.shortLabel}`}
          </button>
        )}
      </div>

      {/* 3. Motor de Audio Estéreo (Volumen Maestro + Ganancia Pre-Amp PSG) */}
      <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/90 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {soundEnabled && masterVolume > 0 ? (
              <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <VolumeX className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span className="text-xs font-bold text-slate-200">
              Motor de Audio PSG SN76489
            </span>
          </div>
          <span
            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
              !soundEnabled || masterVolume === 0
                ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                : audioContextRunning
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
            }`}
          >
            {!soundEnabled || masterVolume === 0
              ? 'SILENCIADO'
              : audioContextRunning
                ? 'ACTIVO 48kHz'
                : 'LISTO (HAZ CLIC)'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 pt-0.5">
          {/* Master Volume Slider (0% - 100%) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-medium">Volumen Maestro</span>
              <span className="font-mono font-bold text-sky-400">
                {soundEnabled ? `${masterVolume}%` : '0% (MUTE)'}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={soundEnabled ? masterVolume : 0}
              onChange={(e) => handleMasterVolumeChange(Number(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none bg-slate-800 accent-sky-400 cursor-pointer"
            />
          </div>

          {/* PSG Gain / Pre-Amp Boost Slider (1.0x - 3.0x) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-medium">Ganancia Pre-Amp PSG</span>
              <span className="font-mono font-bold text-emerald-400">
                {psgBoost.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min={1.0}
              max={3.0}
              step={0.1}
              value={psgBoost}
              onChange={(e) => handlePsgBoostChange(Number(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none bg-slate-800 accent-emerald-400 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* 4. Quick Save States (Slots 1, 2, 3) */}
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

      {/* 5. Console Hardware Toggles (Pause, Reset, Sound, CRT Scanlines, Fullscreen) */}
      <div className="grid grid-cols-2 gap-2 pt-0.5">
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
          onClick={handleCaptureScreenshot}
          disabled={consoleState !== 'PLAYING' || isCapturingScreenshot}
          className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-150 ${
            consoleState !== 'PLAYING'
              ? 'border-slate-800 bg-slate-900 text-slate-600 cursor-not-allowed'
              : screenshotCapturedSuccess
                ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300 cursor-pointer'
                : 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100 cursor-pointer'
          }`}
        >
          {screenshotCapturedSuccess ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ¡Capturada!
            </>
          ) : (
            <>
              <Camera className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              Capturar Pantalla
            </>
          )}
        </button>

        <button
          onClick={handleFullscreen}
          className="py-2.5 px-3 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5 shrink-0" />
          Pantalla Completa
        </button>
      </div>

      {/* 6. Controller Type Selector (3-Button Default vs 6-Button in Mega Drive) & USB/Bluetooth Gamepad Reconfig */}
      <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/80 space-y-3">
        {/* Quick Mega Drive Controller Type Selector */}
        {!isTwoButtonPad && (
          <div className="space-y-1.5 pb-2.5 border-b border-slate-800/80">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-200">
                Tipo de Mando Mega Drive
              </span>
              <span className="font-mono text-[11px] text-sky-400">
                {inputBindings.mdPadType !== '6button' ? '3 Botones (Por Defecto)' : '6 Botones'}
              </span>
            </div>
            <div
              role="radiogroup"
              aria-label="Tipo de mando Mega Drive"
              className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-950/80 border border-slate-800"
            >
              <button
                type="button"
                role="radio"
                aria-checked={inputBindings.mdPadType !== '6button'}
                onClick={() => handleChangeMdPadType('3button')}
                className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  inputBindings.mdPadType !== '6button'
                    ? 'bg-sky-400 text-slate-950 font-bold'
                    : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/70'
                }`}
              >
                3 Botones (A · B · C)
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={inputBindings.mdPadType === '6button'}
                onClick={() => handleChangeMdPadType('6button')}
                className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                  inputBindings.mdPadType === '6button'
                    ? 'bg-sky-400 text-slate-950 font-bold'
                    : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/70'
                }`}
              >
                6 Botones (A-Z)
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Gamepad2 className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="text-xs font-bold text-slate-200 truncate">
              {connectedGamepadName ? 'Mando USB / BT' : 'Controles Activos'}
            </span>
            <span className="text-[11px] font-mono text-slate-400 truncate">
              · {connectedGamepadName ? 'Conectado' : isDesktopSidebar ? 'Teclado' : 'Táctil / USB / BT'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleOpenGamepadReconfigFromMenu}
            className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 hover:border-sky-400/60 text-[11px] font-semibold text-sky-300 whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            Reconfigurar Mando
          </button>
        </div>

        {connectedGamepadName && (
          <div className="text-[11px] font-mono text-emerald-400 truncate">
            {connectedGamepadName}
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono tabular-nums">
          <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-400 shrink-0">Cruceta</span>
            <span className="text-slate-200 font-bold truncate">
              {connectedGamepadName
                ? inputBindings.gamepadUseLeftStick
                  ? 'D-Pad + Stick'
                  : 'D-Pad'
                : inputBindings.keyboard.up === 'ArrowUp' &&
                    inputBindings.keyboard.down === 'ArrowDown' &&
                    inputBindings.keyboard.left === 'ArrowLeft' &&
                    inputBindings.keyboard.right === 'ArrowRight'
                  ? 'Flechas'
                  : `${formatKeyboardCodeLabel(inputBindings.keyboard.up)}/${formatKeyboardCodeLabel(inputBindings.keyboard.left)}/${formatKeyboardCodeLabel(inputBindings.keyboard.down)}/${formatKeyboardCodeLabel(inputBindings.keyboard.right)}`}
            </span>
          </div>
          {isTwoButtonPad ? (
            <>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400 shrink-0">Botones 1 / 2</span>
                <span className="text-sky-400 font-bold truncate">
                  {connectedGamepadName
                    ? `${formatGamepadBindingLabel(inputBindings.gamepad.a)} / ${formatGamepadBindingLabel(inputBindings.gamepad.b)}`
                    : `${formatKeyboardCodeLabel(inputBindings.keyboard.a)} / ${formatKeyboardCodeLabel(inputBindings.keyboard.b)}`}
                </span>
              </div>
              <div className="col-span-2 flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400 shrink-0">START / PAUSE</span>
                <span className="text-amber-300 font-bold truncate">
                  {connectedGamepadName
                    ? formatGamepadBindingLabel(inputBindings.gamepad.start)
                    : formatKeyboardCodeLabel(inputBindings.keyboard.start)}
                </span>
              </div>
            </>
          ) : inputBindings.mdPadType !== '6button' ? (
            <>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400 shrink-0">A / B / C</span>
                <span className="text-sky-400 font-bold truncate">
                  {connectedGamepadName
                    ? `${formatGamepadBindingLabel(inputBindings.gamepad.a)}/${formatGamepadBindingLabel(inputBindings.gamepad.b)}/${formatGamepadBindingLabel(inputBindings.gamepad.c)}`
                    : `${formatKeyboardCodeLabel(inputBindings.keyboard.a)} / ${formatKeyboardCodeLabel(inputBindings.keyboard.b)} / ${formatKeyboardCodeLabel(inputBindings.keyboard.c)}`}
                </span>
              </div>
              <div className="col-span-2 flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400 shrink-0">START (Pad 3 Botones)</span>
                <span className="text-amber-300 font-bold truncate">
                  {connectedGamepadName
                    ? formatGamepadBindingLabel(inputBindings.gamepad.start)
                    : formatKeyboardCodeLabel(inputBindings.keyboard.start)}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400 shrink-0">A / B / C</span>
                <span className="text-sky-400 font-bold truncate">
                  {formatKeyboardCodeLabel(inputBindings.keyboard.a)} /{' '}
                  {formatKeyboardCodeLabel(inputBindings.keyboard.b)} /{' '}
                  {formatKeyboardCodeLabel(inputBindings.keyboard.c)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400 shrink-0">X / Y / Z</span>
                <span className="text-emerald-400 font-bold truncate">
                  {formatKeyboardCodeLabel(inputBindings.keyboard.x)} /{' '}
                  {formatKeyboardCodeLabel(inputBindings.keyboard.y)} /{' '}
                  {formatKeyboardCodeLabel(inputBindings.keyboard.z)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400 shrink-0">START / MODE</span>
                <span className="text-amber-300 font-bold truncate">
                  {formatKeyboardCodeLabel(inputBindings.keyboard.start)} /{' '}
                  {formatKeyboardCodeLabel(inputBindings.keyboard.mode)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // Desktop Fullscreen SEGA Console Bezel (recreating the user's reference screenshot):
  // - Molded dark-graphite SEGA Mega Drive shell with left vent grille, circular drum rings,
  //   decorative lower-left Volume (0-10 slider + headphone icon), ON/Off switch, and white Reset button
  // - Deep 3D recessed trapezoidal inner CRT cavity housing the centered native-aspect game screen (4:3 or 10:9)
  // - Purely decorative frame elements (pointer-events-none); press ESC to exit fullscreen and restore sidebar
  const renderDesktopFullscreenSegaBezel = () => (
    <div className="relative w-full h-full flex-1 min-h-0 bg-[#1B1F25] overflow-hidden select-none flex items-center justify-center">
      {/* 1. Background Molded SEGA Console Shell & Circular Drum Ring (Decorative) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          background:
            'linear-gradient(180deg, #2C313A 0%, #242930 14%, #1F242B 70%, #171B20 100%)',
        }}
      >
        {/* Top Horizontal Molded Seam Line */}
        <div
          className="absolute top-0 left-[2.8%] right-[2.8%] h-[16%]"
          style={{
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.22) 100%)',
            borderLeft: '2px solid #12151A',
            borderRight: '2px solid #12151A',
            borderBottom: '2px solid #14171D',
            boxShadow: '0 2px 0 rgba(255,255,255,0.05)',
          }}
        />

        {/* Main Outer Left & Right Vertical Chassis Grooves */}
        <div
          className="absolute top-0 bottom-[26%] left-[2.8%] w-[2px]"
          style={{
            background: '#111419',
            boxShadow: '1px 0 0 rgba(255,255,255,0.06)',
          }}
        />
        <div
          className="absolute top-0 bottom-[26%] right-[2.8%] w-[2px]"
          style={{
            background: '#111419',
            boxShadow: '-1px 0 0 rgba(255,255,255,0.06)',
          }}
        />

        {/* Lower Curved Shoulder Step Grooves (Left & Right) */}
        <div
          className="absolute left-0 right-0 bottom-0 h-[28%]"
          style={{
            background:
              'linear-gradient(180deg, #1A1E24 0%, #16191F 45%, #12151A 100%)',
            borderTop: '3px solid #101317',
            boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.65)',
          }}
        />

        {/* Left Horizontal Vent Grille Slots (13 deep dark slots on far left edge) */}
        <div
          className="absolute left-0 top-[9.5%] w-[6.2%] h-[60.5%] py-2 pr-1.5 flex flex-col justify-between"
          style={{
            background: 'linear-gradient(90deg, #13161B 0%, #1D2229 100%)',
            borderTop: '2px solid #101318',
            borderRight: '3px solid #111419',
            borderBottom: '3px solid #0E1115',
            borderTopRightRadius: '6px',
            borderBottomRightRadius: '6px',
            boxShadow:
              'inset -3px 0 6px rgba(0,0,0,0.8), 2px 0 4px rgba(255,255,255,0.04)',
          }}
        >
          {Array.from({ length: 13 }).map((_, idx) => (
            <div
              key={idx}
              className="w-full h-[5%] rounded-r-xs"
              style={{
                background:
                  'linear-gradient(180deg, #07080A 0%, #12151A 65%, #2A3038 100%)',
                boxShadow: 'inset 0 2px 3px rgba(0,0,0,0.9)',
              }}
            />
          ))}
        </div>

        {/* Center Concentric Circular SEGA Mega Drive Drum Rings Behind the Cavity */}
        <div className="absolute inset-0 flex items-center justify-center">
          {/* Outer Circular Drum Ring */}
          <div
            className="rounded-full flex items-center justify-center"
            style={{
              width: 'min(92vw, 134vh)',
              height: 'min(92vw, 134vh)',
              background:
                'radial-gradient(circle, #181C22 52%, #232830 66%, #1B1F26 72%)',
              border: '3px solid #101318',
              boxShadow:
                'inset 0 0 28px rgba(0,0,0,0.85), 0 0 0 2px rgba(255,255,255,0.04)',
            }}
          >
            {/* Inner Circular Drum Groove */}
            <div
              className="rounded-full"
              style={{
                width: '89%',
                height: '89%',
                border: '3px solid #0E1014',
                background:
                  'radial-gradient(circle, #12151A 0%, #1B1F26 85%, #252B34 100%)',
                boxShadow:
                  'inset 0 0 35px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.05)',
              }}
            />
          </div>
        </div>

        {/* Lower-Left Decorative Controls Panel: Volume (0-10 Slider + Headphones), ON/Off Switch, Reset Button */}
        <div
          className="absolute left-[4.2%] bottom-[1.8%] w-[11%] min-w-[126px] max-w-[168px] h-[25.5%] min-h-[165px] px-2.5 py-2 flex items-stretch justify-between gap-2"
          style={{
            background: 'linear-gradient(180deg, #191D22 0%, #13161B 100%)',
            borderTop: '2px solid #262B33',
            borderLeft: '2px solid #0E1014',
            borderRight: '2px solid #0E1014',
            boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.75)',
          }}
        >
          {/* Left Column: Volume Slider (0..5..10) + Headphone Icon & "Volume" Label */}
          <div className="flex flex-col items-center justify-between h-full w-[48%]">
            <div className="flex items-stretch justify-center gap-1.5 flex-1 w-full py-0.5">
              {/* Graduation Scale 10 .. 5 .. 0 */}
              <div className="flex flex-col justify-between items-end py-1 text-[8px] font-mono leading-none text-slate-300/90">
                <div className="flex items-center gap-0.5">
                  <span>10</span>
                  <span className="w-1.5 h-[1.5px] bg-slate-300 block" />
                </div>
                <span className="w-1 h-[1px] bg-slate-400/80 block" />
                <span className="w-1 h-[1px] bg-slate-400/80 block" />
                <span className="w-1 h-[1px] bg-slate-400/80 block" />
                <span className="w-1 h-[1px] bg-slate-400/80 block" />
                <div className="flex items-center gap-0.5">
                  <span>5</span>
                  <span className="w-1.5 h-[1.5px] bg-slate-300 block" />
                </div>
                <span className="w-1 h-[1px] bg-slate-400/80 block" />
                <span className="w-1 h-[1px] bg-slate-400/80 block" />
                <span className="w-1 h-[1px] bg-slate-400/80 block" />
                <span className="w-1 h-[1px] bg-slate-400/80 block" />
                <div className="flex items-center gap-0.5">
                  <span>0</span>
                  <span className="w-1.5 h-[1.5px] bg-slate-300 block" />
                </div>
              </div>

              {/* Vertical Volume Fader Track & Red Handle */}
              <div
                className="relative w-5 sm:w-6 h-full rounded-xs overflow-hidden flex flex-col items-center"
                style={{
                  background: '#090B0E',
                  border: '1px solid #2A303A',
                  boxShadow: 'inset 0 3px 6px rgba(0,0,0,0.95)',
                }}
              >
                {/* Fader Knob Position (~7.5 / 10 like the screenshot) */}
                <div
                  className="w-full h-[34%] mt-[10%] flex flex-col justify-center"
                  style={{
                    background:
                      'linear-gradient(180deg, #3A404A 0%, #252A32 45%, #1A1E24 100%)',
                    borderTop: '1px solid #525A68',
                    borderBottom: '1px solid #0E1014',
                    boxShadow: '0 3px 6px rgba(0,0,0,0.85)',
                  }}
                >
                  <div className="w-full h-[3px] bg-[#E11D48] shadow-[0_0_4px_#e11d48]" />
                </div>
              </div>
            </div>

            {/* Headphone SVG + "Volume" Label */}
            <div className="flex flex-col items-center pt-1 leading-none">
              <svg
                viewBox="0 0 24 24"
                className="w-3.5 h-3.5 text-slate-300/90"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
                <rect x="2" y="14" width="4" height="6" rx="1" fill="currentColor" />
                <rect x="18" y="14" width="4" height="6" rx="1" fill="currentColor" />
              </svg>
              <span className="text-[8px] font-sans font-semibold text-slate-300/90 tracking-tight mt-0.5">
                Volume
              </span>
            </div>
          </div>

          {/* Right Column: Power ON/Off Switch + White Reset Button */}
          <div className="flex flex-col items-center justify-between h-full w-[52%] py-1">
            {/* ON / Off Slide Switch */}
            <div className="flex flex-col items-center w-full">
              <div
                className="w-11 h-5 rounded-xs p-0.5 flex items-center justify-center relative"
                style={{
                  background: '#0A0C0F',
                  border: '1px solid #2D333E',
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.95)',
                }}
              >
                <div
                  className="w-8 h-3.5 rounded-xs flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(180deg, #2A303A 0%, #171A20 100%)',
                    border: '1px solid #3B4250',
                  }}
                >
                  <div className="w-1.5 h-full bg-[#E11D48] shadow-[0_0_4px_#e11d48]" />
                </div>
              </div>
              <div className="w-11 flex items-center justify-between text-[7px] font-sans font-semibold text-slate-400 mt-0.5 px-0.5">
                <span>ON</span>
                <span>Off</span>
              </div>
            </div>

            {/* White Rectangular Reset Button with 4 Embossed Dots */}
            <div className="flex flex-col items-center w-full pb-1">
              <div
                className="w-11 h-5 rounded-xs p-0.5 flex items-center justify-center"
                style={{
                  background: '#0D1014',
                  border: '1px solid #2E3540',
                  boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.95)',
                }}
              >
                <div
                  className="w-9 h-3.5 rounded-[2px] flex items-center justify-evenly px-1"
                  style={{
                    background: 'linear-gradient(180deg, #F3F4F6 0%, #9CA3AF 100%)',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.8)',
                  }}
                >
                  <span className="w-1 h-1 rounded-full bg-slate-500/80 shadow-inner" />
                  <span className="w-1 h-1 rounded-full bg-slate-500/80 shadow-inner" />
                  <span className="w-1 h-1 rounded-full bg-slate-500/80 shadow-inner" />
                  <span className="w-1 h-1 rounded-full bg-slate-500/80 shadow-inner" />
                </div>
              </div>
              <span className="text-[7px] font-sans font-semibold text-slate-400 mt-0.5">
                Reset
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Center Recessed 3D Trapezoidal Bezel Box (matches the screenshot's deep angled CRT cavity) */}
      <div
        className="relative z-10 w-[68vw] h-[91.5dvh] max-w-[138dvh] flex flex-col overflow-hidden"
        style={{
          background: '#050608',
          border: '3px solid #040507',
          boxShadow:
            '0 0 0 1px rgba(255,255,255,0.06), 0 24px 60px rgba(0,0,0,0.95)',
        }}
      >
        {/* 3D Perspective Bezel Walls (Top, Bottom, Left, Right angled trapezoids + Diagonal Corner Seam Lines) */}
        <svg
          aria-hidden="true"
          viewBox="0 0 1000 800"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 w-full h-full z-0"
        >
          <defs>
            <linearGradient id="segaBezelTop" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#050608" />
              <stop offset="65%" stopColor="#0E1014" />
              <stop offset="100%" stopColor="#17191F" />
            </linearGradient>
            <linearGradient id="segaBezelBottom" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#060709" />
              <stop offset="45%" stopColor="#181615" />
              <stop offset="100%" stopColor="#26211C" />
            </linearGradient>
            <linearGradient id="segaBezelLeft" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#060709" />
              <stop offset="50%" stopColor="#171616" />
              <stop offset="100%" stopColor="#24201C" />
            </linearGradient>
            <linearGradient id="segaBezelRight" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0%" stopColor="#060709" />
              <stop offset="50%" stopColor="#171616" />
              <stop offset="100%" stopColor="#24201C" />
            </linearGradient>
          </defs>

          {/* Top Slanted Wall */}
          <polygon points="0,0 1000,0 915,72 85,72" fill="url(#segaBezelTop)" />
          {/* Bottom Slanted Wall */}
          <polygon points="85,728 915,728 1000,800 0,800" fill="url(#segaBezelBottom)" />
          {/* Left Slanted Wall */}
          <polygon points="0,0 85,72 85,728 0,800" fill="url(#segaBezelLeft)" />
          {/* Right Slanted Wall */}
          <polygon points="915,72 1000,0 1000,800 915,728" fill="url(#segaBezelRight)" />

          {/* 4 Corner Diagonal Bevel Edges */}
          <line x1="0" y1="0" x2="85" y2="72" stroke="#2E2924" strokeWidth="2" />
          <line x1="1000" y1="0" x2="915" y2="72" stroke="#2E2924" strokeWidth="2" />
          <line x1="0" y1="800" x2="85" y2="728" stroke="#4A3B28" strokeWidth="2.5" />
          <line x1="1000" y1="800" x2="915" y2="728" stroke="#4A3B28" strokeWidth="2.5" />

          {/* Inner Screen Frame Rim */}
          <rect
            x="85"
            y="72"
            width="830"
            height="656"
            fill="#000000"
            stroke="#0A0C0F"
            strokeWidth="3"
          />
        </svg>

        {/* Inner Recessed Game Screen Cavity (aligned with the 85..915 x 72..728 3D bevel aperture) */}
        <div
          className="relative z-10 w-full h-full flex items-center justify-center"
          style={{
            paddingTop: '9%',
            paddingBottom: '9%',
            paddingLeft: '8.5%',
            paddingRight: '8.5%',
          }}
        >
          <div className="w-full h-full rounded-[6px] overflow-hidden bg-black shadow-[0_0_24px_rgba(0,0,0,0.95)] flex flex-col">
            {renderGameGearScreenBezel(true)}
          </div>
        </div>
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
          DESKTOP BROWSER INTERFACE (!isMobileDevice):
          - In Fullscreen Mode (isDesktopFullscreen): Hides right sidebar and displays the SEGA console bezel around the centered game screen (exit with ESC)
          - In Windowed Mode (!isDesktopFullscreen): Emulator screen on the LEFT (flex-1) + System & Controls sidebar on the RIGHT
          ===================================================================== */}
      {!isMobileDevice ? (
        isDesktopFullscreen ? (
          renderDesktopFullscreenSegaBezel()
        ) : (
          <div className="w-full flex-1 min-h-0 bg-[#0F1218] flex items-stretch overflow-hidden">
            {/* Left Side: Main Emulator Screen Viewport */}
            <div className="flex-1 h-full min-w-0 min-h-0 flex flex-col bg-black border-r border-slate-800/90">
              {renderGameGearScreenBezel(false)}
            </div>

          {/* Right Side: Persistent System Menu & Controls Settings Sidebar */}
          <aside
            ref={desktopAsideRef}
            className="w-[380px] lg:w-[420px] xl:w-[440px] shrink-0 h-full bg-[#121620] p-5 overflow-y-auto space-y-4"
          >
            <div className="border-b border-slate-800 pb-3.5 space-y-3">
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <h1 className="text-base font-bold text-slate-100 whitespace-nowrap">
                    Menú del Sistema SEGA
                  </h1>
                  <span className="font-mono text-[11px] font-semibold text-sky-400 whitespace-nowrap">
                    {activeConsoleOption.shortLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {desktopSidebarTab === 'system'
                    ? 'Consola, carga de ROMs, tipo de mando y partidas'
                    : 'Tipo de mando y reconfiguración USB, Bluetooth o teclado'}
                </p>
              </div>

              {/* Top Sidebar Tabs: Sistema | Controles */}
              <div
                role="tablist"
                aria-label="Secciones de la barra lateral"
                className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0B0E15] border border-slate-800"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={desktopSidebarTab === 'system'}
                  onClick={() => handleChangeDesktopSidebarTab('system')}
                  className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                    desktopSidebarTab === 'system'
                      ? 'bg-slate-800 text-slate-100 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/70'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                  Sistema
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={desktopSidebarTab === 'controls'}
                  onClick={() => handleChangeDesktopSidebarTab('controls')}
                  className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                    desktopSidebarTab === 'controls'
                      ? 'bg-slate-800 text-slate-100 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/70'
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                  Controles
                </button>
              </div>
            </div>

            {desktopSidebarTab === 'system' ? (
              renderSystemOptionsContent(true)
            ) : (
              <ControlsSettingsPanel
                profile={inputBindings}
                deviceTab={controlsDeviceTab}
                onChangeDeviceTab={handleChangeControlsDeviceTab}
                onChangeMdPadType={handleChangeMdPadType}
                listeningTarget={listeningBinding}
                onStartListening={startListeningForBinding}
                onCancelListening={cancelListeningForBinding}
                onApplyKeyboardPreset={handleApplyKeyboardPreset}
                onResetCurrentDevice={handleResetCurrentDeviceBindings}
                onToggleLeftStick={handleToggleGamepadLeftStick}
                connectedGamepadName={connectedGamepadName}
                activeButtons={activeButtons}
                feedbackMessage={bindingFeedback}
              />
            )}
          </aside>
          </div>
        )
      ) : (
        /* =====================================================================
           MOBILE PHONE INTERFACE (isMobileDevice):
           - Portrait Mode (!isLandscape): Full-width screen at top + Game Gear deck below
           - Landscape Mode (isLandscape): Full-height centered screen + Left/Right Game Gear wings
           ===================================================================== */
        <>
          {!isLandscape ? (
            <div
              key="handheld-portrait"
              className="w-full h-full flex-1 min-h-0 bg-[#222731] flex flex-col justify-between overflow-hidden"
            >
              {/* Top Half (55% height): 100% Full-Width Screen with ZERO lateral padding or side elements */}
              <div className="w-full h-[55dvh] min-h-[200px] shrink-0 flex flex-col overflow-hidden">
                {renderGameGearScreenBezel(false)}
              </div>

              {/* Lower Game Gear Tactile Control Deck */}
              <div className="flex-1 min-h-0 flex flex-col justify-between px-4 py-2.5">
                {/* Middle Physical Controls Row: Left D-Pad + Right 1/2 Buttons */}
                <div className="flex-1 min-h-0 flex items-center justify-between px-1 sm:px-4">
                  {renderPhysicalDPad('w-32 h-32 sm:w-36 sm:h-36')}
                  {renderPhysicalActionButtons(false)}
                </div>

                {/* Bottom Center Physical Buttons: [ MENU ] and [ START ] */}
                <div className="pb-1 pt-1 shrink-0">
                  {renderPhysicalMenuAndStartButtons(false)}
                </div>
              </div>
            </div>
          ) : (
            <div
              key="handheld-landscape"
              className="w-full h-full flex-1 min-h-0 bg-[#222731] flex items-stretch justify-between overflow-hidden"
            >
              {/* Left Wing Grip: BATTERY LED at Top -> MENU button below BATTERY -> Resized D-Pad */}
              <div className="flex-1 h-full self-stretch flex flex-col items-center justify-between py-2.5 px-1.5 min-w-0 overflow-hidden">
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        consoleState === 'PLAYING'
                          ? 'bg-red-500 shadow-[0_0_8px_#ef4444]'
                          : 'bg-red-900/70'
                      }`}
                    />
                    <span className="font-mono text-[9px] font-bold tracking-widest text-slate-400">
                      BATTERY
                    </span>
                  </div>
                  {/* MENU Button placed on the left side directly below BATTERY */}
                  {renderPhysicalMenuButton(true)}
                </div>

                <div className="my-auto flex items-center justify-center">
                  {renderPhysicalDPad('w-20 h-20 sm:w-24 sm:h-24', true)}
                </div>

                <div className="w-12 h-2.5 rounded-md gg-speaker-grille opacity-80 shrink-0" />
              </div>

              {/* Center Viewport: Occupies 100% of the vertical screen height (h-full) and centered in the middle */}
              <div className="h-full self-stretch min-h-0 w-[58vw] sm:w-[64vw] max-w-[calc(100dvh*1.3333)] shrink-0 bg-black border-x-2 border-[#12151C] shadow-2xl flex flex-col overflow-hidden">
                {renderGameGearScreenBezel(true)}
              </div>

              {/* Right Wing Grip: Physical START button at Top (above buttons 1 & 2), Resized Action Buttons 1 & 2 in Center, Game Gear RGB Emblem at Bottom */}
              <div className="flex-1 h-full self-stretch flex flex-col items-center justify-between py-2.5 px-1.5 min-w-0 overflow-hidden">
                <div className="flex flex-col items-center justify-center pt-1">
                  {renderPhysicalStartButton(true)}
                </div>

                <div className="my-auto flex items-center justify-center">
                  {renderPhysicalActionButtons(true)}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="font-mono text-[9px] sm:text-[10px] font-extrabold tracking-widest text-slate-200 truncate">
                    {activeConsoleOption.bezelBrand}
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0" aria-hidden="true">
                    <span className="w-1.5 h-2.5 bg-red-500 rounded-xs -skew-x-12" />
                    <span className="w-1.5 h-2.5 bg-emerald-500 rounded-xs -skew-x-12" />
                    <span className="w-1.5 h-2.5 bg-blue-500 rounded-xs -skew-x-12" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Mobile & Tablet Bottom-to-Top Slide-Up MENU Drawer with Sistema | Controles Tabs */}
          {isBottomMenuOpen && (
            <div
              className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex flex-col justify-end"
              onClick={() => {
                cancelListeningForBinding();
                setIsBottomMenuOpen(false);
                setIsConsoleDropdownOpen(false);
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-xl mx-auto rounded-t-3xl border-t-2 border-slate-700 bg-[#121620] p-5 pb-8 shadow-2xl space-y-4 max-h-[86dvh] overflow-y-auto"
              >
                <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto -mt-1" />

                <div className="border-b border-slate-800 pb-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-slate-100">
                        Menú del Sistema SEGA
                      </h2>
                      <p className="text-xs text-slate-400">
                        {desktopSidebarTab === 'system'
                          ? 'Selecciona consola, carga ROMs o cambia el tipo de mando'
                          : 'Tipo de mando y reconfiguración de mando USB o Bluetooth'}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        cancelListeningForBinding();
                        setIsBottomMenuOpen(false);
                      }}
                      className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Mobile & Tablet Menu Tabs: Sistema | Controles */}
                  <div
                    role="tablist"
                    aria-label="Secciones del menú"
                    className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0B0E15] border border-slate-800"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={desktopSidebarTab === 'system'}
                      onClick={() => handleChangeDesktopSidebarTab('system')}
                      className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                        desktopSidebarTab === 'system'
                          ? 'bg-slate-800 text-slate-100 shadow-xs'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/70'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                      Sistema
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={desktopSidebarTab === 'controls'}
                      onClick={() => handleChangeDesktopSidebarTab('controls')}
                      className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                        desktopSidebarTab === 'controls'
                          ? 'bg-slate-800 text-slate-100 shadow-xs'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/70'
                      }`}
                    >
                      <Gamepad2 className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                      Controles
                    </button>
                  </div>
                </div>

                {desktopSidebarTab === 'system' ? (
                  renderSystemOptionsContent(false)
                ) : (
                  <ControlsSettingsPanel
                    profile={inputBindings}
                    deviceTab={controlsDeviceTab}
                    onChangeDeviceTab={handleChangeControlsDeviceTab}
                    onChangeMdPadType={handleChangeMdPadType}
                    listeningTarget={listeningBinding}
                    onStartListening={startListeningForBinding}
                    onCancelListening={cancelListeningForBinding}
                    onApplyKeyboardPreset={handleApplyKeyboardPreset}
                    onResetCurrentDevice={handleResetCurrentDeviceBindings}
                    onToggleLeftStick={handleToggleGamepadLeftStick}
                    connectedGamepadName={connectedGamepadName}
                    activeButtons={activeButtons}
                    feedbackMessage={bindingFeedback}
                  />
                )}
              </div>
            </div>
          )}
        </>
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
