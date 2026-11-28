import React from 'react';
import { Keyboard, Gamepad2, RotateCcw, Check, X } from 'lucide-react';
import {
  CONTROL_ACTION_SPECS,
  CONTROL_GROUPS,
  formatGamepadBindingLabel,
  formatKeyboardCodeLabel,
  InputBindingsProfile,
  KeyboardPresetId,
  MdButton,
  MdPadType,
} from '../input/inputBindings';

export interface ListeningBindingTarget {
  device: 'keyboard' | 'gamepad';
  button: MdButton;
}

interface ControlsSettingsPanelProps {
  profile: InputBindingsProfile;
  deviceTab: 'keyboard' | 'gamepad';
  onChangeDeviceTab: (tab: 'keyboard' | 'gamepad') => void;
  onChangeMdPadType: (padType: MdPadType) => void;
  listeningTarget: ListeningBindingTarget | null;
  onStartListening: (device: 'keyboard' | 'gamepad', button: MdButton) => void;
  onCancelListening: () => void;
  onApplyKeyboardPreset: (preset: KeyboardPresetId) => void;
  onResetCurrentDevice: () => void;
  onToggleLeftStick: (enabled: boolean) => void;
  connectedGamepadName: string | null;
  activeButtons: Record<MdButton, boolean>;
  feedbackMessage: string | null;
}

