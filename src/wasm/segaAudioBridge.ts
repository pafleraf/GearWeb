/**
 * SEGA Game Gear & 8/16-Bit WebAudio Bridge
 * - Intercepts all browser AudioContexts (including Emscripten OpenAL / RWebAudio / SDL2)
 * - Unlocks mobile AudioContext silently on first touch gesture (iOS Safari & Android Chrome)
 * - Injects a sub-audible keep-alive signal (1e-5) so mobile browsers never suspend the
 *   hardware audio channel when Gearsystem / Genesis Plus GX emits silent (0.0) initial frames
 * - Routes all emulator audio connections through an active Master GainNode + Soft Limiter
 *   (DynamicsCompressorNode) for real-time Volume (0-100%) and PSG Pre-Amp Boost (1.0x - 3.0x)
 */

interface ManagedContextBundle {
  ctx: AudioContext;
  realDestination: AudioDestinationNode;
  masterGain: GainNode;
  compressor: DynamicsCompressorNode;
  keepAliveGain: GainNode;
  unlockedWithBuffer: boolean;
}

export interface SegaAudioSettings {
  enabled: boolean;
  volumePercent: number; // 0 to 100
  psgBoost: number; // 1.0 to 3.0
}

export interface SegaAudioStatus {
  isRunning: boolean;
  sampleRate: number;
  contextCount: number;
  effectiveMultiplier: number;
}

const managedBundles = new Map<AudioContext, ManagedContextBundle>();
let originalConnect: typeof AudioNode.prototype.connect | null = null;
let bridgeInstalled = false;
let prewarmedContext: AudioContext | null = null;

let currentSettings: SegaAudioSettings = {
  enabled: true,
  volumePercent: 90,
  psgBoost: 1.8,
};

function computeEffectiveGain(settings: SegaAudioSettings): number {
  if (!settings.enabled || settings.volumePercent <= 0) {
    return 0;
  }
  const normalizedVol = Math.max(0, Math.min(100, settings.volumePercent)) / 100;
  const clampedBoost = Math.max(1.0, Math.min(3.0, settings.psgBoost));
  return normalizedVol * clampedBoost;
}

function configureIosAudioSession(): void {
  if (typeof navigator === 'undefined') return;
  try {
    const navWithSession = navigator as Navigator & {
      audioSession?: { type?: string };
    };
    if (navWithSession.audioSession && navWithSession.audioSession.type !== 'playback') {
      navWithSession.audioSession.type = 'playback';
    }
  } catch {
    // Ignore on browsers without navigator.audioSession
  }
}

type ConnectNodeFn = (
  this: AudioNode,
  destinationNode: AudioNode,
  output?: number,
  input?: number
) => AudioNode;

type ConnectParamFn = (
  this: AudioNode,
  destinationParam: AudioParam,
  output?: number
) => void;

function connectAudioNodes(
  source: AudioNode,
  destination: AudioNode,
  output?: number,
  input?: number
): AudioNode {
  const fn = (originalConnect || AudioNode.prototype.connect) as unknown as ConnectNodeFn;
  if (output !== undefined && input !== undefined) {
    return fn.call(source, destination, output, input);
  }
  if (output !== undefined) {
    return fn.call(source, destination, output);
  }
  return fn.call(source, destination);
}

function attachManagedGraph(ctx: AudioContext): ManagedContextBundle {
  const existing = managedBundles.get(ctx);
  if (existing) return existing;

  const realDestination = ctx.destination;

  const masterGain = ctx.createGain();
  masterGain.gain.value = computeEffectiveGain(currentSettings);

  const compressor = ctx.createDynamicsCompressor();
  try {
    compressor.threshold.value = -6;
    compressor.knee.value = 12;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
  } catch {
    // Fallback if parameters are read-only in older WebKit
  }

  // Connect masterGain -> compressor -> realDestination using native connect
  connectAudioNodes(masterGain, compressor);
  connectAudioNodes(compressor, realDestination);

  // Sub-audible keep-alive signal (amplitude 1e-5) so iOS/Android never suspend
  // the AudioContext when Gearsystem emits silent initial PCM frames (0.0)
  const keepAliveGain = ctx.createGain();
  keepAliveGain.gain.value = 0.00001;
  connectAudioNodes(keepAliveGain, realDestination);

  try {
    if (typeof ctx.createConstantSource === 'function') {
      const constSource = ctx.createConstantSource();
      constSource.offset.value = 1.0;
      connectAudioNodes(constSource, keepAliveGain);
      constSource.start();
    } else {
      const subOsc = ctx.createOscillator();
      subOsc.frequency.value = 1;
      connectAudioNodes(subOsc, keepAliveGain);
      subOsc.start();
    }
  } catch {
    // Ignore if oscillator start is deferred
  }

  const bundle: ManagedContextBundle = {
    ctx,
    realDestination,
    masterGain,
    compressor,
    keepAliveGain,
    unlockedWithBuffer: false,
  };

  managedBundles.set(ctx, bundle);
  return bundle;
}

