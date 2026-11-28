export type MdButton =
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

export type MdPadType = '3button' | '6button';

export type GamepadBinding =
  | { type: 'button'; index: number }
  | { type: 'axis'; index: number; direction: -1 | 1 };

export interface InputBindingsProfile {
  version: 1;
  mdPadType: MdPadType;
  keyboard: Record<MdButton, string>;
  gamepad: Record<MdButton, GamepadBinding>;
  gamepadUseLeftStick: boolean;
}

export type KeyboardPresetId = 'classic' | 'wasd';

export interface ControlActionSpec {
  id: MdButton;
  label: string;
  eightBitRole?: string;
  group: 'dpad' | 'primary' | 'sixButton';
}

export const INPUT_BINDINGS_STORAGE_KEY = 'sega_emulator_input_bindings_v1';

export const SIX_BUTTON_EXTRA_BUTTONS: MdButton[] = ['x', 'y', 'z', 'mode'];

export const MD_BUTTON_LIST: MdButton[] = [
  'up',
  'down',
  'left',
  'right',
  'a',
  'b',
  'c',
  'x',
  'y',
  'z',
  'start',
  'mode',
];

export const CONTROL_ACTION_SPECS: ControlActionSpec[] = [
  { id: 'up', label: 'Arriba', group: 'dpad' },
  { id: 'down', label: 'Abajo', group: 'dpad' },
  { id: 'left', label: 'Izquierda', group: 'dpad' },
  { id: 'right', label: 'Derecha', group: 'dpad' },
  { id: 'a', label: 'Botón A', eightBitRole: 'Botón 1 en 8-Bit', group: 'primary' },
  { id: 'b', label: 'Botón B', eightBitRole: 'Botón 2 en 8-Bit', group: 'primary' },
  { id: 'c', label: 'Botón C', eightBitRole: 'Solo 16-Bit', group: 'primary' },
  { id: 'start', label: 'START', eightBitRole: 'PAUSE en 8-Bit', group: 'primary' },
  { id: 'x', label: 'Botón X', group: 'sixButton' },
  { id: 'y', label: 'Botón Y', group: 'sixButton' },
  { id: 'z', label: 'Botón Z', group: 'sixButton' },
  { id: 'mode', label: 'MODE', group: 'sixButton' },
];

export const CONTROL_GROUPS: {
  id: 'dpad' | 'primary' | 'sixButton';
  title: string;
  subtitle: string;
}[] = [
  {
    id: 'dpad',
    title: 'Cruceta (D-Pad)',
    subtitle: 'Dirección en todas las consolas',
  },
  {
    id: 'primary',
    title: 'Acción Principal',
    subtitle: 'Compartido entre 8-Bit y 16-Bit',
  },
  {
    id: 'sixButton',
    title: 'Botones Extra 6-Botones',
    subtitle: 'SEGA Mega Drive / Genesis',
  },
];

export const DEFAULT_KEYBOARD_BINDINGS: Record<MdButton, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  a: 'KeyZ',
  b: 'KeyX',
  c: 'KeyC',
  x: 'KeyA',
  y: 'KeyS',
  z: 'KeyD',
  start: 'Enter',
  mode: 'ShiftRight',
};

export const WASD_KEYBOARD_BINDINGS: Record<MdButton, string> = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  a: 'KeyJ',
  b: 'KeyK',
  c: 'KeyL',
  x: 'KeyU',
  y: 'KeyI',
  z: 'KeyO',
  start: 'Enter',
  mode: 'ShiftRight',
};

export const DEFAULT_GAMEPAD_BINDINGS: Record<MdButton, GamepadBinding> = {
  up: { type: 'button', index: 12 },
  down: { type: 'button', index: 13 },
  left: { type: 'button', index: 14 },
  right: { type: 'button', index: 15 },
  a: { type: 'button', index: 0 },
  b: { type: 'button', index: 1 },
  c: { type: 'button', index: 5 },
  x: { type: 'button', index: 2 },
  y: { type: 'button', index: 3 },
  z: { type: 'button', index: 4 },
  start: { type: 'button', index: 9 },
  mode: { type: 'button', index: 8 },
};

