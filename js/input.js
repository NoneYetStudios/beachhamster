/* Beach Hamster - unified keyboard (WASD/Arrows), touch drag, and optional DeviceOrientation tilt input. */
(function () {
  'use strict';
  window.BH = window.BH || {};

  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const keys = Object.create(null);

  let logicalW = 1280;
  let logicalH = 720;

  const touchState = {
    activeId: null,
    lastX: 0,
    lastY: 0,
    dragDx: 0,
    dragDy: 0,
    isTouchDevice: false
  };

  const tiltState = {
    supported: typeof window !== 'undefined' && 'DeviceOrientationEvent' in window,
    enabled: false,
    listening: false,
    calibrated: false,
    baseBeta: 35,
    baseGamma: 0,
    vx: 0,
    vy: 0,
    onChange: null
  };

  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    touchState.isTouchDevice = true;
    document.body.classList.add('touch');
  }

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  }

  window.addEventListener('keydown', function (e) {
    if (isTyping(e)) return;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) {
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
  });

  window.addEventListener('blur', function () {
    for (const k in keys) keys[k] = false;
    touchState.activeId = null;
    touchState.dragDx = 0;
    touchState.dragDy = 0;
  });

  /* ---- Touch / Pointer Drag (1:1 relative drag in logical coordinates) ---- */
  function toLogicalScale() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return { sx: 1, sy: 1 };
    return { sx: logicalW / r.width, sy: logicalH / r.height };
  }

  stage.addEventListener('pointerdown', function (e) {
    if (!document.body.classList.contains('playing')) return;
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      touchState.isTouchDevice = true;
      document.body.classList.add('touch');
    }
    if (touchState.activeId !== null) return;
    // Allow touch drag (and optional mouse drag) directly on canvas/stage
    if (e.target !== canvas && e.target !== stage) return;
    touchState.activeId = e.pointerId;
    touchState.lastX = e.clientX;
    touchState.lastY = e.clientY;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { }
    e.preventDefault();
  });

  stage.addEventListener('pointermove', function (e) {
    if (e.pointerId !== touchState.activeId) return;
    const scale = toLogicalScale();
    const dx = (e.clientX - touchState.lastX) * scale.sx * 1.15;
    const dy = (e.clientY - touchState.lastY) * scale.sy * 1.15;
    touchState.lastX = e.clientX;
    touchState.lastY = e.clientY;
    touchState.dragDx += dx;
    touchState.dragDy += dy;
    e.preventDefault();
  });

  function endPointer(e) {
    if (e.pointerId !== touchState.activeId) return;
    touchState.activeId = null;
  }

  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  ['touchstart', 'touchmove'].forEach(function (evName) {
    stage.addEventListener(evName, function (e) {
      if (document.body.classList.contains('playing')) {
        e.preventDefault();
      }
    }, { passive: false });
  });

  /* ---- Optional DeviceOrientation Tilt Controls ---- */
  function getScreenAngle() {
    if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number') {
      return window.screen.orientation.angle;
    }
    return typeof window.orientation === 'number' ? window.orientation : 0;
  }

  function handleOrientation(e) {
    if (!tiltState.enabled) return;
    if (typeof e.beta !== 'number' || typeof e.gamma !== 'number') return;

    // Remap beta/gamma according to screen rotation angle
    const angle = ((getScreenAngle() % 360) + 360) % 360;
    let rawX = e.gamma;
    let rawY = e.beta;

    if (angle === 90) {
      rawX = e.beta;
      rawY = -e.gamma;
    } else if (angle === 270) {
      rawX = -e.beta;
      rawY = e.gamma;
    } else if (angle === 180) {
      rawX = -e.gamma;
      rawY = -e.beta;
    }

    if (!tiltState.calibrated) {
      tiltState.baseGamma = rawX;
      tiltState.baseBeta = rawY;
      tiltState.calibrated = true;
    }

    const dxDeg = rawX - tiltState.baseGamma;
    const dyDeg = rawY - tiltState.baseBeta;
    const dead = 2.8;
    const span = 20;

    function norm(deg) {
      if (Math.abs(deg) < dead) return 0;
      const s = deg > 0 ? (deg - dead) : (deg + dead);
      return Math.max(-1, Math.min(1, s / span));
    }

    tiltState.vx = norm(dxDeg);
    tiltState.vy = norm(dyDeg);
  }

  function attachTiltListener() {
    if (tiltState.listening) return;
    window.addEventListener('deviceorientation', handleOrientation, true);
    tiltState.listening = true;
  }

  async function setTiltEnabled(enable) {
    if (!enable) {
      tiltState.enabled = false;
      tiltState.vx = 0;
      tiltState.vy = 0;
      if (tiltState.onChange) tiltState.onChange(false);
      return { ok: true, enabled: false };
    }
    if (!tiltState.supported) {
      return { ok: false, error: 'Tilt sensors are not available on this device.' };
    }
    try {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') {
          tiltState.enabled = false;
          if (tiltState.onChange) tiltState.onChange(false);
          return { ok: false, error: 'Motion sensor permission was denied.' };
        }
      }
      attachTiltListener();
      tiltState.calibrated = false;
      tiltState.enabled = true;
      if (tiltState.onChange) tiltState.onChange(true);
      return { ok: true, enabled: true };
    } catch (err) {
      tiltState.enabled = false;
      if (tiltState.onChange) tiltState.onChange(false);
      return { ok: false, error: 'Could not enable tilt controls.' };
    }
  }

  BH.Input = {
    setLogicalSize: function (w, h) {
      logicalW = w;
      logicalH = h;
    },
    getMove: function () {
      let x = 0, y = 0;
      if (keys.KeyA || keys.ArrowLeft) x -= 1;
      if (keys.KeyD || keys.ArrowRight) x += 1;
      if (keys.KeyW || keys.ArrowUp) y -= 1;
      if (keys.KeyS || keys.ArrowDown) y += 1;
      if (x && y) {
        x *= Math.SQRT1_2;
        y *= Math.SQRT1_2;
      }
      if (tiltState.enabled) {
        x += tiltState.vx;
        y += tiltState.vy;
      }
      const mag = Math.hypot(x, y);
      if (mag > 1) {
        x /= mag;
        y /= mag;
      }
      return { x: x, y: y };
    },
    consumeDragDelta: function () {
      const dx = touchState.dragDx;
      const dy = touchState.dragDy;
      touchState.dragDx = 0;
      touchState.dragDy = 0;
      return { dx: dx, dy: dy };
    },
    recalibrateTilt: function () {
      tiltState.calibrated = false;
      tiltState.vx = 0;
      tiltState.vy = 0;
    },
    setTiltEnabled: setTiltEnabled,
    isTiltEnabled: function () { return tiltState.enabled; },
    isTiltSupported: function () { return tiltState.supported; },
    onTiltChange: function (fn) { tiltState.onChange = fn; },
    reset: function () {
      for (const k in keys) keys[k] = false;
      touchState.activeId = null;
      touchState.dragDx = 0;
      touchState.dragDy = 0;
    }
  };
})();
