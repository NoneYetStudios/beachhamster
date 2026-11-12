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
  let tierCounts = { common: 0, medium: 0, pearl: 0 };
  let lives = 3;
  let maxLives = 3;
  let invulnTimer = 0;
  let hurtShake = 0;
  let newHighFlag = false;

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
  let waves = [];
  let gulls = [];
  let particles = [];
  let popups = [];
  let clouds = [];
  let decor = [];
  let tracks = [];

  let timers = {
    crab: 1.5,
    wave: 1.6,
    gull: 5.0,
    footprint: 0
  };

  const callbacks = {
    onAutoPause: null,
    onGameOver: null,
    onOrientChange: null
  };

  /* ---- Shoreline Ratios ---- */
  function skyEnd() { return H * 0.13; }
  function duneEnd() { return H * 0.21; }
  function playTop() { return H * 0.225; }
  function midBeachEnd() { return H * 0.60; }
  function surfBase() { return H * 0.86; }
  function playBottom() { return H * 0.855; }

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
    const changed = next !== effectiveOrient || W !== DIMS[next].w || H !== DIMS[next].h;

    if (changed) {
      const oldH = H;
      effectiveOrient = next;
      W = DIMS[next].w;
      H = DIMS[next].h;
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
  }

  window.addEventListener('resize', applyOrientation);
  window.addEventListener('orientationchange', function () {
    setTimeout(applyOrientation, 80);
  });

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
    pearl: { pts: 100, r: 7.5, hitPad: 0 }
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

    // Occasional single Common in upper beach; Medium (25 pt) shells in active mid-to-lower tide zone
    spawnShell('common', -W * 0.26, H * 0.31);
    spawnShell('medium', W * 0.24, H * 0.54);
    spawnShell('medium', -W * 0.30, H * 0.62);
    spawnShell('medium', W * 0.38, H * 0.65);
  }

  function spawnHorizonShells(dir, edgeX) {
    // Spawn off-screen exploration shells (never Golden Pearls; heavily favor mid-to-lower tide zone)
    // Returns the horizontal span covered so exploredMinX/exploredMaxX advances cleanly.
    const roll = Math.random();
    const step = effectiveOrient === 'portrait' ? 56 : 64;
    let span = 0;

    if (roll < 0.18) {
      // Occasional single Common (10 pt) shell in the upper third (y < H * 0.42)
      spawnShell('common', edgeX + dir * 24, rand(H * 0.25, H * 0.40));
      span = 48;
    } else if (roll < 0.65) {
      // Mid-to-lower beach arc of Common (10 pt) shells + optional Medium in damp sand
      const count = Math.floor(rand(3, 6));
      const baseY = rand(H * 0.44, H * 0.61);
      const amp = rand(-24, 28);
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0.5;
        const sy = clamp(baseY + Math.sin(t * Math.PI) * amp, H * 0.42, H * 0.72);
        spawnShell('common', edgeX + dir * (i * step), sy);
      }
      span = (count - 1) * step;
      if (Math.random() < 0.6) {
        spawnShell('medium', edgeX + dir * (span * 0.5), rand(H * 0.57, H * 0.72));
      }
    } else {
      // Cluster of Medium (25 pt) sun-bleached shells in active mid-to-lower tide zone
      const baseY = rand(H * 0.48, H * 0.69);
      const count = Math.floor(rand(2, 4));
      for (let i = 0; i < count; i++) {
        const sy = clamp(baseY + (i % 2 === 0 ? -14 : 14), H * 0.43, H * 0.74);
        spawnShell('medium', edgeX + dir * (i * step), sy);
      }
      span = (count - 1) * step;
      if (Math.random() < 0.45) {
        span += step + 20;
        spawnShell('common', edgeX + dir * span, rand(H * 0.44, H * 0.60));
      }
    }
    return span;
  }

  /* ---- Hazard Spawners ---- */
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
    // Dune-biased gulls: ~65% target upper beach (playTop() to H * 0.42)
    const targetY = Math.random() < 0.65
      ? rand(playTop() + 10, H * 0.42)
      : rand(H * 0.42, H * 0.72);
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
          pearl: tierCounts.pearl
        },
        newHigh: newHighFlag
      });
    }
  }

  /* ---- Simulation Update ---- */
  function update(dt) {
    if (mode !== 'play') return;

    elapsed += dt;

    if (invulnTimer > 0) invulnTimer = Math.max(0, invulnTimer - dt);
    if (hurtShake > 0) hurtShake = Math.max(0, hurtShake - dt);
    if (player.squash > 0) player.squash = Math.max(0, player.squash - dt * 2.5);

    // Free 4-way movement: keyboard + tilt + 1:1 touch drag in endless world X
    const mv = In.getMove();
    const moveSpd = effectiveOrient === 'portrait' ? 375 : 415;
    const drag = In.consumeDragDelta();

    player.vx = mv.x * moveSpd;
    player.vy = mv.y * moveSpd;
    const stepX = player.vx * dt + drag.dx;
    const stepY = player.vy * dt + drag.dy;

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

    // Tiny sand footprints while moving
    timers.footprint -= dt;
    if (timers.footprint <= 0 && moveMag > 35) {
      timers.footprint = 0.095;
      tracks.push({ x: player.x - player.facing * 10, y: player.y + 11, life: 0.9 });
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

    const viewCenterX = cameraX + W * 0.5;

    // Update Sand Dollars & Check Collection / Despawn
    for (let i = shells.length - 1; i >= 0; i--) {
      const sh = shells[i];
      sh.age += dt;
      sh.phase += dt * 4.5;

      const playerCore = sh.tier === 'pearl' ? 12 : player.r;
      const dist = Math.hypot(player.x - sh.x, player.y - sh.y);
      if (dist <= sh.hitR + playerCore) {
        const surfBonus = sh.y > H * 0.56;
        const ptsEarned = surfBonus ? sh.pts * 2 : sh.pts;
        shellScore += ptsEarned;
        totalSandDollars += 1;
        tierCounts[sh.tier] += 1;
        player.squash = 0.28;

        if (sh.tier === 'common') {
          Snd.sfx.pickupCommon();
          addParticles(sh.x, sh.y, surfBonus ? '#8bf2ff' : '#fff7dc', 8, 95, 120);
          addPopup(
            sh.x,
            sh.y - 14,
            surfBonus ? '+' + ptsEarned + ' SURF BONUS!' : '+' + ptsEarned,
            surfBonus ? '#7cf2ff' : '#ffffff',
            surfBonus ? 1.1 : 0.95
          );
        } else if (sh.tier === 'medium') {
          Snd.sfx.pickupMedium();
          addParticles(sh.x, sh.y, surfBonus ? '#8bf2ff' : '#ffe89e', 11, 125, 140);
          addPopup(
            sh.x,
            sh.y - 16,
            surfBonus ? '+' + ptsEarned + ' SURF BONUS!' : '+' + ptsEarned,
            surfBonus ? '#7cf2ff' : '#fff0a8',
            surfBonus ? 1.2 : 1.1
          );
        } else {
          Snd.sfx.pickupPearl();
          addParticles(sh.x, sh.y, '#ffd23f', 18, 175, 130);
          addPopup(
            sh.x,
            sh.y - 20,
            surfBonus ? '+' + ptsEarned + ' PEARL SURF BONUS!' : '+' + ptsEarned + ' PEARL!',
            '#ffd23f',
            surfBonus ? 1.45 : 1.35
          );
        }
        shells.splice(i, 1);
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
            // Deposit 1-3 fresh shells in the wet wash zone (favoring Pearls & Mediums)
            const washCount = Math.floor(rand(1, 4));
            for (let k = 0; k < washCount; k++) {
              const tSpan = washCount === 1
                ? rand(0.32, 0.68)
                : lerp(0.22, 0.78, k / (washCount - 1)) + rand(-0.07, 0.07);
              const tClamped = clamp(tSpan, 0.16, 0.84);
              const spawnX = wv.x + wv.w * tClamped;
              const archTop = getWaveCrestY(wv, spawnX, wv.peakY);
              const washY = clamp(archTop + rand(14, 48), playTop() + 36, playBottom() - 18);
              const tierRoll = Math.random();
              const tier = tierRoll < 0.50 ? 'pearl' : (tierRoll < 0.85 ? 'medium' : 'common');
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
    } else {
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
    ctx.scale(shadowScale, shadowScale);
    ctx.fillStyle = 'rgba(20, 26, 36, ' + shadowAlpha.toFixed(2) + ')';
    ctx.beginPath();
    ctx.ellipse(0, 0, 24, 10, 0, 0, TAU);
    ctx.fill();

    if (g.altitude < 0.35) {
      ctx.strokeStyle = 'rgba(255, 95, 65, ' + (0.65 * (1 - g.altitude / 0.35)).toFixed(2) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 26, 14, 0, 0, TAU);
      ctx.stroke();
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

  function render() {
    ctx.save();
    if (hurtShake > 0) {
      const mag = (hurtShake / 0.28) * 7;
      ctx.translate(rand(-mag, mag), rand(-mag, mag));
    }

    drawSkyAndOcean();
    drawWaves();

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
    const elTime = $('hudTime');
    const elHearts = $('hudHearts');

    if (elScore) elScore.textContent = sc.toLocaleString();
    if (elBest) elBest.textContent = Math.max(highScore, sc).toLocaleString();
    if (elShells) elShells.textContent = totalSandDollars;
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
    tierCounts = { common: 0, medium: 0, pearl: 0 };
    lives = maxLives;
    invulnTimer = 0;
    hurtShake = 0;
    newHighFlag = false;

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
    waves = [];
    gulls = [];
    particles = [];
    popups = [];
    tracks = [];

    timers.crab = 1.3;
    timers.wave = 1.2;
    timers.gull = 4.5;
    timers.footprint = 0;

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
