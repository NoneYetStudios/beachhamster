/* Beach Hamster - Web Audio API coastal arcade SFX & upbeat shoreline pulse. */
(function () {
  'use strict';
  window.BH = window.BH || {};

  let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let sfxOn = true;
  let musicRunning = false, timer = null, nextT = 0, step = 0;
  let getTime = function () { return 0; };

  try {
    sfxOn = localStorage.getItem('bh_sfx') !== '0';
  } catch (e) { /* storage unavailable */ }

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = sfxOn ? 0.65 : 0;
    master.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.85;
    sfxBus.connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.34;
    musicBus.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function resume() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function tone(o) {
    if (!ctx || !sfxOn) return;
    const t = o.t !== undefined ? o.t : ctx.currentTime + (o.at || 0);
    const d = o.d || 0.1, v = o.v || 0.22;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(g);
    g.connect(o.dest || sfxBus);
    osc.start(t);
    osc.stop(t + d + 0.03);
  }

  function noise(o) {
    if (!ctx || !sfxOn || !noiseBuf) return;
    const t = ctx.currentTime + (o.at || 0), d = o.d || 0.25, v = o.v || 0.15;
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = noiseBuf;
    src.loop = true;
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 900, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f2), t + d);
    f.Q.value = o.q || 1.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.08, d * 0.35));
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    src.start(t);
    src.stop(t + d + 0.03);
  }

  const sfx = {
    pickupCommon() {
      tone({ f: 587, f2: 784, d: 0.08, v: 0.18, type: 'triangle' });
    },
    pickupMedium() {
      tone({ f: 659, d: 0.06, v: 0.19, type: 'triangle' });
      tone({ f: 988, d: 0.1, v: 0.2, at: 0.055, type: 'sine' });
    },
    pickupPearl() {
      [880, 1175, 1568, 2093].forEach(function (f, i) {
        tone({ f: f, d: 0.12, v: 0.2, at: i * 0.045, type: 'sine' });
      });
    },
    waveWhoosh() {
      noise({ d: 0.45, v: 0.1, f: 450, f2: 1100, type: 'bandpass', q: 0.8 });
    },
    gullWarn() {
      tone({ f: 1450, f2: 1850, d: 0.08, v: 0.09, type: 'sine' });
      tone({ f: 1700, f2: 1250, d: 0.1, v: 0.08, at: 0.1, type: 'sine' });
    },
    hit() {
      tone({ f: 190, f2: 65, d: 0.24, v: 0.34, type: 'sawtooth' });
      noise({ d: 0.2, v: 0.22, f: 1100, f2: 300, type: 'lowpass' });
    },
    start() {
      [392, 494, 587, 784].forEach(function (f, i) {
        tone({ f: f, d: 0.1, v: 0.2, at: i * 0.065, type: 'triangle' });
      });
    },
    gameOver() {
      [494, 440, 392, 330, 262].forEach(function (f, i) {
        tone({ f: f, d: 0.18, v: 0.24, at: i * 0.15, type: 'triangle' });
      });
      noise({ d: 0.5, v: 0.16, f: 650, f2: 200, at: 0.65, type: 'lowpass' });
    },
    click() {
      tone({ f: 720, d: 0.035, v: 0.1, type: 'sine' });
    }
  };

  /* ---- Sunny coastal bass & marimba pulse ---- */
  const BASS = [131, 131, 165, 196, 147, 147, 175, 196];
  const LEAD = [523, 659, 784, 659, 587, 698, 784, 880];

  function stepDur(t) {
    return Math.max(0.11, 0.185 * Math.pow(0.996, t));
  }

  function schedule() {
    if (!ctx || !musicRunning) return;
    while (nextT < ctx.currentTime + 0.14) {
      const t = getTime();
      const idx = step % BASS.length;
      tone({ t: nextT, f: BASS[idx], d: 0.1, v: 0.35, type: 'triangle', dest: musicBus });
      if (step % 2 === 0 || (t > 25 && step % 4 === 3)) {
        tone({ t: nextT, f: LEAD[(step >> 1) % LEAD.length], d: 0.08, v: 0.18, type: 'sine', dest: musicBus });
      }
      nextT += stepDur(t);
      step++;
    }
  }

  function musicStart(timeFn) {
    if (!init()) return;
    resume();
    getTime = timeFn || getTime;
    if (musicRunning) return;
    musicRunning = true;
    step = 0;
    nextT = ctx.currentTime + 0.15;
    timer = setInterval(schedule, 25);
  }

  function musicStop() {
    musicRunning = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function setSfx(on) {
    sfxOn = !!on;
    try { localStorage.setItem('bh_sfx', sfxOn ? '1' : '0'); } catch (e) { }
    if (master) master.gain.value = sfxOn ? 0.65 : 0;
  }

  BH.Audio = {
    resume,
    sfx,
    musicStart,
    musicStop,
    setSfx,
    get sfxOn() { return sfxOn; }
  };
})();
