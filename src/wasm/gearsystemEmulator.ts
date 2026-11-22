import { WasmRuntimeInstance } from './gearsystemWasmCore';

export type ConsoleSystemType = 'MEGA_DRIVE_16' | 'SMS_NTSC' | 'SMS_PAL' | 'GAME_GEAR' | 'SG_1000';

export type FighterCharacter = 'CODY' | 'GUY' | 'HAGGAR' | 'MAKI';

export interface RomCartridge {
  id: string;
  title: string;
  author: string;
  sourceUrl?: string;
  system: ConsoleSystemType;
  mapper: 'SEGA_MD_4MB' | 'SEGA_MAPPER' | 'CODEMASTERS' | 'SG1000_RAW';
  sizeBytes: number;
  crc32: string;
  year: string;
  genre: string;
  description: string;
  controlsHint: string;
  data: Uint8Array;
}

export interface ControllerState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  button1: boolean; // Attack / Punch / Combo (A / B / Z)
  button2: boolean; // Jump / Flying Kick (C / X)
  button3: boolean; // Special Spin Attack (S / Space)
  pause: boolean;   // Start / Pause
}

export interface BrawlerEnemy {
  id: number;
  name: string;
  type: 'BRED' | 'J' | 'AXL' | 'DAMND';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  vx: number;
  hitTimer: number;
  attackCooldown: number;
  facingLeft: boolean;
}

export interface SaveSlotState {
  slotId: number;
  romId: string;
  romTitle: string;
  timestamp: string;
  score: number;
  stageNumber: number;
  fighter: FighterCharacter;
  playerX: number;
  playerY: number;
  playerHp: number;
  frameCount: number;
}

// Built-in ROM Library — Preloaded with Final Fight MD (MXRetroDev) at index 0
export const BUILTIN_CARTRIDGES: RomCartridge[] = [
  {
    id: 'final-fight-md-mxretrodev',
    title: 'Final Fight MD (Demo Edition v1.85)',
    author: 'MXRetroDev (Mauro Xavier)',
    sourceUrl: 'https://mxretrodev.itch.io/final-fight-md',
    system: 'MEGA_DRIVE_16',
    mapper: 'SEGA_MD_4MB',
    sizeBytes: 4194304,
    crc32: '0xFF68B420',
    year: '2026',
    genre: "Beat 'em up / Arcade",
    description:
      'Port homebrew de alto rendimiento a 60 FPS creado desde cero por Mauro Xavier (MXRetroDev) para hardware SEGA con Cody, Guy, Haggar y Maki, modo Mega/Arcade y audio FM + PSG.',
    controlsHint:
      'Flechas/WASD: Caminar por Metro City · Z/J: Combo de Puños · X/K: Salto / Patada Voladora · Espacio/C: Ataque Especial Giratorio',
    data: createSyntheticRomData('SEGA MEGA DRIVE FINAL FIGHT MD MXRETRODEV', 0x05),
  },
  {
    id: 'out-horizon-sms',
    title: 'Cyber OutRunners 1988 (Master System)',
    author: 'Gearsystem Homebrew Team',
    system: 'SMS_NTSC',
    mapper: 'SEGA_MAPPER',
    sizeBytes: 131072,
    crc32: '0x4E91B703',
    year: '1988',
    genre: 'Arcade Racing',
    description:
      'Carreras pseudo-3D con efectos raster por línea de escaneo (H-Scroll VDP) y sintetizador SN76489 de 3 canales.',
    controlsHint: 'Izquierda/Derecha: Girar en carretera · Z/Espacio: Turbo Nitro',
    data: createSyntheticRomData('TMR SEGA OUTRUN88', 0x02),
  },
  {
    id: 'gg-astro-valkyrie',
    title: 'Astro Valkyrie DX (Game Gear 160×144)',
    author: 'Sega 8-Bit Dev',
    system: 'GAME_GEAR',
    mapper: 'SEGA_MAPPER',
    sizeBytes: 262144,
    crc32: '0xC23D9A10',
    year: '1992',
    genre: 'Shoot-em-up Espacial',
    description:
      'Shooter vertical con paleta de 4096 colores de Game Gear, sonido estéreo PSG y campo de estrellas parallax.',
    controlsHint: 'Flechas/WASD: Mover nave · Z/Espacio: Cañón de Plasma',
    data: createSyntheticRomData('TMR SEGA ASTROGG', 0x03),
  },
  {
    id: 'sega-vdp-grid-suite',
    title: 'Gearsystem VDP 240p Calibration Suite',
    author: 'Hardware Test Group',
    system: 'SMS_NTSC',
    mapper: 'SEGA_MAPPER',
    sizeBytes: 32768,
    crc32: '0x8F4A2C91',
    year: '2025',
    genre: 'Diagnóstico Hardware',
    description:
      'Suite de calibración de color VDP Mode 4, geometría CRT 240p, prueba de 64 sprites por hardware e interrupciones a 60Hz.',
    controlsHint: 'Flechas/WASD: Mover cursor de prueba · Z: Cambiar color de sprite',
    data: createSyntheticRomData('TMR SEGA VDP SUITE', 0x01),
  },
  {
    id: 'sg1000-brick-breaker',
    title: 'SG-1000 / SC-3000 Star Matrix (1983)',
    author: 'Sega Enterprises Retro',
    system: 'SG_1000',
    mapper: 'SG1000_RAW',
    sizeBytes: 16384,
    crc32: '0x11A05F88',
    year: '1983',
    genre: 'Arcade Clásico',
    description:
      'Demostración del chip gráfico TMS9918A Graphics Mode II de la primera consola de Sega con paleta fija de 16 colores.',
    controlsHint: 'Flechas/WASD: Mover · Z/Espacio: Disparar láser',
    data: createSyntheticRomData('TMR SEGA SG1000', 0x04),
  },
];