function playSilentUnlockSample(bundle: ManagedContextBundle): void {
  if (bundle.unlockedWithBuffer) return;
  const { ctx, realDestination } = bundle;

  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 48000);
    const channelData = buffer.getChannelData(0);
    channelData[0] = 0.00001;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    connectAudioNodes(source, realDestination);
    source.start(0);
    if (ctx.state === 'running') {
      bundle.unlockedWithBuffer = true;
    }
  } catch {
    // Will retry on next user gesture
  }
}

export function registerExternalAudioContext(ctx: AudioContext | null | undefined): void {
  if (!ctx || typeof ctx.createGain !== 'function') return;
  const bundle = attachManagedGraph(ctx);
  applyGainToBundle(bundle, currentSettings);
}

function applyGainToBundle(bundle: ManagedContextBundle, settings: SegaAudioSettings): void {
  const { ctx, masterGain } = bundle;
  if (ctx.state === 'closed') {
    managedBundles.delete(ctx);
    return;
  }

  const targetGain = computeEffectiveGain(settings);
  try {
    masterGain.gain.value = targetGain;
    if (typeof masterGain.gain.setTargetAtTime === 'function') {
      masterGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.015);
    }
  } catch {
    // Ignore gain scheduling errors
  }

  if (settings.enabled && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

function patchWakeLockForIframePolicy(): void {
  if (typeof navigator === 'undefined') return;
  try {
    const createMockSentinel = () => ({
      released: false,
      type: 'screen' as const,
      onrelease: null,
      release: async () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    });

    if ('wakeLock' in navigator && navigator.wakeLock) {
      const originalRequest = navigator.wakeLock.request?.bind(navigator.wakeLock);
      if (typeof originalRequest === 'function') {
        try {
          navigator.wakeLock.request = async (type: WakeLockType = 'screen') => {
            try {
              return await originalRequest(type);
            } catch {
              return createMockSentinel() as unknown as WakeLockSentinel;
            }
          };
          return;
        } catch {
          // If navigator.wakeLock.request is read-only on prototype, patch WakeLock.prototype.request
        }
      }
    }

    const WakeLockProto =
      typeof WakeLock !== 'undefined'
        ? WakeLock.prototype
        : navigator.wakeLock
          ? Object.getPrototypeOf(navigator.wakeLock)
          : null;

    if (WakeLockProto && typeof WakeLockProto.request === 'function') {
      const protoRequest = WakeLockProto.request;
      WakeLockProto.request = async function (this: WakeLock, type: WakeLockType = 'screen') {
        try {
          return await protoRequest.call(this, type);
        } catch {
          return createMockSentinel() as unknown as WakeLockSentinel;
        }
      };
    }
  } catch {
    // Ignore if wakeLock cannot be patched
  }
}

export function installSegaAudioBridge(): void {
  if (bridgeInstalled || typeof window === 'undefined') return;
  bridgeInstalled = true;

  configureIosAudioSession();
  patchWakeLockForIframePolicy();

  // 1. Intercept AudioNode.prototype.connect so any Emscripten node connecting to
  //    ctx.destination is transparently routed through our Master Gain + Compressor bus
  originalConnect = AudioNode.prototype.connect;
  const nativeConnectParam = originalConnect as unknown as ConnectParamFn;

  const patchedConnect = function (
    this: AudioNode,
    destinationNodeOrParam: AudioNode | AudioParam,
    output?: number,
    input?: number
  ): AudioNode | void {
    try {
      const ctx = this.context as AudioContext;
      if (ctx && typeof ctx.createGain === 'function' && destinationNodeOrParam === ctx.destination) {
        const bundle = attachManagedGraph(ctx);
        // Prevent recursive redirection for our own compressor / keepAliveGain
        if (this !== bundle.compressor && this !== bundle.keepAliveGain) {
          return connectAudioNodes(this, bundle.masterGain, output ?? 0, 0);
        }
      }
    } catch {
      // Fallback to native connect
    }

    if (destinationNodeOrParam instanceof AudioNode) {
      return connectAudioNodes(this, destinationNodeOrParam, output, input);
    }

    if (output !== undefined) {
      return nativeConnectParam.call(this, destinationNodeOrParam, output);
    }
    return nativeConnectParam.call(this, destinationNodeOrParam);
  };

  AudioNode.prototype.connect = patchedConnect as typeof AudioNode.prototype.connect;

  // 2. Wrap window.AudioContext & window.webkitAudioContext so every newly created
  //    context is immediately attached to the Master Gain + Keep-Alive graph
  const NativeAudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (NativeAudioContext) {
    const WrappedAudioContext = function (
      this: AudioContext,
      options?: AudioContextOptions
    ) {
      const mergedOptions: AudioContextOptions = {
        latencyHint: 'interactive',
        ...options,
      };
      let ctx: AudioContext;
      try {
        ctx = new NativeAudioContext(mergedOptions);
      } catch {
        ctx = new NativeAudioContext();
      }
      const bundle = attachManagedGraph(ctx);
      applyGainToBundle(bundle, currentSettings);
      playSilentUnlockSample(bundle);
      return ctx;
    } as unknown as typeof AudioContext;

    WrappedAudioContext.prototype = NativeAudioContext.prototype;
    Object.setPrototypeOf(WrappedAudioContext, NativeAudioContext);

    window.AudioContext = WrappedAudioContext;
    if ('webkitAudioContext' in window) {
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext =
        WrappedAudioContext;
    }
  }
}

/**
 * Must be invoked on user gestures (touchstart, pointerdown, click, keydown)
 * and right after emulator launch to unlock and resume all AudioContexts.
 */
export function unlockAndResumeAudioContexts(): void {
  configureIosAudioSession();

  // Pre-warm a shared AudioContext on the very first user gesture so mobile OS
  // grants WebAudio playback permission immediately before any async ROM download
  if (!prewarmedContext && typeof window !== 'undefined') {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      try {
        prewarmedContext = new AudioCtx({ latencyHint: 'interactive', sampleRate: 48000 });
      } catch {
        try {
          prewarmedContext = new AudioCtx();
        } catch {
          // ignore
        }
      }
    }
  }

  managedBundles.forEach((bundle, ctx) => {
    if (ctx.state === 'closed') {
      managedBundles.delete(ctx);
      return;
    }
    if (currentSettings.enabled && ctx.state !== 'running') {
      ctx.resume().catch(() => {});
    }
    playSilentUnlockSample(bundle);
    applyGainToBundle(bundle, currentSettings);
  });
}

