/* Beach Hamster - free-roam shoreline runner simulation & Canvas 2D renderer. */
(function () {
  'use strict';
  window.BH = window.BH || {};

  const Snd = BH.Audio;
  const In = BH.Input;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stageEl = document.getElementById('stage');

  const $ = function (id) { return document.getElementById(id); };

  const TAU = Math.PI * 2;
  const ORIENT_KEY = 'bh_orient';
  const HIGH_KEY = 'bh_high_v1';

  /* ---- Logical Canvas Sizes ---- */
  const DIMS = {
    landscape: { w: 1280, h: 720 },
    portrait: { w: 720, h: 1280 }
  };

  let orientPref = 'auto'; // 'auto' | 'portrait' | 'landscape'
  try {
    const savedOrient = localStorage.getItem(ORIENT_KEY);
    if (savedOrient === 'auto' || savedOrient === 'portrait' || savedOrient === 'landscape') {
      orientPref = savedOrient;
    }
  } catch (e) { }

  let effectiveOrient = 'landscape';
  let W = 1280;
  let H = 720;

  let highScore = 0;
  try {
    highScore = Math.max(0, parseInt(localStorage.getItem(HIGH_KEY) || '0', 10) || 0);
  } catch (e) { }

  /* ---- Game State ---- */
  let mode = 'menu'; // 'menu' | 'play' | 'pause' | 'over'
  let elapsed = 0;
  let cameraX = 0;
  let exploredMinX = 0;
  let exploredMaxX = 1280;
  let shellScore = 0;
  let totalSandDollars = 0;
  let tierCounts = { common: 0, medium: 0, pearl: 0, star: 0 };
  let lives = 3;
  let maxLives = 3;
  let invulnTimer = 0;
  let hurtShake = 0;
  let newHighFlag = false;

  // Streak combo, speed burst & tide cycle states
  let streakCount = 0;
  let streakTimer = 0;
  const STREAK_WINDOW = 2.6;
  let speedBurstTimer = 0;
  let speedBurstSparkleTimer = 0;
  let tideState = 'low';
  let tideBanner = {
    text: '',
    sub: '',
    color: '',
    timer: 0,
    dur: 2.4
  };

  const player = {
    x: 0,
    y: 340,
    vx: 0,
    vy: 0,
    facing: 1, // 1 = right, -1 = left
    r: 16,
    bob: 0,
    lean: 0,
    squash: 0
  };

  let shells = [];
  let crabs = [];
  let mounds = [];
  let waves = [];
  let gulls = [];
  let particles = [];
  let popups = [];
  let clouds = [];
  let decor = [];
  let tracks = [];

  let timers = {
    crab: 1.5,
    mound: 4.5,
    wave: 1.6,
    gull: 5.0,
    footprint: 0,
    seaStar: 24.0
  };

  const callbacks = {
    onAutoPause: null,
    onGameOver: null,
    onOrientChange: null
  };

  /* ---- Shoreline Ratios & Dynamic Tide Cycle ---- */
  function skyEnd() { return H * 0.13; }
  function duneEnd() { return H * 0.21; }
  function playTop() { return H * 0.225; }
  function midBeachEnd() { return H * 0.60; }

  // Continuous ~35-second coastal tide cycle: High Tide smoothly creeps up the beach by ~6% of H
  const TIDE_PERIOD = 35.0;
  function tideFrac() {
    return 0.5 - 0.5 * Math.cos(((elapsed % TIDE_PERIOD) / TIDE_PERIOD) * TAU);
  }
  function tideOffset() {
    return tideFrac() * (H * 0.06);
  }
  function surfBase() { return H * 0.86 - tideOffset(); }
  function playBottom() { return H * 0.855 - tideOffset(); }

  function getStreakMultiplier(count) {
    if (count >= 10) return 3.0;
    if (count >= 6) return 2.0;
    if (count >= 3) return 1.5;
    return 1.0;
  }

  function speedScale() {
    return effectiveOrient === 'portrait' ? 0.82 : 1.0;
  }

  function currentHazardSpeed() {
    const ramp = Math.min(1, elapsed / 120);
    return (255 + ramp * 210) * speedScale();
  }

  function currentScore() {
    return shellScore + Math.floor(elapsed) * 5;
  }

  /* ---- Helpers ---- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function posMod(a, n) { return ((a % n) + n) % n; }

  /* ---- Responsive Orientation & Canvas Fit ---- */
  function detectAutoOrient() {
    const sw = stageEl ? stageEl.clientWidth : window.innerWidth;
    const sh = stageEl ? stageEl.clientHeight : window.innerHeight;
    if (sw > 0 && sh > 0) {
      return sh > sw ? 'portrait' : 'landscape';
    }
    return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
  }

  function fitCanvasCss() {
    if (!stageEl) return;
    if (effectiveOrient === 'portrait' && orientPref === 'auto') {
      const sw = Math.max(120, stageEl.clientWidth);
      const sh = Math.max(120, stageEl.clientHeight);
      canvas.style.width = sw + 'px';
      canvas.style.height = sh + 'px';
      return;
    }
    const sw = Math.max(120, stageEl.clientWidth - 4);
    const sh = Math.max(120, stageEl.clientHeight - 4);
    const aspect = W / H;
    let dw = sw;
    let dh = dw / aspect;
    if (dh > sh) {
      dh = sh;
      dw = dh * aspect;
    }
    canvas.style.width = Math.floor(dw) + 'px';
    canvas.style.height = Math.floor(dh) + 'px';
  }

  function applyOrientation() {
    const next = orientPref === 'auto' ? detectAutoOrient() : orientPref;
    const sw = stageEl && stageEl.clientWidth > 0 ? stageEl.clientWidth : window.innerWidth;
    const sh = stageEl && stageEl.clientHeight > 0 ? stageEl.clientHeight : window.innerHeight;
    const targetW = next === 'portrait' ? DIMS.portrait.w : DIMS.landscape.w;
    const targetH = next === 'portrait'
      ? clamp(Math.round(720 * (sh / Math.max(1, sw))), 640, 1600)
      : DIMS.landscape.h;
    const changed = next !== effectiveOrient || W !== targetW || H !== targetH;

    if (changed) {
      const oldH = H;
      effectiveOrient = next;
      W = targetW;
      H = targetH;
      canvas.width = W;
      canvas.height = H;
      In.setLogicalSize(W, H);

      // Keep world X intact and smoothly center camera on player; rescale vertical shoreline ratios
      const ry = H / oldH;
      player.y = clamp(player.y * ry, playTop(), playBottom());
      cameraX = player.x - W * 0.5;
      exploredMinX = Math.min(exploredMinX, cameraX);
      exploredMaxX = Math.max(exploredMaxX, cameraX + W);

      shells.forEach(function (s) { s.y = clamp(s.y * ry, playTop() + 10, playBottom() - 8); });
      crabs.forEach(function (c) { c.y = clamp(c.y * ry, playTop() + 14, playBottom() - 18); });
      mounds.forEach(function (m) { m.y = clamp(m.y * ry, H * 0.36, H * 0.56); });
      waves.forEach(function (wv) {
        wv.baseY = surfBase();
        wv.peakY *= ry;
        wv.currentY *= ry;
      });
      gulls.forEach(function (g) {
        g.y *= ry;
        g.targetY *= ry;
      });
      tracks.forEach(function (t) { t.y *= ry; });
      particles.forEach(function (p) { p.y *= ry; });
      popups.forEach(function (p) { p.y *= ry; });
      initBackdrop();
    }

    fitCanvasCss();
    if (callbacks.onOrientChange) {
      callbacks.onOrientChange(orientPref, effectiveOrient);
    }
  }

  function setOrientationMode(nextPref) {
    if (nextPref !== 'auto' && nextPref !== 'portrait' && nextPref !== 'landscape') return;
    orientPref = nextPref;
    try { localStorage.setItem(ORIENT_KEY, orientPref); } catch (e) { }
    applyOrientation();
    requestAnimationFrame(applyOrientation);
  }

  window.addEventListener('resize', applyOrientation);
  window.addEventListener('orientationchange', function () {
    setTimeout(applyOrientation, 80);
  });
  if (typeof ResizeObserver !== 'undefined' && stageEl) {
    new ResizeObserver(function () {
      applyOrientation();
    }).observe(stageEl);
  }

  /* ---- Backdrop (Clouds, Dune Grass, Pebbles) ---- */
  function cloudWrapSpan() { return W + 320; }
  function decorWrapSpan() { return W + 240; }

  function initBackdrop() {
    clouds = [];
    const cSpan = cloudWrapSpan();
    for (let i = 0; i < 6; i++) {
      clouds.push({
        x: (i / 6) * cSpan + rand(0, 80),
        y: rand(H * 0.025, skyEnd() * 0.65),
        w: rand(70, 145),
        speed: rand(8, 18)
      });
    }

    decor = [];
    const dSpan = decorWrapSpan();
    const tufts = Math.ceil(dSpan / 65);
    for (let i = 0; i < tufts; i++) {
      decor.push({
        kind: 'grass',
        x: (i / tufts) * dSpan + rand(-18, 18),
        y: rand(skyEnd() + 8, duneEnd() - 4),
        h: rand(12, 22),
        phase: rand(0, TAU)
      });
    }
    for (let i = 0; i < 28; i++) {
      decor.push({
        kind: 'speck',
        x: rand(0, dSpan),
        y: rand(duneEnd() + 8, surfBase() - 10),
        r: rand(1.5, 3.5),
        tone: Math.random() < 0.5 ? 'rgba(176, 134, 72, 0.25)' : 'rgba(255, 248, 224, 0.35)'
      });
    }
  }

  /* ---- Sand Dollar Spawning ---- */
  const TIER_SPEC = {
    common: { pts: 10, r: 22, hitPad: 7 },
    medium: { pts: 25, r: 15, hitPad: 1 },
    pearl: { pts: 100, r: 7.5, hitPad: 0 },
    star: { pts: 150, r: 15, hitPad: 4 }
  };

  function spawnShell(tier, x, y, ttl) {
    if (shells.length > 44) return;
    const spec = TIER_SPEC[tier];
    shells.push({
      tier: tier,
      pts: spec.pts,
      r: spec.r,
      hitR: spec.r + spec.hitPad,
      x: x,
      y: clamp(y, playTop() + 10, playBottom() - 8),
      phase: rand(0, TAU),
      rot: rand(0, TAU),
      age: 0,
      ttl: typeof ttl === 'number' ? ttl : null
    });
  }

  function seedInitialBeach() {
    // Inviting scatter of Common (10 pt) and Medium (25 pt) concentrated in mid-to-lower beach
    const rightArcY = rand(H * 0.44, H * 0.56);
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      spawnShell('common', 120 + i * 74, rightArcY + Math.sin(t * Math.PI) * -22);
    }
    const leftArcY = rand(H * 0.45, H * 0.58);
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      spawnShell('common', -120 - i * 74, leftArcY + Math.sin(t * Math.PI) * 22);
    }

    // Occasional single Common in upper beach; Medium (25 pt) shells in lower damp sand
    spawnShell('common', -W * 0.26, H * 0.31);
    spawnShell('medium', W * 0.24, H * 0.58);
    spawnShell('medium', -W * 0.30, H * 0.62);
    spawnShell('medium', W * 0.38, H * 0.65);
  }

  function spawnHorizonShells(dir, edgeX) {
    // Spawn off-screen exploration shells (never Golden Pearls).
    // Above y = H * 0.55: sparse Common (10 pt) shells only.
    // Below y = H * 0.55 (lower damp sand): Common arcs & all Medium (25 pt) clusters.
    const roll = Math.random();
    const step = effectiveOrient === 'portrait' ? 56 : 64;
    const dampMinY = H * 0.565;
    const dampMaxY = Math.max(dampMinY + 24, Math.min(H * 0.74, playBottom() - 18));
    let span = 0;

    if (roll < 0.24) {
      // Sparse Common (10 pt) shells only in upper/mid beach (y < H * 0.55)
      spawnShell('common', edgeX + dir * 24, rand(H * 0.25, H * 0.53));
      span = 72;
      if (Math.random() < 0.45) {
        span += 90;
        spawnShell('common', edgeX + dir * span, rand(H * 0.30, H * 0.54));
      }
    } else if (roll < 0.64) {
      // Lower damp-sand arc of Common (10 pt) shells + optional Medium strictly in y > H * 0.55
      const count = Math.floor(rand(3, 6));
      const baseY = rand(dampMinY + 6, dampMaxY - 10);
      const amp = rand(-18, 22);
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0.5;
        const sy = clamp(baseY + Math.sin(t * Math.PI) * amp, dampMinY, dampMaxY);
        spawnShell('common', edgeX + dir * (i * step), sy);
      }
      span = (count - 1) * step;
      if (Math.random() < 0.6) {
        spawnShell('medium', edgeX + dir * (span * 0.5), rand(dampMinY + 12, dampMaxY));
      }
    } else {
      // Cluster of Medium (25 pt) sun-bleached shells strictly in lower damp sand (y > H * 0.55)
      const baseY = rand(dampMinY + 8, dampMaxY - 8);
      const count = Math.floor(rand(2, 4));
      for (let i = 0; i < count; i++) {
        const sy = clamp(baseY + (i % 2 === 0 ? -12 : 12), dampMinY, dampMaxY);
        spawnShell('medium', edgeX + dir * (i * step), sy);
      }
      span = (count - 1) * step;
      if (Math.random() < 0.45) {
        span += step + 30;
        spawnShell('common', edgeX + dir * span, rand(H * 0.38, H * 0.53));
      }
    }
    return span;
  }

  /* ---- Hazard Spawners ---- */
  function spawnSandMound() {
    if (mounds.length >= 3) return;
    let mx = null;
    let my = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candX = rand(cameraX + W * 0.14, cameraX + W * 0.86);
      const candY = rand(H * 0.36, H * 0.56);
      if (Math.hypot(candX - player.x, candY - player.y) > 95) {
        mx = candX;
        my = candY;
        break;
      }
    }
    if (mx === null) return;
    mounds.push({
      x: mx,
      y: my,
      timer: 0,
      dur: 1.1,
      seed: rand(0, TAU)
    });
  }
  function spawnCrabWave() {
    const difficulty = Math.min(1, elapsed / 100);
    // Spawn from either left or right edge of current viewport
    const fromLeft = Math.random() < 0.5;
    const dir = fromLeft ? 1 : -1;
    const startX = fromLeft ? cameraX - 45 : cameraX + W + 45;
    const baseSpd = currentHazardSpeed();
    const roll = Math.random();

    if (roll < 0.28 + difficulty * 0.18) {
      // Tight gap between two scurrying crabs in the lower/mid beach with a Golden Pearl (100 pts)
      const centerY = rand(H * 0.46, H * 0.69);
      const gapHalf = effectiveOrient === 'portrait' ? 46 : 44;
      const spd = baseSpd * rand(0.95, 1.15);
      crabs.push({
        x: startX,
        y: clamp(centerY - gapHalf, playTop() + 14, playBottom() - 90),
        dir: dir,
        speed: spd,
        vy: 0,
        r: 18,
        phase: rand(0, TAU)
      });
      crabs.push({
        x: startX + rand(-8, 8),
        y: clamp(centerY + gapHalf, playTop() + 90, playBottom() - 16),
        dir: dir,
        speed: spd,
        vy: 0,
        r: 18,
        phase: rand(0, TAU)
      });
      spawnShell('pearl', startX + dir * 2, centerY);
    } else if (roll < 0.65) {
      crabs.push({
        x: startX,
        y: rand(H * 0.26, H * 0.72),
        dir: dir,
        speed: baseSpd * rand(1.0, 1.32 + difficulty * 0.2),
        vy: 0,
        r: 18,
        phase: rand(0, TAU)
      });
    } else {
      const goDown = Math.random() < 0.5;
      crabs.push({
        x: startX,
        y: goDown ? rand(H * 0.25, H * 0.42) : rand(H * 0.55, H * 0.74),
        dir: dir,
        speed: baseSpd * rand(0.9, 1.18),
        vy: (goDown ? 1 : -1) * rand(45, 85 + difficulty * 35),
        r: 18,
        phase: rand(0, TAU)
      });
    }
  }

  function waveOverlapsExisting(x, w) {
    const pad = 26;
    for (let i = 0; i < waves.length; i++) {
      const wv = waves[i];
      if (x < wv.x + wv.w + pad && x + w + pad > wv.x) {
        return true;
      }
    }
    return false;
  }

  function spawnWaveSurge() {
    const difficulty = Math.min(1, elapsed / 110);
    const spanRatio = effectiveOrient === 'portrait'
      ? rand(0.52, 0.78)
      : rand(0.38, 0.62);
    const spanW = W * spanRatio;

    // Generate across viewport + generous left/right buffer so traveling horizontally meets active waves
    const zoneMinX = cameraX - W * 0.85;
    const zoneMaxX = cameraX + W * 1.85 - spanW;

    let chosenX = null;
    for (let attempt = 0; attempt < 18; attempt++) {
      // First few attempts bias near visible screen or ahead; later attempts test anywhere in buffered coastal zone
      const candX = attempt < 8
        ? rand(cameraX - W * 0.35, cameraX + W * 1.35 - spanW)
        : rand(zoneMinX, zoneMaxX);
      if (!waveOverlapsExisting(candX, spanW)) {
        chosenX = candX;
        break;
      }
    }
    if (chosenX === null) return;

    const isBig = Math.random() < (0.28 + difficulty * 0.34);
    const reachFrac = isBig ? rand(0.42, 0.56) : rand(0.62, 0.74);

    waves.push({
      x: chosenX,
      w: spanW,
      baseY: surfBase(),
      currentY: surfBase(),
      peakY: H * reachFrac,
      phase: 'telegraph', // 'telegraph' -> 'surge' -> 'recede'
      timer: 0,
      telegraphDur: Math.max(0.55, 0.85 - difficulty * 0.2),
      surgeDur: Math.max(0.7, 1.05 - difficulty * 0.22),
      recedeDur: 1.35,
      seed: rand(0, TAU),
      isBig: isBig,
      spawnedWashPearl: false
    });
    Snd.sfx.waveWhoosh();
  }

  function spawnSeagull() {
    const difficulty = Math.min(1, elapsed / 110);
    // Target distribution: ~40% upper dune, ~45% mid-beach, ~15% lower beach
    const zoneRoll = Math.random();
    let targetY;
    if (zoneRoll < 0.40) {
      targetY = rand(playTop() + 10, H * 0.40);
    } else if (zoneRoll < 0.85) {
      targetY = rand(H * 0.40, H * 0.56);
    } else {
      targetY = rand(H * 0.56, Math.max(H * 0.58, Math.min(H * 0.74, playBottom() - 18)));
    }
    const travelDist = W + 160;
    const minSpeed = effectiveOrient === 'portrait' ? 460 : 540;
    const baseDur = Math.max(1.8, 2.5 - difficulty * 0.55);
    const speed = Math.max(minSpeed, travelDist / baseDur);
    const fromLeft = Math.random() < 0.5;
    const dir = fromLeft ? 1 : -1;
    const startX = fromLeft ? cameraX - 70 : cameraX + W + 70;

    gulls.push({
      x: startX,
      y: targetY,
      targetY: targetY,
      dir: dir,
      vx: dir * speed,
      flightTime: 0,
      swoopOffset: rand(0.05, 0.32),
      altitude: 1,
      flap: rand(0, TAU)
    });
    Snd.sfx.gullWarn();
  }

  /* ---- Particles & Popups ---- */
  function addParticles(x, y, color, count, speed, gravity) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(speed * 0.35, speed);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 25,
        r: rand(2, 4.5),
        life: rand(0.25, 0.55),
        maxLife: 0.55,
        color: color,
        g: gravity || 180
      });
    }
  }

  function addPopup(x, y, text, color, scale) {
    popups.push({
      x: x,
      y: y,
      text: text,
      color: color,
      scale: scale || 1,
      life: 0.85,
      maxLife: 0.85
    });
  }

  /* ---- Damage & Wipeout ---- */
  function hurtPlayer(sourceType) {
    if (invulnTimer > 0 || mode !== 'play') return;
    lives -= 1;
    invulnTimer = 1.45;
    hurtShake = 0.28;
    player.squash = 0.45;
    streakCount = 0;
    streakTimer = 0;
    Snd.sfx.hit();

    if (sourceType === 'wave') {
      player.y = Math.max(playTop() + 18, player.y - H * 0.09);
      addParticles(player.x, player.y, '#e8fbff', 16, 170, 260);
      addPopup(player.x, player.y - 26, 'SPLASH!', '#7cf0ff', 1.1);
    } else if (sourceType === 'crab') {
      addParticles(player.x, player.y, '#ff7b54', 14, 150, 240);
      addPopup(player.x, player.y - 26, 'PINCH!', '#ff8066', 1.1);
    } else {
      addParticles(player.x, player.y, '#ffffff', 14, 160, 220);
      addPopup(player.x, player.y - 26, 'SWOOP!', '#ffd23f', 1.1);
    }

    updateHud();

    if (lives <= 0) {
      endGame();
    }
  }

  function endGame() {
    mode = 'over';
    document.body.classList.remove('playing');
    Snd.musicStop();
    Snd.sfx.gameOver();

    const finalScore = currentScore();
    const survivalTime = Math.max(1, Math.floor(elapsed));
    if (finalScore > highScore) {
      highScore = finalScore;
      newHighFlag = true;
      try { localStorage.setItem(HIGH_KEY, String(highScore)); } catch (e) { }
    }
    updateHud();

    if (callbacks.onGameOver) {
      callbacks.onGameOver({
        score: finalScore,
        sand_dollars: totalSandDollars,
        survival_time: survivalTime,
        tiers: {
          common: tierCounts.common,
          medium: tierCounts.medium,
          pearl: tierCounts.pearl,
          star: tierCounts.star || 0
        },
        newHigh: newHighFlag
      });
    }
  }

  function isInRecedingWetFootprint(x, y) {
    for (let i = 0; i < waves.length; i++) {
      const wv = waves[i];
      if (wv.phase === 'recede' && wv.timer < wv.recedeDur) {
        if (x >= wv.x && x <= wv.x + wv.w) {
          const topY = getWaveCrestY(wv, x, wv.peakY);
          if (y >= topY && y <= wv.baseY + 12) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function getWetSandDrag(x, y) {
    const wetStart = H * 0.58;
    const sb = surfBase();
    let frac = 0;
    if (y > wetStart && sb > wetStart) {
      frac = clamp((y - wetStart) / (sb - wetStart), 0, 1);
    }
    if (isInRecedingWetFootprint(x, y)) {
      frac = 1;
    }
    return frac * 0.22;
  }

  /* ---- Simulation Update ---- */
  function update(dt) {
    if (mode !== 'play') return;

    elapsed += dt;

    if (invulnTimer > 0) invulnTimer = Math.max(0, invulnTimer - dt);
    if (hurtShake > 0) hurtShake = Math.max(0, hurtShake - dt);
    if (player.squash > 0) player.squash = Math.max(0, player.squash - dt * 2.5);

    // Streak timer countdown (resets combo to 1x on expiry)
    if (streakTimer > 0) {
      streakTimer -= dt;
      if (streakTimer <= 0) {
        streakTimer = 0;
        streakCount = 0;
        updateHud();
      }
    }

    // Speed burst countdown & golden/cyan sparkle trail
    if (speedBurstTimer > 0) {
      speedBurstTimer = Math.max(0, speedBurstTimer - dt);
      speedBurstSparkleTimer -= dt;
      if (speedBurstSparkleTimer <= 0) {
        speedBurstSparkleTimer = 0.045;
        const col = Math.random() < 0.5 ? '#ffd23f' : '#5ee6ff';
        addParticles(player.x - player.facing * 10, player.y + rand(2, 10), col, 2, 60, 40);
      }
    }

    timers.seaStar -= dt;

    // Dynamic coastal tide shift detection & banner alert
    const tf = tideFrac();
    if (tideState === 'low' && tf > 0.65) {
      tideState = 'high';
      triggerTideBanner('HIGH TIDE!', '#5ee6ff', 'SURF RISING · DRY SAND COMPRESSED');
      if (Snd.sfx.tideShift) Snd.sfx.tideShift();
    } else if (tideState === 'high' && tf < 0.35) {
      tideState = 'low';
      triggerTideBanner('LOW TIDE', '#ffd23f', 'SHORELINE RECEDING · DRY SAND EXPANDS');
      if (Snd.sfx.tideShift) Snd.sfx.tideShift();
    }
    if (tideBanner.timer > 0) {
      tideBanner.timer -= dt;
    }

    // Free 4-way movement with progressive wet-sand drag (ignored during Sea Star Speed Burst)
    const mv = In.getMove();
    const inRecedeWet = isInRecedingWetFootprint(player.x, player.y);
    const onWetSand = player.y > H * 0.58 || inRecedeWet;
    const wetDrag = speedBurstTimer > 0 ? 0 : getWetSandDrag(player.x, player.y);
    const speedMult = speedBurstTimer > 0 ? 1.35 : (1 - wetDrag);
    const moveSpd = (effectiveOrient === 'portrait' ? 375 : 415) * speedMult;

    player.vx = mv.x * moveSpd;
    player.vy = mv.y * moveSpd;
    const stepX = player.vx * dt;
    const stepY = player.vy * dt;

    player.x += stepX;
    player.y = clamp(player.y + stepY, playTop(), playBottom());

    if (Math.abs(stepX) > 0.25) {
      player.facing = stepX > 0 ? 1 : -1;
    }

    // Smooth horizontal camera with gentle center deadzone
    const camCenter = cameraX + W * 0.5;
    const deadzone = W * 0.07;
    let targetCamX = cameraX;
    if (player.x > camCenter + deadzone) {
      targetCamX = player.x - deadzone - W * 0.5;
    } else if (player.x < camCenter - deadzone) {
      targetCamX = player.x + deadzone - W * 0.5;
    }
    cameraX = lerp(cameraX, targetCamX, Math.min(1, dt * 8));

    const moveMag = Math.hypot(stepX, stepY) / Math.max(0.008, dt);
    player.bob += dt * (moveMag > 20 ? 15 : 4);
    const targetLean = clamp((stepY / Math.max(0.016, dt)) * 0.0007, -0.32, 0.32);
    player.lean = lerp(player.lean, targetLean, Math.min(1, dt * 12));

    // Water-droplet splash particles on wet sand vs. dry sand footprints
    timers.footprint -= dt;
    if (timers.footprint <= 0 && moveMag > 35) {
      if (onWetSand) {
        timers.footprint = 0.075;
        particles.push({
          x: player.x - player.facing * 8 + rand(-4, 4),
          y: player.y + 11,
          vx: -player.facing * rand(18, 45) + rand(-18, 18),
          vy: rand(-55, -24),
          r: rand(1.6, 3.0),
          life: rand(0.22, 0.38),
          maxLife: 0.38,
          color: Math.random() < 0.5 ? '#c7f5ff' : '#7ae6ff',
          g: 240
        });
        if (Math.random() < 0.65) {
          particles.push({
            x: player.x - player.facing * 6 + rand(-5, 5),
            y: player.y + 12,
            vx: rand(-24, 24),
            vy: rand(-44, -20),
            r: rand(1.3, 2.3),
            life: rand(0.18, 0.32),
            maxLife: 0.32,
            color: '#ffffff',
            g: 240
          });
        }
      } else {
        timers.footprint = 0.095;
        tracks.push({ x: player.x - player.facing * 10, y: player.y + 11, life: 0.9 });
      }
    }

    // Ambient cloud drift (wrapping seamlessly relative to cameraX)
    const cSpan = cloudWrapSpan();
    for (let i = 0; i < clouds.length; i++) {
      clouds[i].x = posMod(clouds[i].x - clouds[i].speed * dt, cSpan);
    }

    // Fade footprints in world space
    for (let i = tracks.length - 1; i >= 0; i--) {
      tracks[i].life -= dt;
      if (tracks[i].life <= 0) tracks.splice(i, 1);
    }

    // Keep far-away exploration frontier bounded to the 3x remembered shoreline [cameraX - W, cameraX + 2*W]
    exploredMinX = Math.max(exploredMinX, cameraX - W);
    exploredMaxX = Math.min(exploredMaxX, cameraX + 2 * W);

    // Off-screen horizon exploration spawning (only when pushing beyond remembered bounds)
    if (cameraX + W > exploredMaxX) {
      const startX = Math.max(cameraX + W + 60, exploredMaxX + 40);
      const span = spawnHorizonShells(1, startX);
      exploredMaxX = Math.min(cameraX + 2 * W, startX + span + rand(110, 210));
    }
    if (cameraX < exploredMinX) {
      const startX = Math.min(cameraX - 60, exploredMinX - 40);
      const span = spawnHorizonShells(-1, startX);
      exploredMinX = Math.max(cameraX - W, startX - span - rand(110, 210));
    }

    // Spawn timers (hazards only; shells come from exploration & wave wash)
    const diff = Math.min(1, elapsed / 110);

    timers.crab -= dt;
    if (timers.crab <= 0) {
      spawnCrabWave();
      timers.crab = rand(1.35, 2.35) * (1 - diff * 0.42);
    }

    timers.mound -= dt;
    if (timers.mound <= 0) {
      spawnSandMound();
      timers.mound = rand(4.0, 6.5) * (1 - diff * 0.35);
    }

    timers.wave -= dt;
    if (timers.wave <= 0) {
      spawnWaveSurge();
      const baseWaveGap = waves.length < 3 ? rand(1.15, 1.8) : rand(1.9, 3.1);
      timers.wave = baseWaveGap * (1 - diff * 0.32);
    }

    timers.gull -= dt;
    if (timers.gull <= 0) {
      spawnSeagull();
      timers.gull = rand(3.5, 5.6) * (1 - diff * 0.42);
    }

    // Update Mid-Beach Sand Mounds (wiggle/bubble ~1.1s then emerge crab left/right)
    for (let i = mounds.length - 1; i >= 0; i--) {
      const m = mounds[i];
      m.timer += dt;
      if (Math.random() < dt * 8) {
        particles.push({
          x: m.x + rand(-10, 10),
          y: m.y - rand(2, 8),
          vx: rand(-20, 20),
          vy: rand(-55, -25),
          r: rand(1.5, 2.8),
          life: rand(0.18, 0.32),
          maxLife: 0.32,
          color: '#f0cf88',
          g: 190
        });
      }
      if (m.timer >= m.dur) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        crabs.push({
          x: m.x,
          y: m.y,
          dir: dir,
          speed: currentHazardSpeed() * rand(0.95, 1.15),
          vy: 0,
          r: 18,
          phase: rand(0, TAU)
        });
        addParticles(m.x, m.y, '#e2be78', 12, 130, 220);
        mounds.splice(i, 1);
        continue;
      }
      if (m.x < cameraX - 140 || m.x > cameraX + W + 140) {
        mounds.splice(i, 1);
      }
    }

    const viewCenterX = cameraX + W * 0.5;

    // Update Sand Dollars & Check Collection / Despawn
    for (let i = shells.length - 1; i >= 0; i--) {
      const sh = shells[i];
      sh.age += dt;
      sh.phase += dt * 4.5;
      sh.rot = (sh.rot || 0) + dt * 1.4;

      const playerCore = sh.tier === 'pearl' ? 12 : player.r;
      const dist = Math.hypot(player.x - sh.x, player.y - sh.y);
      if (dist <= sh.hitR + playerCore) {
        // Increment streak combo & refresh 2.6s timer window
        streakCount += 1;
        streakTimer = STREAK_WINDOW;
        const streakMult = getStreakMultiplier(streakCount);

        const surfBonus = sh.y > (surfBase() - H * 0.30);
        const surfMult = surfBonus ? 2 : 1;
        const ptsEarned = Math.round(sh.pts * surfMult * streakMult);
        shellScore += ptsEarned;
        totalSandDollars += 1;
        tierCounts[sh.tier] = (tierCounts[sh.tier] || 0) + 1;
        player.squash = 0.28;

        // Rising pitch flourish in audio
        Snd.sfx.streakFlourish(streakMult, streakCount);

        const streakTag = streakMult > 1 ? ' x' + streakMult : '';

        if (sh.tier === 'common') {
          Snd.sfx.pickupCommon();
          addParticles(sh.x, sh.y, surfBonus ? '#8bf2ff' : '#fff7dc', 8, 95, 120);
          addPopup(
            sh.x,
            sh.y - 14,
            surfBonus ? '+' + ptsEarned + ' SURF' + streakTag + '!' : '+' + ptsEarned + (streakTag ? ' STREAK' + streakTag : ''),
            surfBonus ? '#7cf2ff' : '#ffffff',
            surfBonus || streakMult > 1 ? 1.15 : 0.95
          );
        } else if (sh.tier === 'medium') {
          Snd.sfx.pickupMedium();
          addParticles(sh.x, sh.y, surfBonus ? '#8bf2ff' : '#ffe89e', 11, 125, 140);
          addPopup(
            sh.x,
            sh.y - 16,
            surfBonus ? '+' + ptsEarned + ' SURF' + streakTag + '!' : '+' + ptsEarned + (streakTag ? ' STREAK' + streakTag : ''),
            surfBonus ? '#7cf2ff' : '#fff0a8',
            surfBonus || streakMult > 1 ? 1.25 : 1.1
          );
        } else if (sh.tier === 'pearl') {
          Snd.sfx.pickupPearl();
          addParticles(sh.x, sh.y, '#ffd23f', 18, 175, 130);
          addPopup(
            sh.x,
            sh.y - 20,
            surfBonus ? '+' + ptsEarned + ' PEARL SURF' + streakTag + '!' : '+' + ptsEarned + ' PEARL' + streakTag + '!',
            '#ffd23f',
            surfBonus || streakMult > 1 ? 1.45 : 1.35
          );
        } else if (sh.tier === 'star') {
          // Rare Sea Star (150 pts + 4-second Speed Burst)
          speedBurstTimer = 4.0;
          Snd.sfx.seaStarChime();
          addParticles(sh.x, sh.y, '#ffd23f', 16, 170, 140);
          addParticles(sh.x, sh.y, '#5ee6ff', 16, 170, 140);
          addPopup(
            sh.x,
            sh.y - 22,
            surfBonus ? '+' + ptsEarned + ' STAR SURF' + streakTag + '!' : '+' + ptsEarned + ' SPEED BURST' + streakTag + '!',
            '#ffd23f',
            1.45
          );
        }
        shells.splice(i, 1);
        updateHud();
        continue;
      }

      if ((sh.ttl !== null && sh.age >= sh.ttl) || sh.x < cameraX - W || sh.x > cameraX + 2 * W) {
        shells.splice(i, 1);
      }
    }

    // Update Crabs (only despawn after exiting active viewport)
    for (let i = crabs.length - 1; i >= 0; i--) {
      const c = crabs[i];
      c.x += c.dir * c.speed * dt;
      c.y += c.vy * dt;
      if (c.y < playTop() + 14) {
        c.y = playTop() + 14;
        c.vy = Math.abs(c.vy);
      } else if (c.y > playBottom() - 18) {
        c.y = playBottom() - 18;
        c.vy = -Math.abs(c.vy);
      }
      c.phase += dt * 15;

      const dist = Math.hypot(player.x - c.x, player.y - c.y);
      if (dist < c.r + player.r - 5) {
        hurtPlayer('crab');
      }

      if (c.x < cameraX - 120 || c.x > cameraX + W + 120) {
        crabs.splice(i, 1);
      }
    }

    // Update Incoming Waves
    for (let i = waves.length - 1; i >= 0; i--) {
      const wv = waves[i];
      wv.timer += dt;
      wv.baseY = surfBase();

      if (wv.phase === 'telegraph') {
        wv.currentY = wv.baseY - Math.sin((wv.timer / wv.telegraphDur) * Math.PI) * 10;
        if (wv.timer >= wv.telegraphDur) {
          wv.phase = 'surge';
          wv.timer = 0;
        }
      } else if (wv.phase === 'surge') {
        const u = Math.min(1, wv.timer / wv.surgeDur);
        const eased = 1 - Math.pow(1 - u, 2.3);
        wv.currentY = lerp(wv.baseY, wv.peakY, eased);

        // Multi-point curved crest collision along active rising surge
        if (checkWaveHit(wv)) {
          hurtPlayer('wave');
        }

        if (u >= 1) {
          wv.phase = 'recede';
          wv.timer = 0;
          if (!wv.spawnedWashPearl) {
            wv.spawnedWashPearl = true;

            // Rare Sea Star Power Pickup (150 pts + Speed Burst) washed ashore every ~24–32s
            if (timers.seaStar <= 0) {
              timers.seaStar = rand(24, 32);
              const starSpan = rand(0.35, 0.65);
              const starX = wv.x + wv.w * starSpan;
              const archTop = getWaveCrestY(wv, starX, wv.peakY);
              const starY = clamp(archTop + rand(16, 40), playTop() + 36, playBottom() - 18);
              spawnShell('star', starX, starY, 9.0);
            }

            // Deposit 1-3 fresh shells in wet wash zone: capped at at most 1 Golden Pearl per wave
            const washCount = Math.floor(rand(1, 4));
            let pearlDropped = false;
            for (let k = 0; k < washCount; k++) {
              const tSpan = washCount === 1
                ? rand(0.32, 0.68)
                : lerp(0.22, 0.78, k / (washCount - 1)) + rand(-0.07, 0.07);
              const tClamped = clamp(tSpan, 0.16, 0.84);
              const spawnX = wv.x + wv.w * tClamped;
              const archTop = getWaveCrestY(wv, spawnX, wv.peakY);
              const washY = clamp(archTop + rand(14, 48), playTop() + 36, playBottom() - 18);
              let tier;
              const tierRoll = Math.random();
              if (!pearlDropped && tierRoll < 0.45) {
                tier = 'pearl';
                pearlDropped = true;
              } else {
                tier = Math.random() < 0.65 ? 'medium' : 'common';
              }
              spawnShell(tier, spawnX, washY, rand(8, 10));
            }
          }
        }
      } else {
        const u = Math.min(1, wv.timer / wv.recedeDur);
        const eased = u * u;
        wv.currentY = lerp(wv.peakY, wv.baseY + 18, eased);
        // Brief early-recede crest hazard before water pulls back
        if (wv.timer < 0.22 && checkWaveHit(wv)) {
          hurtPlayer('wave');
        }
        if (u >= 1) {
          waves.splice(i, 1);
          continue;
        }
      }

      if (Math.abs((wv.x + wv.w * 0.5) - viewCenterX) > W * 1.95) {
        waves.splice(i, 1);
      }
    }

    // Update Swooping Seagulls (periodic ~1.4s swoop cycle until exiting camera viewport)
    const swoopPeriod = 1.4;
    for (let i = gulls.length - 1; i >= 0; i--) {
      const g = gulls[i];
      g.flightTime += dt;
      g.flap += dt * 13;
      g.x += g.vx * dt;

      const cyclePos = ((g.flightTime + g.swoopOffset) % swoopPeriod) / swoopPeriod;
      const distFromDive = (cyclePos - 0.5) / 0.19;
      const swoopDepth = Math.exp(-distFromDive * distFromDive * 1.6);
      g.altitude = 1 - swoopDepth;
      g.y = g.targetY - g.altitude * 85;

      if (g.altitude < 0.24) {
        const dist = Math.hypot(player.x - g.x, player.y - g.targetY);
        if (dist < 22 + player.r - 4) {
          hurtPlayer('gull');
        }
      }

      if (g.x < cameraX - 120 || g.x > cameraX + W + 120) {
        gulls.splice(i, 1);
      }
    }

    // Update Particles & Popups in world space
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    for (let i = popups.length - 1; i >= 0; i--) {
      const pp = popups[i];
      pp.y -= 44 * dt;
      pp.life -= dt;
      if (pp.life <= 0) popups.splice(i, 1);
    }

    updateHud();
  }

  /* ---- Rendering ---- */
  function drawSkyAndOcean() {
    const skyH = skyEnd();
    const duneH = duneEnd();
    const surfY = surfBase();

    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, skyH);
    skyGrad.addColorStop(0, '#4bbbe8');
    skyGrad.addColorStop(1, '#bcebff');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, skyH);

    // Warm sun glow
    const sunX = W * 0.84;
    const sunY = skyH * 0.42;
    const sunR = Math.min(W, H) * 0.048;
    ctx.fillStyle = 'rgba(255, 243, 165, 0.35)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 1.7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff3a1';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, TAU);
    ctx.fill();

    // Fluffy clouds (parallax & seamless wrap relative to cameraX)
    const cSpan = cloudWrapSpan();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const cx = posMod(c.x - cameraX * 0.22, cSpan) - 160;
      ctx.beginPath();
      ctx.ellipse(cx, c.y, c.w * 0.42, 12, 0, 0, TAU);
      ctx.ellipse(cx - c.w * 0.2, c.y + 3, c.w * 0.24, 9, 0, 0, TAU);
      ctx.ellipse(cx + c.w * 0.22, c.y + 4, c.w * 0.26, 9, 0, 0, TAU);
      ctx.fill();
    }

    // Distant horizon ribbon
    ctx.fillStyle = '#2b95bd';
    ctx.fillRect(0, skyH - 5, W, 6);

    // Upper dune berm
    const duneGrad = ctx.createLinearGradient(0, skyH, 0, duneH + 14);
    duneGrad.addColorStop(0, '#f3d89b');
    duneGrad.addColorStop(1, '#e8c47a');
    ctx.fillStyle = duneGrad;
    ctx.fillRect(0, skyH, W, duneH - skyH + 14);

    // Main sunlit beach sand -> damp swash gradient
    const sandGrad = ctx.createLinearGradient(0, duneH, 0, surfY + 12);
    sandGrad.addColorStop(0, '#edd090');
    sandGrad.addColorStop(0.55, '#e2be78');
    sandGrad.addColorStop(0.75, '#cfa663');
    sandGrad.addColorStop(1, '#b68c4e');
    ctx.fillStyle = sandGrad;
    ctx.fillRect(0, duneH, W, surfY - duneH + 16);

    // Seamless sand ripples anchored to world cameraX
    ctx.strokeStyle = 'rgba(170, 128, 68, 0.14)';
    ctx.lineWidth = 2;
    const ripplePeriod = 90;
    const rippleShift = posMod(cameraX, ripplePeriod);
    for (let x = -rippleShift - ripplePeriod; x < W + ripplePeriod; x += ripplePeriod) {
      ctx.beginPath();
      ctx.moveTo(x, midBeachEnd() + 18);
      ctx.quadraticCurveTo(x + 45, midBeachEnd() + 26, x + 90, midBeachEnd() + 18);
      ctx.stroke();
    }

    // Footprints in world space
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      const tx = tr.x - cameraX;
      if (tx < -20 || tx > W + 20) continue;
      ctx.fillStyle = 'rgba(145, 102, 46, ' + (tr.life * 0.30).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(tx, tr.y, 4, 2, 0, 0, TAU);
      ctx.fill();
    }

    // Dune grass & sand specks wrapping seamlessly across cameraX
    const dSpan = decorWrapSpan();
    for (let i = 0; i < decor.length; i++) {
      const d = decor[i];
      const dx = posMod(d.x - cameraX, dSpan) - 120;
      if (dx < -40 || dx > W + 40) continue;

      if (d.kind === 'speck') {
        ctx.fillStyle = d.tone;
        ctx.beginPath();
        ctx.arc(dx, d.y, d.r, 0, TAU);
        ctx.fill();
      } else {
        const sway = Math.sin(elapsed * 2.4 + d.phase) * 4;
        ctx.strokeStyle = '#5f9e4c';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(dx, d.y);
        ctx.quadraticCurveTo(dx + sway * 0.5, d.y - d.h * 0.6, dx + sway - 4, d.y - d.h);
        ctx.moveTo(dx, d.y);
        ctx.quadraticCurveTo(dx + sway * 0.5, d.y - d.h * 0.6, dx + sway + 4, d.y - d.h * 0.88);
        ctx.stroke();
      }
    }

    // Resting bottom ocean surf
    const oceanGrad = ctx.createLinearGradient(0, surfY, 0, H);
    oceanGrad.addColorStop(0, '#1eb4d4');
    oceanGrad.addColorStop(0.45, '#1289ab');
    oceanGrad.addColorStop(1, '#095f80');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, surfY, W, H - surfY);

    // Gentle idle shoreline foam line anchored to world X
    ctx.strokeStyle = 'rgba(240, 252, 255, 0.72)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 24) {
      const y = surfY + Math.sin((x + cameraX) * 0.03 + elapsed * 3.1) * 3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function getWaveCrestY(wv, worldX, targetY) {
    const t = clamp((worldX - wv.x) / wv.w, 0, 1);
    const edgeFade = Math.sin(t * Math.PI);
    const ripple = Math.sin(t * Math.PI * 3 + wv.seed + elapsed * 4) * 7 * edgeFade;
    const crestTarget = targetY !== undefined ? targetY : wv.currentY;
    return lerp(wv.baseY + 12, crestTarget, Math.pow(edgeFade, 0.38)) + ripple;
  }

  function checkWaveHit(wv) {
    const bottomY = player.y + player.r * 0.55;
    const offsets = [-0.6, 0, 0.6];
    for (let k = 0; k < offsets.length; k++) {
      const sx = player.x + player.r * offsets[k];
      if (sx >= wv.x && sx <= wv.x + wv.w && bottomY > getWaveCrestY(wv, sx)) {
        return true;
      }
    }
    return false;
  }

  function drawWaves() {
    const steps = 20;

    for (let i = 0; i < waves.length; i++) {
      const wv = waves[i];
      const wx = wv.x - cameraX;
      if (wx + wv.w < -40 || wx > W + 40) continue;

      if (wv.phase === 'telegraph') {
        const pulse = 0.45 + 0.45 * Math.sin(elapsed * 14 + wv.seed);
        const arcLift = (wv.isBig ? 15 : 10) + 4 * Math.sin(elapsed * 11 + wv.seed);

        // Pulsing curved shoreline foam-bubble arc right along wv.baseY
        ctx.save();
        ctx.fillStyle = wv.isBig
          ? 'rgba(255, 224, 138, ' + (0.24 * pulse).toFixed(2) + ')'
          : 'rgba(180, 245, 255, ' + (0.26 * pulse).toFixed(2) + ')';
        ctx.beginPath();
        ctx.moveTo(wx, wv.baseY + 6);
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = wx + t * wv.w;
          const arch = Math.pow(Math.sin(t * Math.PI), 0.38);
          const py = wv.baseY + 4 - arch * arcLift;
          ctx.lineTo(px, py);
        }
        ctx.lineTo(wx + wv.w, wv.baseY + 6);
        ctx.closePath();
        ctx.fill();

        // Crisp curved foam-bubble rim
        ctx.strokeStyle = wv.isBig
          ? 'rgba(255, 232, 165, ' + (0.55 + 0.35 * pulse).toFixed(2) + ')'
          : 'rgba(235, 252, 255, ' + (0.55 + 0.35 * pulse).toFixed(2) + ')';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = wx + t * wv.w;
          const arch = Math.pow(Math.sin(t * Math.PI), 0.38);
          const py = wv.baseY + 4 - arch * arcLift + Math.sin(t * Math.PI * 6 + elapsed * 8) * 1.5;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Individual bubbling surf foam dots along the arc
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.5 + 0.45 * pulse).toFixed(2) + ')';
        const bubbleCount = Math.max(7, Math.floor(wv.w / 46));
        for (let b = 1; b < bubbleCount; b++) {
          const t = b / bubbleCount;
          const bx = wx + t * wv.w;
          const arch = Math.pow(Math.sin(t * Math.PI), 0.38);
          const by = wv.baseY + 3 - arch * arcLift + Math.sin(elapsed * 9 + b * 1.7) * 2.5;
          const br = 2 + 1.5 * Math.abs(Math.sin(elapsed * 7 + b * 2.1));
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
        continue;
      }

      // Arched wet sand sheen during recede, using exact crest curve and fading smoothly over recedeDur
      if (wv.phase === 'recede') {
        const wetFade = clamp(1 - wv.timer / wv.recedeDur, 0, 1);
        if (wetFade > 0.01) {
          ctx.fillStyle = 'rgba(95, 66, 30, ' + (0.30 * wetFade).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(wx, wv.baseY + 12);
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const worldX = wv.x + t * wv.w;
            ctx.lineTo(wx + t * wv.w, getWaveCrestY(wv, worldX, wv.peakY));
          }
          ctx.lineTo(wx + wv.w, wv.baseY + 12);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Translucent turquoise surge water body
      const alpha = wv.phase === 'recede' ? 0.52 : 0.78;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(wx, H);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const worldX = wv.x + t * wv.w;
        ctx.lineTo(wx + t * wv.w, getWaveCrestY(wv, worldX));
      }
      ctx.lineTo(wx + wv.w, H);
      ctx.closePath();

      const wGrad = ctx.createLinearGradient(0, wv.currentY, 0, H);
      wGrad.addColorStop(0, 'rgba(92, 224, 240, ' + alpha + ')');
      wGrad.addColorStop(0.4, 'rgba(26, 158, 194, ' + alpha + ')');
      wGrad.addColorStop(1, 'rgba(11, 100, 133, ' + Math.min(0.95, alpha + 0.15) + ')');
      ctx.fillStyle = wGrad;
      ctx.fill();

      // Secondary thinner translucent foam ripple trailing 18-28px behind main crest for rolling surf feel
      const trailDist = 23 + Math.sin(elapsed * 4.5 + wv.seed) * 4;
      const trailAlpha = wv.phase === 'surge' ? 0.48 : 0.32;
      ctx.strokeStyle = 'rgba(235, 252, 255, ' + trailAlpha + ')';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const worldX = wv.x + t * wv.w;
        const px = wx + t * wv.w;
        const crestY = getWaveCrestY(wv, worldX);
        const edgeBlend = Math.pow(Math.sin(t * Math.PI), 0.55);
        const ripple2 = Math.sin(t * Math.PI * 4 - elapsed * 5 + wv.seed) * 3 * edgeBlend;
        const py = Math.min(H - 6, crestY + trailDist * edgeBlend + ripple2);
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Main white foam lace crest
      ctx.strokeStyle = wv.phase === 'surge'
        ? 'rgba(255, 255, 255, 0.94)'
        : 'rgba(235, 252, 255, 0.65)';
      ctx.lineWidth = wv.phase === 'surge' ? 7 : 4;
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const worldX = wv.x + t * wv.w;
        const px = wx + t * wv.w;
        const py = getWaveCrestY(wv, worldX);
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawSandDollar(sh) {
    const sx = sh.x - cameraX;
    if (sx < -40 || sx > W + 40) return;

    const bob = Math.sin(sh.phase) * 2;
    const y = sh.y + bob;
    const r = sh.r;

    ctx.save();
    // Gentle fade-out / reclaim effect on wave-deposited shells during final 2s
    if (sh.ttl !== null) {
      const rem = sh.ttl - sh.age;
      if (rem < 2.0) {
        const fade = clamp(rem / 2.0, 0, 1);
        ctx.globalAlpha = fade * (0.65 + 0.35 * Math.sin(elapsed * 12));
      }
    }
    ctx.translate(sx, y);

    if (sh.tier === 'common') {
      ctx.fillStyle = 'rgba(110, 78, 34, 0.25)';
      ctx.beginPath();
      ctx.ellipse(2, 4, r, r * 0.88, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = '#f6f2e6';
      ctx.strokeStyle = '#d4cab4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#dfd6c2';
      for (let k = 0; k < 5; k++) {
        const a = (k * TAU) / 5 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, 2, 0, TAU);
        ctx.fill();
      }
    } else if (sh.tier === 'medium') {
      ctx.fillStyle = 'rgba(95, 65, 25, 0.34)';
      ctx.beginPath();
      ctx.ellipse(2, 4, r, r * 0.88, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = '#fffdf4';
      ctx.strokeStyle = '#cbb994';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.rotate(sh.rot);
      ctx.strokeStyle = '#c5af84';
      ctx.lineWidth = 1.8;
      for (let k = 0; k < 5; k++) {
        const a = (k * TAU) / 5;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, r * 0.28, r * 0.13, a, 0, TAU);
        ctx.stroke();
      }
    } else if (sh.tier === 'pearl') {
      const pulse = 0.72 + 0.28 * Math.sin(elapsed * 9 + sh.phase);

      ctx.fillStyle = 'rgba(28, 14, 2, 0.72)';
      ctx.beginPath();
      ctx.ellipse(1.5, 4.5, r * 1.15, r * 0.95, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 210, 63, ' + (0.28 * pulse).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.9, 0, TAU);
      ctx.fill();

      const gGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
      gGrad.addColorStop(0, '#fff9c4');
      gGrad.addColorStop(0.55, '#ffd028');
      gGrad.addColorStop(1, '#c97800');
      ctx.fillStyle = gGrad;
      ctx.strokeStyle = '#7a4400';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.stroke();

      const spR = r * (1.25 + 0.55 * Math.sin(elapsed * 11 + sh.phase));
      ctx.save();
      ctx.translate(-r * 0.38, -r * 0.42);
      ctx.fillStyle = 'rgba(255, 255, 240, ' + (0.75 + 0.25 * pulse).toFixed(2) + ')';
      ctx.beginPath();
      ctx.moveTo(0, -spR);
      ctx.lineTo(spR * 0.22, -spR * 0.22);
      ctx.lineTo(spR, 0);
      ctx.lineTo(spR * 0.22, spR * 0.22);
      ctx.lineTo(0, spR);
      ctx.lineTo(-spR * 0.22, spR * 0.22);
      ctx.lineTo(-spR, 0);
      ctx.lineTo(-spR * 0.22, -spR * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (sh.tier === 'star') {
      // Vibrant, slowly rotating 5-pointed coral-gold Sea Star
      const pulse = 0.82 + 0.18 * Math.sin(elapsed * 7.5 + sh.phase);

      // Sand cast shadow
      ctx.fillStyle = 'rgba(28, 14, 2, 0.48)';
      ctx.beginPath();
      ctx.ellipse(1.5, 5, r * 1.15, r * 0.75, 0, 0, TAU);
      ctx.fill();

      // Soft outer golden halo
      ctx.fillStyle = 'rgba(255, 210, 63, ' + (0.24 * pulse).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.7, 0, TAU);
      ctx.fill();

      // Slowly rotating 5-pointed star
      ctx.save();
      ctx.rotate(sh.rot || 0);

      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k * TAU) / 10 - Math.PI / 2;
        const rad = k % 2 === 0 ? r : r * 0.44;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      const starGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
      starGrad.addColorStop(0, '#fff6c4');
      starGrad.addColorStop(0.38, '#ffd23f');
      starGrad.addColorStop(0.82, '#ff6b57');
      starGrad.addColorStop(1, '#d83b28');
      ctx.fillStyle = starGrad;
      ctx.fill();

      ctx.strokeStyle = '#8f1d10';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Tubercles along star arms
      ctx.fillStyle = '#ffe89e';
      for (let k = 0; k < 5; k++) {
        const a = (k * TAU) / 5 - Math.PI / 2;
        const armDist = r * 0.65;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * armDist, Math.sin(a) * armDist, 1.5, 0, TAU);
        ctx.fill();
      }

      // Center sparkle
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.85 * pulse).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function drawCrab(c) {
    const cx = c.x - cameraX;
    if (cx < -50 || cx > W + 50) return;

    const scuttle = Math.sin(c.phase) * 3;
    ctx.save();
    ctx.translate(cx, c.y);
    ctx.scale(-c.dir, 1); // face movement direction

    ctx.fillStyle = 'rgba(85, 50, 20, 0.32)';
    ctx.beginPath();
    ctx.ellipse(1, 7, 19, 10, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = '#c23a1d';
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    for (let side = -1; side <= 1; side += 2) {
      for (let j = -1; j <= 1; j++) {
        const legAnim = Math.sin(c.phase + j * 1.4 + (side > 0 ? 0 : Math.PI)) * 3.5;
        ctx.beginPath();
        ctx.moveTo(j * 6, side * 6);
        ctx.lineTo(j * 9 + legAnim, side * 16);
        ctx.stroke();
      }
    }

    const clawSnap = Math.abs(Math.sin(c.phase * 0.45)) * 0.35;
    [-1, 1].forEach(function (side) {
      ctx.save();
      ctx.translate(-14, side * 10);
      ctx.rotate(side * (-0.3 - clawSnap));
      ctx.fillStyle = '#e85232';
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, TAU);
      ctx.fill();
      ctx.restore();
    });

    ctx.fillStyle = '#e85232';
    ctx.strokeStyle = '#992811';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, scuttle * 0.25, 16, 12, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 175, 130, 0.45)';
    ctx.beginPath();
    ctx.ellipse(-3, -4 + scuttle * 0.25, 8, 4, -0.2, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#1a1110';
    ctx.beginPath();
    ctx.arc(-7, -5 + scuttle * 0.25, 2.4, 0, TAU);
    ctx.arc(-7, 5 + scuttle * 0.25, 2.4, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  function drawSeagull(g) {
    const gx = g.x - cameraX;
    if (gx < -90 || gx > W + 90) return;

    const shadowAlpha = lerp(0.55, 0.18, g.altitude);
    const shadowScale = lerp(1.05, 0.65, g.altitude);
    ctx.save();
    ctx.translate(gx, g.targetY);

    ctx.save();
    ctx.scale(shadowScale, shadowScale);
    ctx.fillStyle = 'rgba(20, 26, 36, ' + shadowAlpha.toFixed(2) + ')';
    ctx.beginPath();
    ctx.ellipse(0, 0, 24, 10, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Earlier Seagull Dive Telegraph (< 0.55): faint dashed target ring tightening towards active strike (< 0.24)
    if (g.altitude < 0.55) {
      const t = clamp((0.55 - g.altitude) / (0.55 - 0.24), 0, 1);
      const rx = lerp(38, 25, t);
      const ry = lerp(20, 13, t);
      const alpha = lerp(0.18, 0.88, t);
      const lineW = lerp(1.6, 2.8, t);

      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -elapsed * 18;
      ctx.strokeStyle = 'rgba(255, 80, 65, ' + alpha.toFixed(2) + ')';
      ctx.lineWidth = lineW;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
      ctx.stroke();

      if (g.altitude < 0.30) {
        const dotAlpha = clamp((0.30 - g.altitude) / 0.30, 0, 1) * 0.7;
        ctx.fillStyle = 'rgba(255, 90, 70, ' + dotAlpha.toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();

    const scale = lerp(1.18, 0.85, g.altitude);
    const wingY = Math.sin(g.flap) * (g.altitude < 0.25 ? 4 : 13);

    ctx.save();
    ctx.translate(gx, g.y);
    ctx.scale(-g.dir * scale, scale); // beak faces flight direction

    ctx.fillStyle = '#edf3f8';
    ctx.strokeStyle = '#6c7d91';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(4, -2);
    ctx.quadraticCurveTo(10, -24 + wingY, 26, -18 + wingY);
    ctx.lineTo(10, 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(4, 2);
    ctx.quadraticCurveTo(10, 24 - wingY, 26, 18 - wingY);
    ctx.lineTo(10, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#242c38';
    ctx.beginPath();
    ctx.arc(23, -16 + wingY, 3.5, 0, TAU);
    ctx.arc(23, 16 - wingY, 3.5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#79899c';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 7.5, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffb703';
    ctx.beginPath();
    ctx.moveTo(-14, -2.5);
    ctx.lineTo(-24, 0);
    ctx.lineTo(-14, 2.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(-9, -2, 1.8, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  function drawHamster() {
    if (invulnTimer > 0 && Math.floor(invulnTimer * 16) % 2 === 1) {
      return;
    }
    const stride = Math.sin(player.bob);
    const sq = 1 + player.squash * 0.25;
    const st = 1 / sq;
    const px = player.x - cameraX;

    ctx.save();
    ctx.translate(px, player.y + Math.abs(stride) * -2.2);
    ctx.rotate(player.lean);
    ctx.scale(player.facing * sq, st);

    // Shadow on sand
    ctx.fillStyle = 'rgba(85, 50, 18, 0.34)';
    ctx.beginPath();
    ctx.ellipse(-2, 14, 18, 8, 0, 0, TAU);
    ctx.fill();

    // Tiny scurrying pink paws
    ctx.fillStyle = '#ffb5b5';
    ctx.beginPath();
    ctx.ellipse(-10 + stride * 4, 11, 5, 3, 0, 0, TAU);
    ctx.ellipse(10 - stride * 4, 11, 5, 3, 0, 0, TAU);
    ctx.fill();

    // Fluffy tail nub
    ctx.fillStyle = '#fff1d6';
    ctx.beginPath();
    ctx.arc(-18, 1, 4.5, 0, TAU);
    ctx.fill();

    // Speed burst aura shimmer
    if (speedBurstTimer > 0) {
      const aPulse = 0.55 + 0.35 * Math.sin(elapsed * 18);
      ctx.fillStyle = 'rgba(94, 230, 255, ' + (0.32 * aPulse).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(-player.facing * 4, 0, 24, 18, 0, 0, TAU);
      ctx.fill();
    }

    // Chubby golden-tan hamster body
    ctx.fillStyle = '#e39a46';
    ctx.strokeStyle = '#8c4f17';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 19, 14.5, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Warm dorsal stripe
    ctx.fillStyle = '#a85e1e';
    ctx.beginPath();
    ctx.ellipse(-3, -5, 11, 4, 0.08, 0, TAU);
    ctx.fill();

    // Cream tummy & puffy cheek
    ctx.fillStyle = '#fff0d4';
    ctx.beginPath();
    ctx.ellipse(5, 5, 11, 7.5, -0.1, 0, TAU);
    ctx.fill();

    // Round ears
    ctx.fillStyle = '#d98834';
    ctx.strokeStyle = '#8c4f17';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(5, -13, 5.2, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffadad';
    ctx.beginPath();
    ctx.arc(5, -13, 2.6, 0, TAU);
    ctx.fill();

    // Rosy cheek
    ctx.fillStyle = 'rgba(255, 120, 130, 0.55)';
    ctx.beginPath();
    ctx.arc(9, 4, 3.6, 0, TAU);
    ctx.fill();

    // Bright eye & nose
    ctx.fillStyle = '#1a120b';
    ctx.beginPath();
    ctx.arc(11, -3.5, 2.8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(11.8, -4.3, 1, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#ff7b89';
    ctx.beginPath();
    ctx.arc(18.5, 0, 2.4, 0, TAU);
    ctx.fill();

    // Whiskers
    ctx.strokeStyle = '#6b4220';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(15, 2);
    ctx.lineTo(22, 0);
    ctx.moveTo(15, 4);
    ctx.lineTo(21, 5.5);
    ctx.stroke();

    ctx.restore();
  }

  function drawParticlesAndPopups() {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const px = p.x - cameraX;
      if (px < -30 || px > W + 30) continue;
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < popups.length; i++) {
      const pp = popups[i];
      const px = pp.x - cameraX;
      if (px < -100 || px > W + 100) continue;
      const a = clamp(pp.life / pp.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = 'bold ' + Math.round(16 * pp.scale) + 'px "Courier New", monospace';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(8, 18, 28, 0.88)';
      ctx.strokeText(pp.text, px, pp.y);
      ctx.fillStyle = pp.color;
      ctx.fillText(pp.text, px, pp.y);
    }
    ctx.globalAlpha = 1;
  }

  /* ---- World-Space Beach Landmarks ---- */
  function drawDriftwood() {
    ctx.fillStyle = 'rgba(85, 52, 22, 0.28)';
    ctx.beginPath();
    ctx.ellipse(2, 8, 38, 9, 0.05, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#bfa987';
    ctx.strokeStyle = '#7c6544';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-34, 4);
    ctx.quadraticCurveTo(-15, -6, 12, -2);
    ctx.quadraticCurveTo(28, -8, 36, 0);
    ctx.quadraticCurveTo(24, 7, -8, 6);
    ctx.quadraticCurveTo(-26, 8, -34, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#a99473';
    ctx.beginPath();
    ctx.moveTo(8, -2);
    ctx.lineTo(15, -16);
    ctx.lineTo(20, -14);
    ctx.lineTo(16, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#8f7754';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-24, 3);
    ctx.quadraticCurveTo(-4, 0, 22, 2);
    ctx.stroke();

    ctx.fillStyle = '#4a7d3e';
    ctx.beginPath();
    ctx.arc(-18, 5, 2.5, 0, TAU);
    ctx.arc(-15, 6, 2, 0, TAU);
    ctx.fill();
  }

  function drawSandcastle(seed) {
    ctx.fillStyle = 'rgba(80, 50, 20, 0.32)';
    ctx.beginPath();
    ctx.ellipse(0, 14, 30, 9, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#dcba76';
    ctx.strokeStyle = '#9e7e3e';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-26, 14);
    ctx.lineTo(-20, -2);
    ctx.lineTo(20, -2);
    ctx.lineTo(26, 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#e5c988';
    ctx.beginPath();
    ctx.rect(-22, -18, 10, 16);
    ctx.rect(-23, -22, 4, 5);
    ctx.rect(-15, -22, 4, 5);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.rect(12, -18, 10, 16);
    ctx.rect(11, -22, 4, 5);
    ctx.rect(19, -22, 4, 5);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.rect(-7, -24, 14, 22);
    ctx.rect(-8, -28, 4, 5);
    ctx.rect(4, -28, 4, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#5c3d18';
    ctx.beginPath();
    ctx.arc(0, 8, 5.5, Math.PI, 0);
    ctx.lineTo(5.5, 14);
    ctx.lineTo(-5.5, 14);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#5a3d1c';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(0, -42);
    ctx.stroke();

    const flutter = Math.sin(elapsed * 8.5 + seed) * 3;
    const flagColor = Math.abs(seed) % 2 === 0 ? '#ff594d' : '#22c5e2';
    ctx.fillStyle = flagColor;
    ctx.beginPath();
    ctx.moveTo(0, -42);
    ctx.lineTo(14, -37 + flutter);
    ctx.lineTo(0, -32);
    ctx.closePath();
    ctx.fill();
  }

  function drawBeachUmbrella(seed) {
    const angle = (Math.abs(seed) % 2 === 0 ? 0.18 : -0.18);
    ctx.save();
    ctx.rotate(angle);

    ctx.fillStyle = 'rgba(75, 48, 18, 0.32)';
    ctx.beginPath();
    ctx.ellipse(14, 28, 32, 11, -angle, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = '#e6ddca';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 26);
    ctx.lineTo(0, -18);
    ctx.stroke();
    ctx.strokeStyle = '#968162';
    ctx.lineWidth = 1;
    ctx.stroke();

    const c1 = '#ff6b57';
    const c2 = '#fffdf0';
    const w = 34, h = 18;
    const wedges = 6;
    for (let k = 0; k < wedges; k++) {
      const x0 = -w + (k / wedges) * (2 * w);
      const x1 = -w + ((k + 1) / wedges) * (2 * w);
      const xm = (x0 + x1) * 0.5;
      const y0 = -18 - (1 - Math.pow(x0 / w, 2)) * h;
      const y1 = -18 - (1 - Math.pow(x1 / w, 2)) * h;
      const ym = -18 - (1 - Math.pow(xm / w, 2)) * (h + 2);

      ctx.fillStyle = k % 2 === 0 ? c1 : c2;
      ctx.beginPath();
      ctx.moveTo(0, -18 - h - 3);
      ctx.lineTo(x0, y0);
      ctx.quadraticCurveTo(xm, ym, x1, y1);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = '#d4503d';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-w, -18);
    ctx.quadraticCurveTo(0, -18 - h * 0.3, w, -18);
    ctx.stroke();

    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(0, -18 - h - 3, 3.5, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  function drawTideStones(seed) {
    ctx.fillStyle = 'rgba(70, 45, 16, 0.30)';
    ctx.beginPath();
    ctx.ellipse(0, 7, 28, 8, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#657382';
    ctx.strokeStyle = '#434e5a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(-7, 2, 16, 11, -0.2, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(-10, -3, 8, 3.5, -0.2, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#ad9b84';
    ctx.strokeStyle = '#7c6b57';
    ctx.beginPath();
    ctx.ellipse(12, 4, 12, 8, 0.3, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#394149';
    ctx.beginPath();
    ctx.ellipse(4, 9, 6, 4, -0.4, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#528243';
    ctx.beginPath();
    ctx.arc(-2, -4, 2.8, 0, TAU);
    ctx.arc(1, -2, 2.2, 0, TAU);
    ctx.fill();
  }

  function drawLandmarks() {
    const period = 1400;
    const minK = Math.floor((cameraX - 160) / period);
    const maxK = Math.floor((cameraX + W + 160) / period);

    for (let k = minK; k <= maxK; k++) {
      const jitterX = Math.sin(k * 7.9) * 180;
      const worldX = k * period + 700 + jitterX;
      const lx = worldX - cameraX;
      if (lx < -120 || lx > W + 120) continue;

      const ly = lerp(H * 0.30, H * 0.46, 0.5 + 0.45 * Math.cos(k * 4.3));
      const type = Math.abs(k) % 4;

      ctx.save();
      ctx.translate(lx, ly);

      if (type === 0) {
        drawDriftwood();
      } else if (type === 1) {
        drawSandcastle(k);
      } else if (type === 2) {
        drawBeachUmbrella(k);
      } else {
        drawTideStones(k);
      }

      ctx.restore();
    }
  }

  /* ---- Canvas HUD & Tide Banner ---- */
  function triggerTideBanner(text, color, sub) {
    tideBanner.text = text;
    tideBanner.color = color;
    tideBanner.sub = sub;
    tideBanner.timer = tideBanner.dur;
  }

  function drawTideBanner() {
    if (tideBanner.timer <= 0) return;
    let alpha = 1;
    if (tideBanner.timer > tideBanner.dur - 0.3) {
      alpha = (tideBanner.dur - tideBanner.timer) / 0.3;
    } else if (tideBanner.timer < 0.5) {
      alpha = tideBanner.timer / 0.5;
    }
    alpha = clamp(alpha, 0, 1);

    ctx.save();
    ctx.globalAlpha = alpha;
    const bw = Math.min(360, W * 0.72);
    const bh = 52;
    const bx = (W - bw) * 0.5;
    const by = Math.max(16, skyEnd() + 10);

    ctx.fillStyle = 'rgba(6, 21, 33, 0.90)';
    ctx.strokeStyle = tideBanner.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 8);
    else ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.stroke();

    ctx.font = '900 19px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = tideBanner.color;
    ctx.fillText(tideBanner.text, W * 0.5, by + 18);

    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillStyle = '#eef6fc';
    ctx.fillText(tideBanner.sub, W * 0.5, by + 37);
    ctx.restore();
  }

  function drawCanvasHud() {
    if (mode !== 'play') return;

    // Active combo streak badge on canvas with timer drain
    if (streakCount >= 2 && streakTimer > 0) {
      ctx.save();
      const mult = getStreakMultiplier(streakCount);
      const badgeW = 126;
      const badgeH = 24;
      const bx = W * 0.5 - badgeW * 0.5;
      const by = 12;

      ctx.fillStyle = 'rgba(6, 21, 33, 0.85)';
      ctx.strokeStyle = mult >= 3 ? '#ff6b57' : (mult >= 2 ? '#ffd23f' : '#5ee6ff');
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, badgeW, badgeH, 12);
      else ctx.rect(bx, by, badgeW, badgeH);
      ctx.fill();
      ctx.stroke();

      const barRatio = clamp(streakTimer / STREAK_WINDOW, 0, 1);
      ctx.fillStyle = mult >= 3 ? '#ff6b57' : (mult >= 2 ? '#ffd23f' : '#5ee6ff');
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx + 6, by + badgeH - 4, (badgeW - 12) * barRatio, 2.5, 1);
      else ctx.rect(bx + 6, by + badgeH - 4, (badgeW - 12) * barRatio, 2.5);
      ctx.fill();

      ctx.font = '900 11px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('CHAIN ' + streakCount + ' · ' + (mult > 1 ? mult + '×' : '1×'), bx + badgeW * 0.5, by + badgeH * 0.5 - 1);
      ctx.restore();
    }

    // Speed burst indicator
    if (speedBurstTimer > 0) {
      ctx.save();
      const sw = 110;
      const sh = 20;
      const sx = W * 0.5 - sw * 0.5;
      const sy = streakCount >= 2 && streakTimer > 0 ? 40 : 12;

      ctx.fillStyle = 'rgba(6, 21, 33, 0.82)';
      ctx.strokeStyle = '#5ee6ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(sx, sy, sw, sh, 10);
      else ctx.rect(sx, sy, sw, sh);
      ctx.fill();
      ctx.stroke();

      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#5ee6ff';
      ctx.fillText('SPEED ' + speedBurstTimer.toFixed(1) + 's', sx + sw * 0.5, sy + sh * 0.5);
      ctx.restore();
    }

    drawTideBanner();
  }

  function drawMound(m) {
    const mx = m.x - cameraX;
    if (mx < -50 || mx > W + 50) return;

    const u = clamp(m.timer / m.dur, 0, 1);
    const wiggle = Math.sin(m.timer * 36 + m.seed) * (1.2 + 2.8 * u);
    const pulse = 1 + Math.sin(m.timer * 22 + m.seed) * (0.05 + 0.08 * u);
    const rx = (18 + u * 5) * pulse;
    const ry = (11 + u * 4) * (2 - pulse);

    ctx.save();
    ctx.translate(mx + wiggle, m.y);

    if (u > 0.25) {
      const ringAlpha = lerp(0.16, 0.62, (u - 0.25) / 0.75);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(232, 82, 50, ' + ringAlpha.toFixed(2) + ')';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(-wiggle * 0.4, 2, 24, 13, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(95, 65, 25, 0.30)';
    ctx.beginPath();
    ctx.ellipse(0, 5, rx * 1.08, ry * 0.72, 0, 0, TAU);
    ctx.fill();

    const mGrad = ctx.createRadialGradient(-3, -4, 2, 0, 0, rx);
    mGrad.addColorStop(0, '#f3d89b');
    mGrad.addColorStop(0.65, '#cfa158');
    mGrad.addColorStop(1, '#9f7230');
    ctx.fillStyle = mGrad;
    ctx.strokeStyle = '#8b6022';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, Math.PI, 0);
    ctx.quadraticCurveTo(rx, 6, 0, 6);
    ctx.quadraticCurveTo(-rx, 6, -rx, 0);
    ctx.fill();
    ctx.stroke();

    if (u > 0.35) {
      ctx.strokeStyle = 'rgba(92, 56, 16, ' + (0.45 * u).toFixed(2) + ')';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-4, -ry * 0.55);
      ctx.lineTo(1, -ry * 0.15);
      ctx.lineTo(6, -ry * 0.45);
      ctx.stroke();
    }

    for (let b = 0; b < 3; b++) {
      const phase = (m.timer * 3.2 + b * 0.33 + m.seed) % 1;
      const bx = Math.sin(b * 2.4 + m.seed) * 10;
      const by = -ry * 0.5 - phase * 14;
      const br = (2.8 - phase * 1.4) * (0.6 + 0.5 * u);
      ctx.fillStyle = 'rgba(246, 222, 168, ' + ((1 - phase) * 0.85).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(0.8, br), 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  function render() {
    ctx.save();
    if (hurtShake > 0) {
      const mag = (hurtShake / 0.28) * 7;
      ctx.translate(rand(-mag, mag), rand(-mag, mag));
    }

    drawSkyAndOcean();
    drawLandmarks();
    drawWaves();

    for (let i = 0; i < mounds.length; i++) {
      drawMound(mounds[i]);
    }
    for (let i = 0; i < shells.length; i++) {
      drawSandDollar(shells[i]);
    }
    for (let i = 0; i < crabs.length; i++) {
      drawCrab(crabs[i]);
    }

    drawHamster();

    for (let i = 0; i < gulls.length; i++) {
      drawSeagull(gulls[i]);
    }

    drawParticlesAndPopups();
    drawCanvasHud();
    ctx.restore();
  }

  /* ---- HUD Sync ---- */
  function fmtTime(s) {
    s = Math.floor(s);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function updateHud() {
    const sc = currentScore();
    const elScore = $('hudScore');
    const elBest = $('hudHi');
    const elShells = $('hudShells');
    const elStreak = $('hudStreak');
    const elStreakVal = $('hudStreakVal');
    const elTime = $('hudTime');
    const elHearts = $('hudHearts');

    if (elScore) elScore.textContent = sc.toLocaleString();
    if (elBest) elBest.textContent = Math.max(highScore, sc).toLocaleString();
    if (elShells) elShells.textContent = totalSandDollars;
    if (elStreak && elStreakVal) {
      if (streakCount >= 2 && streakTimer > 0) {
        elStreak.style.display = 'flex';
        const mult = getStreakMultiplier(streakCount);
        elStreakVal.textContent = mult + '×';
        elStreakVal.style.color = mult >= 3 ? '#ff6b57' : (mult >= 2 ? '#ffd23f' : '#5ee6ff');
      } else {
        elStreak.style.display = 'none';
      }
    }
    if (elTime) elTime.textContent = fmtTime(elapsed);
    if (elHearts) {
      let heartsHtml = '';
      for (let i = 0; i < maxLives; i++) {
        heartsHtml += i < lives ? '<span class="heart on">♥</span>' : '<span class="heart off">♡</span>';
      }
      elHearts.innerHTML = heartsHtml;
    }
  }

  /* ---- Lifecycle & Main Loop ---- */
  function resetRun() {
    elapsed = 0;
    shellScore = 0;
    totalSandDollars = 0;
    tierCounts = { common: 0, medium: 0, pearl: 0, star: 0 };
    lives = maxLives;
    invulnTimer = 0;
    hurtShake = 0;
    newHighFlag = false;

    streakCount = 0;
    streakTimer = 0;
    speedBurstTimer = 0;
    speedBurstSparkleTimer = 0;
    tideState = 'low';
    tideBanner.timer = 0;

    player.x = 0;
    player.y = H * 0.42;
    player.vx = 0;
    player.vy = 0;
    player.facing = 1;
    player.bob = 0;
    player.lean = 0;
    player.squash = 0;
    cameraX = player.x - W * 0.5;
    exploredMinX = cameraX;
    exploredMaxX = cameraX + W;

    shells = [];
    crabs = [];
    mounds = [];
    waves = [];
    gulls = [];
    particles = [];
    popups = [];
    tracks = [];

    timers.crab = 1.3;
    timers.mound = rand(3.8, 6.0);
    timers.wave = 1.2;
    timers.gull = 4.5;
    timers.footprint = 0;
    timers.seaStar = rand(22, 28);

    seedInitialBeach();

    In.reset();
    In.recalibrateTilt();
    updateHud();
  }

  function start() {
    applyOrientation();
    resetRun();
    mode = 'play';
    document.body.classList.add('playing');
    Snd.resume();
    Snd.sfx.start();
    Snd.musicStart(function () { return elapsed; });
  }

  function pause() {
    if (mode !== 'play') return false;
    mode = 'pause';
    document.body.classList.remove('playing');
    Snd.musicStop();
    In.reset();
    return true;
  }

  function resume() {
    if (mode !== 'pause') return false;
    mode = 'play';
    document.body.classList.add('playing');
    In.recalibrateTilt();
    Snd.resume();
    Snd.musicStart(function () { return elapsed; });
    return true;
  }

  function quit() {
    mode = 'menu';
    document.body.classList.remove('playing');
    Snd.musicStop();
    In.reset();
    resetRun();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && mode === 'play') {
      if (pause() && callbacks.onAutoPause) callbacks.onAutoPause();
    }
  });

  window.addEventListener('blur', function () {
    if (mode === 'play') {
      if (pause() && callbacks.onAutoPause) callbacks.onAutoPause();
    }
  });

  let lastTs = 0;
  function frame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
    lastTs = ts;

    if (mode === 'play') {
      update(dt);
    } else if (mode === 'menu') {
      elapsed += dt * 0.45;
      const cSpan = cloudWrapSpan();
      for (let i = 0; i < clouds.length; i++) {
        clouds[i].x = posMod(clouds[i].x - clouds[i].speed * 0.5 * dt, cSpan);
      }
    }

    render();
    requestAnimationFrame(frame);
  }

  initBackdrop();
  applyOrientation();
  requestAnimationFrame(applyOrientation);
  window.addEventListener('load', applyOrientation);
  resetRun();
  updateHud();
  requestAnimationFrame(frame);

  BH.Game = {
    start: start,
    pause: pause,
    resume: resume,
    quit: quit,
    getMode: function () { return mode; },
    getHigh: function () { return highScore; },
    setOrientationMode: setOrientationMode,
    getOrientationMode: function () { return orientPref; },
    getEffectiveOrientation: function () { return effectiveOrient; },
    applyOrientation: applyOrientation,
    set onAutoPause(fn) { callbacks.onAutoPause = fn; },
    set onGameOver(fn) { callbacks.onGameOver = fn; },
    set onOrientChange(fn) { callbacks.onOrientChange = fn; }
  };
})();