function createSyntheticRomData(headerTag: string, seed: number): Uint8Array {
  const rom = new Uint8Array(65536);
  const z80AndM68kPattern = [
    0xf3, 0x31, 0xf0, 0xdf, 0x4e, 0x71, 0x30, 0x3c, 0x01, 0x00, 0xd3, 0xbf, 0x21, 0x00, 0x40, 0x11,
    0x00, 0xc0, 0x01, 0x20, 0x00, 0xed, 0xb0, 0xfb, 0xc3, 0x10, 0x01,
  ];
  for (let i = 0; i < rom.length; i++) {
    rom[i] = (z80AndM68kPattern[i % z80AndM68kPattern.length] ^ ((i * seed) & 0xff)) & 0xff;
  }
  const encoder = new TextEncoder();
  // Write SEGA header at 0x0100 (Mega Drive / Genesis standard) & 0x7FF0 (Master System TMR SEGA)
  const mdHeader = encoder.encode(headerTag.slice(0, 48));
  rom.set(mdHeader, 0x0100);
  const tmrTag = encoder.encode('TMR SEGA');
  rom.set(tmrTag, 0x7ff0);
  rom[0] = seed;
  return rom;
}

export class GearsystemEngine {
  private wasm: WasmRuntimeInstance;
  private activeRom: RomCartridge;
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private soundEnabled = false;

  // Player & Final Fight MD Interactive Brawler State
  public fighter: FighterCharacter = 'CODY';
  public shipX = 56;
  public shipY = 148;
  public playerZJump = 0;
  public playerVz = 0;
  public playerFacingLeft = false;
  public playerHp = 100;
  public playerMaxHp = 100;
  public playerLives = 3;
  public score = 12400;
  public stageNumber = 1;
  public comboCount = 0;
  public comboTimer = 0;
  public attackAnimTimer = 0;
  public attackType: 'NONE' | 'PUNCH' | 'KICK' | 'SPECIAL' = 'NONE';
  public cameraScrollX = 0;
  public lastHitEnemyName = 'BRED';
  public lastHitEnemyHp = 60;
  public lastHitEnemyMaxHp = 60;

  public enemies: BrawlerEnemy[] = [];
  public objectsX = [45, 110, 185, 220];
  public objectsY = [20, -40, -95, -140];
  public projectiles: { x: number; y: number }[] = [];

  private prevBtn1 = false;
  private prevBtn2 = false;
  private prevBtn3 = false;

  constructor(wasm: WasmRuntimeInstance, initialRom: RomCartridge) {
    this.wasm = wasm;
    this.activeRom = initialRom;
    this.loadRom(initialRom);
  }

  public setFighter(character: FighterCharacter) {
    this.fighter = character;
  }

  public loadRom(rom: RomCartridge) {
    this.activeRom = rom;
    const modeMap: Record<ConsoleSystemType, number> = {
      MEGA_DRIVE_16: 4,
      SMS_NTSC: 0,
      SMS_PAL: 1,
      GAME_GEAR: 2,
      SG_1000: 3,
    };
    this.wasm.exports.gs_init(modeMap[rom.system]);

    // Copy first 16KB of ROM into WASM linear memory mirror at 0x0100
    const sliceLen = Math.min(rom.data.length, 0x4000);
    this.wasm.heapU8.set(rom.data.subarray(0, sliceLen), 0x0100);

    // Populate VDP VRAM (0x4100..0x80FF)
    for (let i = 0; i < 0x4000; i++) {
      this.wasm.heapU8[0x4100 + i] = rom.data[i % rom.data.length] ^ ((i >> 2) & 0xff);
    }

    this.shipX = rom.data[0] === 0x05 ? 64 : 128;
    this.shipY = 148;
    this.playerZJump = 0;
    this.playerVz = 0;
    this.playerHp = 100;
    this.score = rom.data[0] === 0x05 ? 12400 : 0;
    this.stageNumber = 1;
    this.comboCount = 0;
    this.cameraScrollX = 0;
    this.projectiles = [];
    this.spawnMadGearWave(1);

    this.wasm.heapU32[11] = this.shipX;
    this.wasm.heapU32[12] = this.shipY;
    this.wasm.heapU32[15] = this.score;
  }