/**
 * Inspects a running Nostalgist / Emscripten instance for any internal OpenAL,
 * SDL2, or RWebAudio contexts & gain nodes, ensuring none are muted or suspended.
 */
export function inspectAndBoostEmscriptenAudio(nostalgistInstance: unknown): void {
  if (!nostalgistInstance || typeof nostalgistInstance !== 'object') return;

  try {
    const inst = nostalgistInstance as {
      getEmscriptenAL?: () => unknown;
      getEmscripten?: () => unknown;
      getEmscriptenModule?: () => unknown;
    };

    const harvestAudioCtx = (candidate: unknown) => {
      if (!candidate || typeof candidate !== 'object') return;
      const maybeCtx = candidate as AudioContext;
      if (typeof maybeCtx.createGain === 'function' && 'destination' in maybeCtx) {
        registerExternalAudioContext(maybeCtx);
        if (currentSettings.enabled && maybeCtx.state !== 'running') {
          maybeCtx.resume().catch(() => {});
        }
      }
    };

    // 1. Check Emscripten OpenAL (AL.currentCtx & AL.contexts)
    const al = inst.getEmscriptenAL?.() as
      | {
          currentCtx?: { audioCtx?: AudioContext; gain?: GainNode };
          contexts?: Record<string, { audioCtx?: AudioContext; gain?: GainNode }>;
        }
      | undefined;

    if (al?.currentCtx) {
      harvestAudioCtx(al.currentCtx.audioCtx);
      if (al.currentCtx.gain?.gain) {
        al.currentCtx.gain.gain.value = computeEffectiveGain(currentSettings);
      }
    }
    if (al?.contexts) {
      Object.values(al.contexts).forEach((c) => {
        harvestAudioCtx(c?.audioCtx);
        if (c?.gain?.gain) {
          c.gain.gain.value = computeEffectiveGain(currentSettings);
        }
      });
    }

    // 2. Check Emscripten RWebAudio / SDL2 objects
    const em = inst.getEmscripten?.() as Record<string, unknown> | undefined;
    const mod = inst.getEmscriptenModule?.() as Record<string, unknown> | undefined;

    for (const root of [em, mod]) {
      if (!root || typeof root !== 'object') continue;
      const rwa = (root as { RWebAudio?: { context?: AudioContext } }).RWebAudio;
      if (rwa?.context) harvestAudioCtx(rwa.context);

      const sdl2 = (root as { SDL2?: { audioContext?: AudioContext } }).SDL2;
      if (sdl2?.audioContext) harvestAudioCtx(sdl2.audioContext);

      const directCtx = (root as { audioContext?: AudioContext }).audioContext;
      if (directCtx) harvestAudioCtx(directCtx);
    }
  } catch {
    // Ignore inspection errors on uninitialized modules
  }

  unlockAndResumeAudioContexts();
}

export function setMasterAudioSettings(next: Partial<SegaAudioSettings>): SegaAudioSettings {
  currentSettings = {
    ...currentSettings,
    ...next,
  };

  managedBundles.forEach((bundle) => {
    applyGainToBundle(bundle, currentSettings);
  });

  return currentSettings;
}

export function getMasterAudioSettings(): SegaAudioSettings {
  return { ...currentSettings };
}

export function getAudioEngineStatus(): SegaAudioStatus {
  let isRunning = false;
  let sampleRate = 48000;
  let activeCount = 0;

  managedBundles.forEach(({ ctx }) => {
    if (ctx.state !== 'closed') {
      activeCount++;
      if (ctx.state === 'running') {
        isRunning = true;
        sampleRate = ctx.sampleRate || 48000;
      }
    }
  });

  return {
    isRunning,
    sampleRate,
    contextCount: activeCount,
    effectiveMultiplier: Number(computeEffectiveGain(currentSettings).toFixed(2)),
  };
}