// Genesis Plus GX Libretro controller port device IDs:
// RETRO_DEVICE_MDPAD_3B = RETRO_DEVICE_SUBCLASS(RETRO_DEVICE_JOYPAD, 0) = 257
// RETRO_DEVICE_MDPAD_6B = RETRO_DEVICE_SUBCLASS(RETRO_DEVICE_JOYPAD, 1) = 513
export const GENESIS_PLUS_GX_DEVICE_MDPAD_3B = 257;
export const GENESIS_PLUS_GX_DEVICE_MDPAD_6B = 513;

export interface RetroArchKeySpec {
  key: string;
  code: string;
  keyCode: number;
  retroButton: string;
}

// Genesis Plus GX 16-Bit Mega Drive / Genesis mapping:
// Mega Drive A -> RetroPad 'y' (input_player1_y = 'a')
// Mega Drive B -> RetroPad 'b' (input_player1_b = 'z')
// Mega Drive C -> RetroPad 'a' (input_player1_a = 'x')
// Mega Drive X -> RetroPad 'l' (input_player1_l = 'd')
// Mega Drive Y -> RetroPad 'x' (input_player1_x = 's')
// Mega Drive Z -> RetroPad 'r' (input_player1_r = 'c')
export const RETROARCH_KEY_MAP: Record<MdButton, RetroArchKeySpec> = {
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, retroButton: 'up' },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, retroButton: 'down' },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, retroButton: 'left' },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, retroButton: 'right' },
  a: { key: 'a', code: 'KeyA', keyCode: 65, retroButton: 'y' },
  b: { key: 'z', code: 'KeyZ', keyCode: 90, retroButton: 'b' },
  c: { key: 'x', code: 'KeyX', keyCode: 88, retroButton: 'a' },
  x: { key: 'd', code: 'KeyD', keyCode: 68, retroButton: 'l' },
  y: { key: 's', code: 'KeyS', keyCode: 83, retroButton: 'x' },
  z: { key: 'c', code: 'KeyC', keyCode: 67, retroButton: 'r' },
  start: { key: 'Enter', code: 'Enter', keyCode: 13, retroButton: 'start' },
  mode: { key: 'Shift', code: 'ShiftRight', keyCode: 16, retroButton: 'select' },
};

// 8-Bit (Game Gear / Master System / SG-1000) mapping:
// Button 1 (a) -> RetroPad 'b' (input_player1_b = 'z')
// Button 2 (b) -> RetroPad 'a' (input_player1_a = 'x')
export const RETROARCH_8BIT_KEY_MAP: Record<MdButton, RetroArchKeySpec> = {
  ...RETROARCH_KEY_MAP,
  a: { key: 'z', code: 'KeyZ', keyCode: 90, retroButton: 'b' },
  b: { key: 'x', code: 'KeyX', keyCode: 88, retroButton: 'a' },
  c: { key: 'c', code: 'KeyC', keyCode: 67, retroButton: 'r' },
};

export function getRetroArchKeySpec(
  button: MdButton,
  isEightBit: boolean
): RetroArchKeySpec {
  return isEightBit ? RETROARCH_8BIT_KEY_MAP[button] : RETROARCH_KEY_MAP[button];
}

// Set of raw DOM codes that RetroArch listens to internally, used to block stale/remapped keys
export const RETROARCH_INTERNAL_CODES = new Set<string>(
  Object.values(RETROARCH_KEY_MAP).map((spec) => spec.code)
);

export function createDefaultInputBindingsProfile(): InputBindingsProfile {
  return {
    version: 1,
    mdPadType: '3button',
    keyboard: { ...DEFAULT_KEYBOARD_BINDINGS },
    gamepad: cloneGamepadMap(DEFAULT_GAMEPAD_BINDINGS),
    gamepadUseLeftStick: true,
  };
}

function cloneGamepadMap(
  source: Record<MdButton, GamepadBinding>
): Record<MdButton, GamepadBinding> {
  const result = {} as Record<MdButton, GamepadBinding>;
  for (const btn of MD_BUTTON_LIST) {
    result[btn] = { ...source[btn] };
  }
  return result;
}