  private spawnMadGearWave(stage: number) {
    const names: Array<{ name: string; type: BrawlerEnemy['type']; hp: number }> = [
      { name: 'BRED', type: 'BRED', hp: 50 + stage * 10 },
      { name: 'J. MAD GEAR', type: 'J', hp: 60 + stage * 12 },
      { name: 'AXL SLASH', type: 'AXL', hp: 85 + stage * 15 },
      { name: 'THRASH DAMND', type: 'DAMND', hp: 120 + stage * 20 },
    ];
    this.enemies = [
      {
        id: 1,
        name: names[0].name,
        type: names[0].type,
        x: 175,
        y: 138,
        hp: names[0].hp,
        maxHp: names[0].hp,
        vx: -0.4,
        hitTimer: 0,
        attackCooldown: 60,
        facingLeft: true,
      },
      {
        id: 2,
        name: names[1].name,
        type: names[1].type,
        x: 215,
        y: 158,
        hp: names[1].hp,
        maxHp: names[1].hp,
        vx: -0.5,
        hitTimer: 0,
        attackCooldown: 90,
        facingLeft: true,
      },
      {
        id: 3,
        name: names[(stage + 1) % names.length].name,
        type: names[(stage + 1) % names.length].type,
        x: 242,
        y: 128,
        hp: names[(stage + 1) % names.length].hp,
        maxHp: names[(stage + 1) % names.length].hp,
        vx: -0.35,
        hitTimer: 0,
        attackCooldown: 110,
        facingLeft: true,
      },
    ];
    this.lastHitEnemyName = this.enemies[0].name;
    this.lastHitEnemyHp = this.enemies[0].hp;
    this.lastHitEnemyMaxHp = this.enemies[0].maxHp;
  }

  public createSaveState(slotId: number): SaveSlotState {
    return {
      slotId,
      romId: this.activeRom.id,
      romTitle: this.activeRom.title,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      score: this.score,
      stageNumber: this.stageNumber,
      fighter: this.fighter,
      playerX: Math.round(this.shipX),
      playerY: Math.round(this.shipY),
      playerHp: this.playerHp,
      frameCount: this.wasm.exports.gs_get_reg(13),
    };
  }

  public loadSaveState(state: SaveSlotState) {
    this.score = state.score;
    this.stageNumber = state.stageNumber;
    this.fighter = state.fighter;
    this.shipX = state.playerX;
    this.shipY = state.playerY;
    this.playerHp = state.playerHp;
    this.wasm.heapU32[11] = this.shipX;
    this.wasm.heapU32[12] = this.shipY;
    this.wasm.heapU32[15] = this.score;
  }

  public toggleAudio(enabled: boolean) {
    this.soundEnabled = enabled;
    if (enabled) {
      if (!this.audioCtx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.audioCtx = new AudioCtx();
        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.value = 0.045;
        this.gainNode.connect(this.audioCtx.destination);

        // YM2612 / SN76489 Hybrid Synth Channels
        this.osc1 = this.audioCtx.createOscillator();
        this.osc1.type = 'sawtooth';
        this.osc1.frequency.value = 220;
        this.osc1.connect(this.gainNode);
        this.osc1.start();

        this.osc2 = this.audioCtx.createOscillator();
        this.osc2.type = 'square';
        this.osc2.frequency.value = 110;
        this.osc2.connect(this.gainNode);
        this.osc2.start();
      } else if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    } else if (this.audioCtx && this.audioCtx.state === 'running') {
      this.audioCtx.suspend();
    }
  }