export const ControlsSettingsPanel: React.FC<ControlsSettingsPanelProps> = ({
  profile,
  deviceTab,
  onChangeDeviceTab,
  onChangeMdPadType,
  listeningTarget,
  onStartListening,
  onCancelListening,
  onApplyKeyboardPreset,
  onResetCurrentDevice,
  onToggleLeftStick,
  connectedGamepadName,
  activeButtons,
  feedbackMessage,
}) => {
  const isKeyboard = deviceTab === 'keyboard';
  const isThreeButtonMdPad = profile.mdPadType !== '6button';

  return (
    <div className="space-y-4">
      {/* Mega Drive Controller Type Selector (3-Button Default vs 6-Button Arcade Pad) */}
      <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/90 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-200">
            Tipo de Mando (Mega Drive)
          </span>
          <span className="font-mono text-[11px] text-sky-400">
            {isThreeButtonMdPad ? '3 Botones (A · B · C)' : '6 Botones (A-Z + MODE)'}
          </span>
        </div>
        <div
          role="radiogroup"
          aria-label="Tipo de mando Mega Drive"
          className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-950/90 border border-slate-800"
        >
          <button
            type="button"
            role="radio"
            aria-checked={isThreeButtonMdPad}
            onClick={() => onChangeMdPadType('3button')}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
              isThreeButtonMdPad
                ? 'bg-sky-400 text-slate-950 font-bold'
                : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/70'
            }`}
          >
            3 Botones (A·B·C)
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!isThreeButtonMdPad}
            onClick={() => onChangeMdPadType('6button')}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
              !isThreeButtonMdPad
                ? 'bg-sky-400 text-slate-950 font-bold'
                : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/70'
            }`}
          >
            6 Botones (A-Z)
          </button>
        </div>
      </div>

      {/* Device Sub-Tabs: Teclado | Mando USB / BT */}
      <div
        role="tablist"
        aria-label="Dispositivo de entrada"
        className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800"
      >
        <button
          type="button"
          role="tab"
          aria-selected={isKeyboard}
          onClick={() => onChangeDeviceTab('keyboard')}
          className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
            isKeyboard
              ? 'bg-sky-400 text-slate-950 font-bold'
              : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/70'
          }`}
        >
          <Keyboard className="w-4 h-4 shrink-0" />
          Teclado
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={!isKeyboard}
          onClick={() => onChangeDeviceTab('gamepad')}
          className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
            !isKeyboard
              ? 'bg-sky-400 text-slate-950 font-bold'
              : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/70'
          }`}
        >
          <Gamepad2 className="w-4 h-4 shrink-0" />
          Mando USB / BT
        </button>
      </div>

      {/* Contextual Device Controls Header (Presets for Keyboard, Connection & Analog Stick for Gamepad) */}
      {isKeyboard ? (
        <div className="space-y-2 pb-3 border-b border-slate-800/90">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
            <span>Perfiles rápidos de teclado</span>
            <span className="font-mono text-[11px] text-slate-500">
              Guardado automático
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onApplyKeyboardPreset('classic')}
              className="min-h-[38px] px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-sky-500/50 text-xs font-semibold text-slate-200 whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              Clásico
            </button>
            <button
              type="button"
              onClick={() => onApplyKeyboardPreset('wasd')}
              className="min-h-[38px] px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-sky-500/50 text-xs font-semibold text-slate-200 whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              WASD
            </button>
            <button
              type="button"
              onClick={onResetCurrentDevice}
              className="min-h-[38px] px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-amber-500/50 text-xs font-semibold text-slate-300 flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
              Restablecer
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 pb-3 border-b border-slate-800/90">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-300">
                Estado del mando USB / Bluetooth
              </span>
              <span
                className={`font-mono text-[11px] font-semibold ${
                  connectedGamepadName ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {connectedGamepadName ? 'Conectado' : 'Esperando mando'}
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed break-words">
              {connectedGamepadName
                ? connectedGamepadName
                : 'Conecta un mando USB o Bluetooth y pulsa cualquier botón para detectarlo.'}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              role="switch"
              aria-checked={profile.gamepadUseLeftStick}
              onClick={() => onToggleLeftStick(!profile.gamepadUseLeftStick)}
              className="flex-1 min-h-[40px] px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/90 hover:border-slate-700 flex items-center justify-between gap-3 text-left transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <span className="text-xs font-medium text-slate-200">
                Stick izquierdo en cruceta
              </span>
              <span
                className={`font-mono text-[11px] font-bold whitespace-nowrap ${
                  profile.gamepadUseLeftStick ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {profile.gamepadUseLeftStick ? 'ACTIVO' : 'INACTIVO'}
              </span>
            </button>

            <button
              type="button"
              onClick={onResetCurrentDevice}
              className="min-h-[40px] px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-amber-500/50 text-xs font-semibold text-slate-300 flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
              Restablecer
            </button>
          </div>
        </div>
      )}

      {/* Live Capture Instruction or Confirmation Feedback */}
      {listeningTarget && listeningTarget.device === deviceTab ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-amber-400/50 bg-amber-500/10 text-amber-200 text-xs"
        >
          <span className="font-medium">
            {isKeyboard
              ? 'Pulsa la nueva tecla ahora (Esc para cancelar)'
              : 'Pulsa un botón o mueve un eje del mando USB/BT (Esc para cancelar)'}
          </span>
          <button
            type="button"
            onClick={onCancelListening}
            className="px-2.5 py-1 rounded-md border border-amber-400/40 bg-slate-950/60 hover:bg-slate-900 text-amber-200 font-semibold text-[11px] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <X className="w-3 h-3" />
            Cancelar
          </button>
        </div>
      ) : feedbackMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 text-emerald-300 text-xs font-medium"
        >
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{feedbackMessage}</span>
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          Toca o haz clic en cualquier control para reasignarlo al instante en tu mando USB, Bluetooth o teclado.
        </p>
      )}

      {/* Control Groups List */}
      <div className="space-y-4">
        {CONTROL_GROUPS.map((group) => {
          if (group.id === 'sixButton' && isThreeButtonMdPad) {
            return null;
          }
          const actions = CONTROL_ACTION_SPECS.filter((a) => a.group === group.id);
          return (
            <section key={group.id} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 px-0.5">
                <h2 className="text-xs font-bold text-slate-200">{group.title}</h2>
                <span className="text-[11px] text-slate-500 truncate">
                  {group.subtitle}
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/75 divide-y divide-slate-800/80 overflow-hidden">
                {actions.map((action) => {
                  const isListeningThis =
                    listeningTarget?.device === deviceTab &&
                    listeningTarget.button === action.id;
                  const isPressedLive =
                    !listeningTarget && Boolean(activeButtons[action.id]);
                  const bindingLabel = isKeyboard
                    ? formatKeyboardCodeLabel(profile.keyboard[action.id])
                    : formatGamepadBindingLabel(profile.gamepad[action.id]);

                  return (
                    <div
                      key={action.id}
                      className={`min-h-[44px] px-3 py-2 flex items-center justify-between gap-3 transition-colors duration-150 ${
                        isListeningThis
                          ? 'bg-amber-500/10'
                          : isPressedLive
                            ? 'bg-emerald-500/10'
                            : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="min-w-0 flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-100 whitespace-nowrap">
                            {action.label}
                          </span>
                          {isPressedLive && (
                            <span className="font-mono text-[10px] font-bold text-emerald-400 whitespace-nowrap">
                              · ACTIVO
                            </span>
                          )}
                        </div>
                        {action.eightBitRole && (
                          <span className="text-[11px] text-slate-400 truncate">
                            {action.eightBitRole}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          if (isListeningThis) {
                            onCancelListening();
                          } else {
                            onStartListening(deviceTab, action.id);
                          }
                        }}
                        aria-label={`Asignar ${action.label} (${bindingLabel})`}
                        className={`min-w-[122px] max-w-[168px] min-h-[34px] px-3 py-1.5 rounded-lg border font-mono text-xs font-bold tabular-nums truncate text-center whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                          isListeningThis
                            ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                            : isPressedLive
                              ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200'
                              : 'border-slate-700 bg-slate-950/90 hover:border-sky-400/70 hover:text-sky-300 text-sky-300'
                        }`}
                      >
                        {isListeningThis
                          ? isKeyboard
                            ? 'Pulsa tecla...'
                            : 'Pulsa botón...'
                          : bindingLabel}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