function isValidGamepadBinding(value: unknown): value is GamepadBinding {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === 'button') {
    return (
      typeof candidate.index === 'number' &&
      Number.isInteger(candidate.index) &&
      candidate.index >= 0 &&
      candidate.index <= 64
    );
  }
  if (candidate.type === 'axis') {
    return (
      typeof candidate.index === 'number' &&
      Number.isInteger(candidate.index) &&
      candidate.index >= 0 &&
      candidate.index <= 16 &&
      (candidate.direction === -1 || candidate.direction === 1)
    );
  }
  return false;
}

export function loadInputBindingsProfile(): InputBindingsProfile {
  const defaults = createDefaultInputBindingsProfile();
  if (typeof window === 'undefined' || !window.localStorage) {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(INPUT_BINDINGS_STORAGE_KEY);
    if (!raw) return defaults;

    const parsed = JSON.parse(raw) as Partial<InputBindingsProfile> | null;
    if (!parsed || typeof parsed !== 'object') return defaults;

    const mdPadType: MdPadType =
      parsed.mdPadType === '6button' || parsed.mdPadType === '3button'
        ? parsed.mdPadType
        : '3button';

    const keyboard: Record<MdButton, string> = { ...defaults.keyboard };
    if (parsed.keyboard && typeof parsed.keyboard === 'object') {
      for (const btn of MD_BUTTON_LIST) {
        const val = (parsed.keyboard as Record<string, unknown>)[btn];
        if (typeof val === 'string' && val.trim().length > 0 && val.length <= 40) {
          keyboard[btn] = val;
        }
      }
    }

    const gamepad: Record<MdButton, GamepadBinding> = cloneGamepadMap(defaults.gamepad);
    if (parsed.gamepad && typeof parsed.gamepad === 'object') {
      for (const btn of MD_BUTTON_LIST) {
        const val = (parsed.gamepad as Record<string, unknown>)[btn];
        if (isValidGamepadBinding(val)) {
          gamepad[btn] = { ...val };
        }
      }
    }

    const gamepadUseLeftStick =
      typeof parsed.gamepadUseLeftStick === 'boolean'
        ? parsed.gamepadUseLeftStick
        : defaults.gamepadUseLeftStick;

    return {
      version: 1,
      mdPadType,
      keyboard,
      gamepad,
      gamepadUseLeftStick,
    };
  } catch {
    return defaults;
  }
}