  public stepFrame(ctrl: ControllerState): {
    frameCount: number;
    pc: number;
    sp: number;
    af: number;
    bc: number;
    de: number;
    hl: number;
    cycles: number;
    vdpStatus: number;
    fpsTarget: number;
  } {
    let mask = 0;
    if (ctrl.up) mask |= 0x01;
    if (ctrl.down) mask |= 0x02;
    if (ctrl.left) mask |= 0x04;
    if (ctrl.right) mask |= 0x08;
    if (ctrl.button1) mask |= 0x10;
    if (ctrl.button2) mask |= 0x20;
    if (ctrl.button3) mask |= 0x80;
    if (ctrl.pause) mask |= 0x40;

    const isFinalFight = this.activeRom.data[0] === 0x05;

    // Execute real WASM Z80 / Bus frame step
    const cyclesPerFrame = this.activeRom.system === 'SMS_PAL' ? 70937 : 59736;
    const frameCount = this.wasm.exports.gs_step_frame(mask, cyclesPerFrame);

    if (isFinalFight) {
      this.stepFinalFightBrawler(ctrl, frameCount);
    } else {
      this.stepClassic8BitDemo(ctrl, frameCount);
    }

    // Sync interactive registers back to WASM linear memory
    this.wasm.heapU32[2] = 0x0140 ^ ((mask & 0xff) << 8);
    this.wasm.heapU32[3] = (this.wasm.heapU32[3] + 0x13) & 0xffff;
    this.wasm.heapU32[4] = (0xc000 + (frameCount & 0x1fff)) & 0xffff;
    this.wasm.heapU32[5] = (0x4000 + ((frameCount * 32) & 0x3fff)) & 0xffff;
    this.wasm.heapU32[8] = 0x80 | (frameCount % 3 === 0 ? 0x20 : 0x00);
    this.wasm.heapU32[11] = Math.round(this.shipX);
    this.wasm.heapU32[12] = Math.round(this.shipY);
    this.wasm.heapU32[15] = this.score;

    // Synthesize YM2612 / SN76489 Slums of Metro City Bassline + Lead
    if (this.soundEnabled && this.audioCtx && this.osc1 && this.osc2) {
      const leadNotes = isFinalFight
        ? [329.63, 392.0, 440.0, 493.88, 523.25, 493.88, 440.0, 392.0]
        : [220, 261.63, 329.63, 392.0, 440, 523.25, 392.0, 329.63];
      const step = Math.floor(frameCount / 7) % leadNotes.length;
      const bassNotes = isFinalFight
        ? [82.41, 82.41, 98.0, 110.0, 123.47, 110.0, 98.0, 82.41]
        : [110, 110, 146.83, 164.81];
      const bassStep = Math.floor(frameCount / 14) % bassNotes.length;
      const now = this.audioCtx.currentTime;
      const attackPitchBoost = this.attackAnimTimer > 0 ? 140 : 0;
      this.osc1.frequency.setValueAtTime(leadNotes[step] + attackPitchBoost, now);
      this.osc2.frequency.setValueAtTime(bassNotes[bassStep], now);
    }

    // Render VDP Framebuffer directly into WASM Linear Memory at 0x8100 (256 x 192 RGBA32)
    this.renderVdpFramebufferToWasm(frameCount, ctrl);

    this.prevBtn1 = ctrl.button1;
    this.prevBtn2 = ctrl.button2;
    this.prevBtn3 = ctrl.button3;

    return {
      frameCount,
      pc: this.wasm.exports.gs_get_reg(0),
      sp: this.wasm.exports.gs_get_reg(1),
      af: this.wasm.exports.gs_get_reg(2),
      bc: this.wasm.exports.gs_get_reg(3),
      de: this.wasm.exports.gs_get_reg(4),
      hl: this.wasm.exports.gs_get_reg(5),
      cycles: this.wasm.exports.gs_get_reg(10),
      vdpStatus: this.wasm.exports.gs_get_reg(8),
      fpsTarget: this.activeRom.system === 'SMS_PAL' ? 50 : 60,
    };
  }

  private stepFinalFightBrawler(ctrl: ControllerState, frameCount: number) {
    // Fighter speed profile (Guy/Maki faster, Haggar stronger)
    const walkSpeed = this.fighter === 'GUY' || this.fighter === 'MAKI' ? 2.1 : this.fighter === 'HAGGAR' ? 1.5 : 1.8;

    if (ctrl.left) {
      this.shipX = Math.max(18, this.shipX - walkSpeed);
      this.playerFacingLeft = true;
    }
    if (ctrl.right) {
      this.shipX = Math.min(234, this.shipX + walkSpeed);
      this.playerFacingLeft = false;
      if (this.shipX > 150) {
        this.cameraScrollX = (this.cameraScrollX + 1.2) % 512;
      }
    }
    // Depth movement on Metro City street floor (Y between 116 and 176)
    if (ctrl.up) this.shipY = Math.max(116, this.shipY - walkSpeed * 0.75);
    if (ctrl.down) this.shipY = Math.min(176, this.shipY + walkSpeed * 0.75);

    // Jump physics (Button 2)
    if (ctrl.button2 && !this.prevBtn2 && this.playerZJump === 0) {
      this.playerVz = 5.4;
    }
    if (this.playerZJump > 0 || this.playerVz > 0) {
      this.playerZJump += this.playerVz;
      this.playerVz -= 0.36;
      if (this.playerZJump <= 0) {
        this.playerZJump = 0;
        this.playerVz = 0;
      }
    }

    if (this.attackAnimTimer > 0) {
      this.attackAnimTimer--;
      if (this.attackAnimTimer === 0) {
        this.attackType = 'NONE';
      }
    }

    if (this.comboTimer > 0) {
      this.comboTimer--;
      if (this.comboTimer === 0) this.comboCount = 0;
    }

    // Trigger Punch / Kick / Special Spin Attack
    const punchTriggered = ctrl.button1 && (!this.prevBtn1 || frameCount % 9 === 0);
    const specialTriggered = ctrl.button3 && !this.prevBtn3;

    if (specialTriggered) {
      this.attackType = 'SPECIAL';
      this.attackAnimTimer = 18;
      this.checkBrawlerHit(40, 26, 28);
    } else if (punchTriggered) {
      this.attackType = this.playerZJump > 4 ? 'KICK' : 'PUNCH';
      this.attackAnimTimer = 10;
      const dmg = this.fighter === 'HAGGAR' ? 24 : 16;
      this.checkBrawlerHit(32, 16, dmg);
    }

    // Update Mad Gear Enemies AI
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.hitTimer > 0) {
        e.hitTimer--;
        continue;
      }

      const dx = this.shipX - e.x;
      const dy = this.shipY - e.y;
      e.facingLeft = dx < 0;

      if (Math.abs(dx) > 22) {
        e.x += Math.sign(dx) * (0.65 + (i % 2) * 0.2);
      }
      if (Math.abs(dy) > 6) {
        e.y += Math.sign(dy) * 0.45;
      }

      // Enemy punch if close
      if (Math.abs(dx) <= 22 && Math.abs(dy) <= 10 && this.playerZJump < 8) {
        if (e.attackCooldown <= 0) {
          this.playerHp = Math.max(10, this.playerHp - 6);
          e.attackCooldown = 75;
        } else {
          e.attackCooldown--;
        }
      }
    }

    // Respawn wave when cleared
    if (this.enemies.length === 0) {
      this.stageNumber++;
      this.playerHp = Math.min(100, this.playerHp + 25);
      this.spawnMadGearWave(this.stageNumber);
    }
  }

  private checkBrawlerHit(rangeX: number, rangeY: number, damage: number) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = e.x - this.shipX;
      const dy = Math.abs(e.y - this.shipY);
      const inDirection =
        this.attackType === 'SPECIAL' ||
        (!this.playerFacingLeft && dx >= -6 && dx <= rangeX) ||
        (this.playerFacingLeft && dx <= 6 && dx >= -rangeX);

      if (inDirection && dy <= rangeY) {
        e.hp = Math.max(0, e.hp - damage);
        e.hitTimer = 12;
        e.x = Math.max(12, Math.min(244, e.x + (this.playerFacingLeft ? -10 : 10)));
        this.comboCount++;
        this.comboTimer = 90;
        this.score += damage * 25;
        this.lastHitEnemyName = e.name;
        this.lastHitEnemyHp = e.hp;
        this.lastHitEnemyMaxHp = e.maxHp;

        if (e.hp <= 0) {
          this.score += 1000;
          this.enemies.splice(i, 1);
        }
      }
    }
  }

  private stepClassic8BitDemo(ctrl: ControllerState, frameCount: number) {
    const speed = 2.5;
    if (ctrl.left) this.shipX = Math.max(20, this.shipX - speed);
    if (ctrl.right) this.shipX = Math.min(236, this.shipX + speed);
    if (ctrl.up) this.shipY = Math.max(24, this.shipY - speed);
    if (ctrl.down) this.shipY = Math.min(174, this.shipY + speed);

    if (ctrl.button1 && frameCount % 8 === 0) {
      this.projectiles.push({ x: Math.round(this.shipX), y: Math.round(this.shipY - 8) });
    }

    this.projectiles = this.projectiles
      .map((p) => ({ x: p.x, y: p.y - 5 }))
      .filter((p) => p.y > 4);

    for (let i = 0; i < this.objectsY.length; i++) {
      this.objectsY[i] += 1.4 + i * 0.25;
      if (this.objectsY[i] > 192) {
        this.objectsY[i] = -16;
        this.objectsX[i] = 28 + ((frameCount * 37 + i * 53) % 200);
      }

      for (let j = this.projectiles.length - 1; j >= 0; j--) {
        const p = this.projectiles[j];
        if (Math.abs(p.x - this.objectsX[i]) < 12 && Math.abs(p.y - this.objectsY[i]) < 12) {
          this.score += 100;
          this.objectsY[i] = -20;
          this.objectsX[i] = 28 + ((frameCount * 43 + i * 67) % 200);
          this.projectiles.splice(j, 1);
          break;
        }
      }
    }
  }

  private renderVdpFramebufferToWasm(frame: number, ctrl: ControllerState) {
    const fbByteOffset = this.wasm.exports.gs_get_fb_ptr();
    const fb32 = new Uint32Array(this.wasm.memory.buffer, fbByteOffset, 256 * 192);
    const seed = this.activeRom.data[0] || 1;
    const sx = Math.round(this.shipX);
    const sy = Math.round(this.shipY);

    const packRGBA = (r: number, g: number, b: number) =>
      (0xff << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);

    if (seed === 0x05) {
      // =========================================================================
      // FINAL FIGHT MD (MXRetroDev Edition) — Metro City Slums Stage 1 Beat 'Em Up
      // =========================================================================
      const scroll = Math.floor(this.cameraScrollX);

      for (let y = 0; y < 192; y++) {
        const rowOffset = y * 256;
        if (y < 32) {
          // Top Arcade HUD Banner (Black bar with gold/red lifeline border)
          const hudBg = y === 31 ? packRGBA(75, 85, 115) : packRGBA(8, 10, 18);
          for (let x = 0; x < 256; x++) {
            fb32[rowOffset + x] = hudBg;
          }
        } else if (y < 104) {
          // Metro City Night Sky & Brick Slum Warehouse Wall
          const isBrickWall = y >= 56;
          for (let x = 0; x < 256; x++) {
            const wx = (x + scroll) & 0xff;
            if (!isBrickWall) {
              // Distant city skyline silhouette + neon sign
              const bldgHeight = 36 + (((wx >> 4) * 19) % 18);
              if (y > bldgHeight) {
                const winLit = wx % 8 === 2 && y % 6 === 2;
                fb32[rowOffset + x] = winLit
                  ? packRGBA(250, 204, 21)
                  : packRGBA(24, 28, 48);
              } else {
                fb32[rowOffset + x] = packRGBA(12, 16, 34);
              }
            } else {
              // Red/Brown Slum Brick Warehouse Wall with periodic Garage Doors
              const inDoor = wx >= 80 && wx < 136 && y >= 64;
              if (inDoor) {
                const slat = (y % 4 === 0) ? packRGBA(45, 55, 72) : packRGBA(71, 85, 105);
                fb32[rowOffset + x] = slat;
              } else {
                const brickRow = Math.floor((y - 56) / 6);
                const mortarY = (y - 56) % 6 === 0;
                const mortarX = (wx + (brickRow % 2) * 6) % 12 === 0;
                fb32[rowOffset + x] =
                  mortarY || mortarX
                    ? packRGBA(42, 26, 24)
                    : packRGBA(118, 44, 38);
              }
            }
          }
        } else if (y < 112) {
          // Curb / Sidewalk Edge
          const curbCol = y < 108 ? packRGBA(148, 163, 184) : packRGBA(71, 85, 105);
          for (let x = 0; x < 256; x++) {
            const gx = (x + Math.floor(scroll * 1.4)) % 24;
            fb32[rowOffset + x] = gx === 0 ? packRGBA(30, 41, 59) : curbCol;
          }
        } else {
          // Metro City Asphalt Street Floor (Y: 112..191)
          const depthShade = Math.floor((y - 112) * 0.25);
          const asphalt = packRGBA(36 + depthShade, 40 + depthShade, 54 + depthShade);
          const laneDash = packRGBA(234, 179, 8);
          for (let x = 0; x < 256; x++) {
            const sxFloor = (x + Math.floor(scroll * 1.5)) & 0xff;
            if (y >= 146 && y <= 148 && sxFloor % 32 < 18) {
              fb32[rowOffset + x] = laneDash;
            } else {
              fb32[rowOffset + x] = asphalt;
            }
          }
        }
      }

      // Draw HUD Lifebars at top (Player 1 Left, Enemy Right)
      this.drawFinalFightHud(fb32, packRGBA);

      // Draw Mad Gear Gang Enemies
      for (const enemy of this.enemies) {
        this.drawBrawlerCharacter(
          fb32,
          Math.round(enemy.x),
          Math.round(enemy.y),
          0,
          enemy.facingLeft,
          enemy.hitTimer > 0
            ? packRGBA(255, 255, 255)
            : enemy.type === 'DAMND'
            ? packRGBA(192, 38, 211)
            : enemy.type === 'AXL'
            ? packRGBA(234, 179, 8)
            : packRGBA(220, 38, 38),
          packRGBA(30, 41, 59),
          false,
          'NONE',
          frame,
          packRGBA
        );
      }

      // Determine Fighter Outfit Colors (Cody: White/Blue, Guy: Orange/Red, Haggar: Olive/Brown, Maki: Crimson)
      const shirtColor =
        this.fighter === 'CODY'
          ? packRGBA(248, 250, 252)
          : this.fighter === 'GUY'
          ? packRGBA(249, 115, 22)
          : this.fighter === 'HAGGAR'
          ? packRGBA(217, 119, 6)
          : packRGBA(239, 68, 68);

      const pantsColor =
        this.fighter === 'CODY'
          ? packRGBA(37, 99, 235)
          : this.fighter === 'GUY'
          ? packRGBA(194, 65, 12)
          : this.fighter === 'HAGGAR'
          ? packRGBA(63, 98, 18)
          : packRGBA(185, 28, 28);

      // Draw Playable Hero (Cody / Guy / Haggar / Maki)
      this.drawBrawlerCharacter(
        fb32,
        sx,
        sy,
        Math.round(this.playerZJump),
        this.playerFacingLeft,
        shirtColor,
        pantsColor,
        true,
        this.attackType,
        frame,
        packRGBA
      );
      return;
    }

    if (seed === 0x01) {
      // 1. VDP 240p Suite & Hardware Sprite Benchmark
      const bgDark = packRGBA(12, 20, 44);
      const gridLine = packRGBA(36, 68, 138);
      const borderRed = packRGBA(218, 44, 67);

      for (let y = 0; y < 192; y++) {
        const rowOffset = y * 256;
        for (let x = 0; x < 256; x++) {
          let col = bgDark;
          if (x % 16 === 0 || y % 16 === 0) col = gridLine;
          if (
            x === 0 ||
            x === 255 ||
            y === 0 ||
            y === 191 ||
            x === 8 ||
            x === 247 ||
            y === 8 ||
            y === 183
          ) {
            col = borderRed;
          }
          if (y >= 18 && y <= 42 && x >= 16 && x < 240) {
            const bar = Math.floor((x - 16) / 28);
            const palette = [
              packRGBA(240, 240, 240),
              packRGBA(245, 215, 32),
              packRGBA(32, 215, 235),
              packRGBA(36, 218, 78),
              packRGBA(225, 48, 215),
              packRGBA(235, 45, 45),
              packRGBA(35, 75, 240),
              packRGBA(18, 18, 24),
            ];
            col = palette[bar % palette.length];
          }
          fb32[rowOffset + x] = col;
        }
      }
    } else if (seed === 0x02) {
      // 2. Cyber OutRunners 1988
      for (let y = 0; y < 192; y++) {
        const rowOffset = y * 256;
        if (y < 88) {
          const skyCol =
            y < 35 ? packRGBA(18, 12, 52) : y < 65 ? packRGBA(48, 22, 92) : packRGBA(120, 38, 110);
          for (let x = 0; x < 256; x++) {
            const dx = x - 128;
            const dy = y - 62;
            if (dx * dx + dy * dy < 520 && (y % 4 !== 0 || y < 56)) {
              fb32[rowOffset + x] = packRGBA(255, 190 - dy * 2, 45);
            } else {
              fb32[rowOffset + x] = skyCol;
            }
          }
        } else {
          const perspective = (y - 88) / 104;
          const curve = Math.sin(frame * 0.03 + perspective * 2.2) * (1 - perspective) * 45;
          const roadCenter = 128 + curve - (this.shipX - 128) * 0.45;
          const roadHalfWidth = 18 + perspective * 95;
          const stripePhase = Math.floor((y + frame * 3) / (6 + perspective * 10)) % 2;

          const grassCol = stripePhase ? packRGBA(16, 118, 62) : packRGBA(12, 94, 50);
          const roadCol = stripePhase ? packRGBA(64, 68, 82) : packRGBA(54, 58, 72);
          const curbCol = stripePhase ? packRGBA(235, 45, 55) : packRGBA(245, 245, 245);

          for (let x = 0; x < 256; x++) {
            const dist = Math.abs(x - roadCenter);
            if (dist < roadHalfWidth - 6) {
              fb32[rowOffset + x] = dist < 2 && stripePhase ? packRGBA(250, 210, 40) : roadCol;
            } else if (dist < roadHalfWidth) {
              fb32[rowOffset + x] = curbCol;
            } else {
              fb32[rowOffset + x] = grassCol;
            }
          }
        }
      }
    } else {
      // 3 & 4: Astro Valkyrie DX (GG) & SG-1000 Starfield Matrix
      const bg = seed === 0x03 ? packRGBA(6, 10, 26) : packRGBA(0, 0, 0);
      fb32.fill(bg);

      for (let s = 0; s < 48; s++) {
        const starX = (s * 73 + 19) % 256;
        const speed = (s % 3) + 1;
        const starY = (s * 41 + frame * speed) % 192;
        const starCol =
          speed === 3
            ? packRGBA(255, 255, 255)
            : speed === 2
            ? packRGBA(110, 185, 255)
            : packRGBA(65, 95, 165);
        fb32[starY * 256 + starX] = starCol;
      }

      for (let i = 0; i < this.objectsX.length; i++) {
        const ox = Math.round(this.objectsX[i]);
        const oy = Math.round(this.objectsY[i]);
        const enemyCol = packRGBA(245, 75, 95);
        const coreCol = packRGBA(255, 225, 70);
        for (let dy = -6; dy <= 6; dy++) {
          for (let dx = -6; dx <= 6; dx++) {
            const px = ox + dx;
            const py = oy + dy;
            if (px >= 0 && px < 256 && py >= 0 && py < 192) {
              if (Math.abs(dx) + Math.abs(dy) <= 8) {
                fb32[py * 256 + px] = Math.abs(dx) <= 2 && Math.abs(dy) <= 2 ? coreCol : enemyCol;
              }
            }
          }
        }
      }
    }

    // Draw active projectiles
    const laserCol = packRGBA(56, 245, 255);
    for (const p of this.projectiles) {
      for (let dy = -4; dy <= 2; dy++) {
        const py = p.y + dy;
        if (py >= 0 && py < 192 && p.x >= 0 && p.x < 256) {
          fb32[py * 256 + p.x] = laserCol;
          if (p.x + 1 < 256) fb32[py * 256 + p.x + 1] = laserCol;
        }
      }
    }

    // Draw interactive player ship sprite
    const hullCol = ctrl.button1 ? packRGBA(255, 215, 45) : packRGBA(56, 189, 248);
    const wingCol = packRGBA(226, 232, 240);
    const flameCol = frame % 4 < 2 ? packRGBA(251, 146, 60) : packRGBA(239, 68, 68);

    for (let dy = -7; dy <= 7; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const px = sx + dx;
        const py = sy + dy;
        if (px >= 0 && px < 256 && py >= 0 && py < 192) {
          if (dy >= -7 && dy <= 4 && Math.abs(dx) <= (dy + 8) >> 1) {
            fb32[py * 256 + px] = Math.abs(dx) <= 2 ? hullCol : wingCol;
          } else if (dy > 4 && Math.abs(dx) <= 2) {
            fb32[py * 256 + px] = flameCol;
          }
        }
      }
    }

    // Game Gear 160x144 viewport mask outline
    if (this.activeRom.system === 'GAME_GEAR') {
      const ggBorder = packRGBA(45, 212, 191);
      for (let y = 0; y < 192; y++) {
        for (let x = 0; x < 256; x++) {
          const insideX = x >= 48 && x < 208;
          const insideY = y >= 24 && y < 168;
          if (!insideX || !insideY) {
            const cur = fb32[y * 256 + x];
            const r = (cur & 0xff) >> 2;
            const g = ((cur >> 8) & 0xff) >> 2;
            const b = ((cur >> 16) & 0xff) >> 2;
            fb32[y * 256 + x] = packRGBA(r, g, b);
          }
          if (((x === 48 || x === 207) && insideY) || ((y === 24 || y === 167) && insideX)) {
            fb32[y * 256 + x] = ggBorder;
          }
        }
      }
    }
  }

  private drawFinalFightHud(
    fb32: Uint32Array,
    packRGBA: (r: number, g: number, b: number) => number
  ) {
    const borderWhite = packRGBA(248, 250, 252);
    const barRed = packRGBA(220, 38, 38);
    const barYellow = packRGBA(250, 204, 21);
    const barCyan = packRGBA(56, 189, 248);

    // Player 1 Health Bar (X: 14..104, Y: 10..17)
    const pWidth = Math.round((this.playerHp / this.playerMaxHp) * 88);
    for (let y = 10; y <= 17; y++) {
      for (let x = 14; x <= 104; x++) {
        if (y === 10 || y === 17 || x === 14 || x === 104) {
          fb32[y * 256 + x] = borderWhite;
        } else if (x - 15 < pWidth) {
          fb32[y * 256 + x] = y < 14 ? barYellow : packRGBA(234, 138, 0);
        } else {
          fb32[y * 256 + x] = barRed;
        }
      }
    }

    // Active Enemy Health Bar (X: 150..240, Y: 10..17)
    const eRatio = this.lastHitEnemyMaxHp > 0 ? this.lastHitEnemyHp / this.lastHitEnemyMaxHp : 0;
    const eWidth = Math.round(eRatio * 88);
    for (let y = 10; y <= 17; y++) {
      for (let x = 150; x <= 240; x++) {
        if (y === 10 || y === 17 || x === 150 || x === 240) {
          fb32[y * 256 + x] = borderWhite;
        } else if (x - 151 < eWidth) {
          fb32[y * 256 + x] = barCyan;
        } else {
          fb32[y * 256 + x] = packRGBA(69, 10, 10);
        }
      }
    }
  }

  private drawBrawlerCharacter(
    fb32: Uint32Array,
    cx: number,
    cy: number,
    zJump: number,
    facingLeft: boolean,
    torsoCol: number,
    legsCol: number,
    isHero: boolean,
    attackMode: 'NONE' | 'PUNCH' | 'KICK' | 'SPECIAL',
    frame: number,
    packRGBA: (r: number, g: number, b: number) => number
  ) {
    const skinCol = packRGBA(253, 186, 116);
    const hairCol = isHero ? packRGBA(250, 204, 21) : packRGBA(15, 23, 42);
    const shadowCol = packRGBA(15, 23, 42);
    const hitFlashCol = packRGBA(56, 245, 255);

    // Draw ground shadow at (cx, cy)
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && px < 256 && py >= 32 && py < 192 && dx * dx + dy * dy * 6 <= 64) {
          fb32[py * 256 + px] = shadowCol;
        }
      }
    }

    const drawY = cy - zJump;
    const walkCycle = Math.floor(frame / 6) % 2;

    // Draw Sprite Body (28px tall: head -28..-21, torso -20..-10, legs -9..0)
    for (let dy = -28; dy <= 0; dy++) {
      for (let dx = -7; dx <= 7; dx++) {
        const px = cx + dx;
        const py = drawY + dy;
        if (px < 0 || px >= 256 || py < 32 || py >= 192) continue;

        if (dy < -21) {
          // Head & Hair
          if (Math.abs(dx) <= 4) {
            fb32[py * 256 + px] = dy < -25 ? hairCol : skinCol;
          }
        } else if (dy < -10) {
          // Muscular Torso
          if (Math.abs(dx) <= 6) {
            fb32[py * 256 + px] = torsoCol;
          }
        } else {
          // Legs with walk stride
          const leftLeg = dx >= -5 && dx <= -1;
          const rightLeg = dx >= 1 && dx <= 5;
          if ((leftLeg && (walkCycle === 0 || dy < -3)) || (rightLeg && (walkCycle === 1 || dy < -3))) {
            fb32[py * 256 + px] = legsCol;
          }
        }
      }
    }

    // Draw Punch / Kick / Special Spin Attack Limb Extension
    if (attackMode !== 'NONE') {
      const dir = facingLeft ? -1 : 1;
      const reach = attackMode === 'SPECIAL' ? 22 : attackMode === 'KICK' ? 18 : 15;
      const limbY = attackMode === 'KICK' ? drawY - 10 : drawY - 17;

      for (let r = 5; r <= reach; r++) {
        for (let ty = -3; ty <= 3; ty++) {
          const px = cx + dir * r;
          const py = limbY + ty;
          if (px >= 0 && px < 256 && py >= 32 && py < 192) {
            fb32[py * 256 + px] = r > reach - 5 ? hitFlashCol : skinCol;
          }
          // If SPECIAL spin attack, draw on both sides
          if (attackMode === 'SPECIAL') {
            const pxOpp = cx - dir * r;
            if (pxOpp >= 0 && pxOpp < 256 && py >= 32 && py < 192) {
              fb32[py * 256 + pxOpp] = r > reach - 5 ? hitFlashCol : skinCol;
            }
          }
        }
      }
    }
  }
}