export function saveInputBindingsProfile(profile: InputBindingsProfile): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(INPUT_BINDINGS_STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function isSameGamepadBinding(a: GamepadBinding, b: GamepadBinding): boolean {
  if (a.type !== b.type || a.index !== b.index) return false;
  if (a.type === 'axis' && b.type === 'axis') {
    return a.direction === b.direction;
  }
  return true;
}

export function assignKeyboardBinding(
  profile: InputBindingsProfile,
  targetButton: MdButton,
  newCode: string
): { nextProfile: InputBindingsProfile; swappedWith: MdButton | null } {
  const nextKeyboard: Record<MdButton, string> = { ...profile.keyboard };
  const previousCode = nextKeyboard[targetButton];
  let swappedWith: MdButton | null = null;

  for (const btn of MD_BUTTON_LIST) {
    if (btn !== targetButton && nextKeyboard[btn] === newCode) {
      nextKeyboard[btn] = previousCode;
      swappedWith = btn;
      break;
    }
  }

  nextKeyboard[targetButton] = newCode;

  return {
    nextProfile: {
      ...profile,
      keyboard: nextKeyboard,
    },
    swappedWith,
  };
}

export function assignGamepadBinding(
  profile: InputBindingsProfile,
  targetButton: MdButton,
  newBinding: GamepadBinding
): { nextProfile: InputBindingsProfile; swappedWith: MdButton | null } {
  const nextGamepad = cloneGamepadMap(profile.gamepad);
  const previousBinding = { ...nextGamepad[targetButton] };
  let swappedWith: MdButton | null = null;

  for (const btn of MD_BUTTON_LIST) {
    if (btn !== targetButton && isSameGamepadBinding(nextGamepad[btn], newBinding)) {
      nextGamepad[btn] = previousBinding;
      swappedWith = btn;
      break;
    }
  }

  nextGamepad[targetButton] = { ...newBinding };

  return {
    nextProfile: {
      ...profile,
      gamepad: nextGamepad,
    },
    swappedWith,
  };
}

export function applyKeyboardPreset(
  profile: InputBindingsProfile,
  preset: KeyboardPresetId
): InputBindingsProfile {
  const presetMap =
    preset === 'wasd' ? WASD_KEYBOARD_BINDINGS : DEFAULT_KEYBOARD_BINDINGS;
  return {
    ...profile,
    keyboard: { ...presetMap },
  };
}

export function isGamepadBindingActive(
  gp: Gamepad,
  binding: GamepadBinding,
  axisDeadzone = 0.48
): boolean {
  if (binding.type === 'button') {
    const btn = gp.buttons[binding.index];
    if (!btn) return false;
    return Boolean(btn.pressed || btn.value > 0.5);
  }
  const axisVal = gp.axes[binding.index] ?? 0;
  return binding.direction === 1 ? axisVal > axisDeadzone : axisVal < -axisDeadzone;
}

export function getActionLabel(button: MdButton): string {
  return CONTROL_ACTION_SPECS.find((s) => s.id === button)?.label ?? button.toUpperCase();
}

export function formatKeyboardCodeLabel(code: string): string {
  if (!code) return 'Sin asignar';

  const specialMap: Record<string, string> = {
    ArrowUp: 'Flecha ↑',
    ArrowDown: 'Flecha ↓',
    ArrowLeft: 'Flecha ←',
    ArrowRight: 'Flecha →',
    Space: 'Espacio',
    Enter: 'Enter',
    NumpadEnter: 'Num Enter',
    ShiftLeft: 'Shift Izq',
    ShiftRight: 'Shift Der',
    ControlLeft: 'Ctrl Izq',
    ControlRight: 'Ctrl Der',
    AltLeft: 'Alt Izq',
    AltRight: 'Alt Der',
    Backspace: 'Retroceso',
    Tab: 'Tab',
    CapsLock: 'Bloq Mayús',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    Backslash: '\\',
    Insert: 'Insert',
    Delete: 'Supr',
    Home: 'Inicio',
    End: 'Fin',
    PageUp: 'Re Pág',
    PageDown: 'Av Pág',
  };

  if (specialMap[code]) return specialMap[code];
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function formatGamepadBindingLabel(binding: GamepadBinding): string {
  if (binding.type === 'axis') {
    const dir = binding.direction > 0 ? '+' : '-';
    if (binding.index === 0) return `Stick IZQ ${binding.direction > 0 ? '→' : '←'}`;
    if (binding.index === 1) return `Stick IZQ ${binding.direction > 0 ? '↓' : '↑'}`;
    if (binding.index === 2) return `Stick DER ${binding.direction > 0 ? '→' : '←'}`;
    if (binding.index === 3) return `Stick DER ${binding.direction > 0 ? '↓' : '↑'}`;
    return `Eje ${binding.index} (${dir})`;
  }

  const standardNames: Record<number, string> = {
    0: 'Botón 0 (A/✕)',
    1: 'Botón 1 (B/○)',
    2: 'Botón 2 (X/□)',
    3: 'Botón 3 (Y/△)',
    4: 'LB (Botón 4)',
    5: 'RB (Botón 5)',
    6: 'LT (Botón 6)',
    7: 'RT (Botón 7)',
    8: 'Select (8)',
    9: 'Start (9)',
    10: 'L3 (10)',
    11: 'R3 (11)',
    12: 'Cruceta ↑ (12)',
    13: 'Cruceta ↓ (13)',
    14: 'Cruceta ← (14)',
    15: 'Cruceta → (15)',
    16: 'Home (16)',
  };

  return standardNames[binding.index] ?? `Botón ${binding.index}`;
}
