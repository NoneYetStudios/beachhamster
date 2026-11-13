/* Beach Hamster - unified keyboard (WASD/Arrows), floating touch joystick, and optional DeviceOrientation tilt input. */
(function () {
  'use strict';
  window.BH = window.BH || {};

  const touchPad = document.getElementById('touchPad');
  const touchPadCanvas = document.getElementById('touchPadCanvas');
  const touchPadCtx = touchPadCanvas ? touchPadCanvas.getContext('2d') : null;
  const keys = Object.create(null);

  const DEADZONE = 10;   // inner deadzone in #touchPad px
  const MAX_RADIUS = 42; // max radius in #touchPad px for full magnitude

  const joystick = {
    active: false,
    activeId: null,
    originX: 0,
    originY: 0,
    currX: 0,
    currY: 0,
    vx: 0,
    vy: 0
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

  function clearJoystick() {
    joystick.active = false;
    joystick.activeId = null;
    joystick.originX = 0;
    joystick.originY = 0;
    joystick.currX = 0;
    joystick.currY = 0;
    joystick.vx = 0;
    joystick.vy = 0;
    renderTouchPadJoystick();
  }

  window.addEventListener('blur', function () {
    for (const k in keys) keys[k] = false;
    clearJoystick();
  });

  /* ---- Floating Touch Joystick (#touchPad Coordinates) ---- */
  function toPadCoords(clientX, clientY) {
    if (!touchPad) return { x: 0, y: 0 };
    const r = touchPad.getBoundingClientRect();
    return {
      x: clientX - r.left,
      y: clientY - r.top
    };
  }

  function renderTouchPadJoystick() {
    if (!touchPad || !touchPadCanvas || !touchPadCtx) return;
    const w = touchPad.clientWidth;
    const h = touchPad.clientHeight;
    if (!w || !h) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (touchPadCanvas.width !== targetW || touchPadCanvas.height !== targetH) {
      touchPadCanvas.width = targetW;
      touchPadCanvas.height = targetH;
    }

    touchPadCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    touchPadCtx.clearRect(0, 0, w, h);

    if (!joystick.active) return;

    const dx = joystick.currX - joystick.originX;
    const dy = joystick.currY - joystick.originY;
    const dist = Math.hypot(dx, dy);
    let kx = joystick.currX;
    let ky = joystick.currY;
    if (dist > MAX_RADIUS) {
      kx = joystick.originX + (dx / dist) * MAX_RADIUS;
      ky = joystick.originY + (dy / dist) * MAX_RADIUS;
    }

    touchPadCtx.save();

    // Soft outer joystick ring
    touchPadCtx.beginPath();
    touchPadCtx.arc(joystick.originX, joystick.originY, MAX_RADIUS, 0, Math.PI * 2);
    touchPadCtx.fillStyle = 'rgba(11, 34, 51, 0.45)';
    touchPadCtx.fill();
    touchPadCtx.lineWidth = 2;
    touchPadCtx.strokeStyle = 'rgba(94, 230, 255, 0.52)';
    touchPadCtx.stroke();

    // Center anchor dot
    touchPadCtx.beginPath();
    touchPadCtx.arc(joystick.originX, joystick.originY, 3.5, 0, Math.PI * 2);
    touchPadCtx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    touchPadCtx.fill();

    // Glowing inner thumb nub
    touchPadCtx.shadowColor = 'rgba(94, 230, 255, 0.75)';
    touchPadCtx.shadowBlur = 12;
    touchPadCtx.beginPath();
    touchPadCtx.arc(kx, ky, 16, 0, Math.PI * 2);
    touchPadCtx.fillStyle = 'rgba(94, 230, 255, 0.68)';
    touchPadCtx.fill();
    touchPadCtx.shadowBlur = 0;
    touchPadCtx.lineWidth = 2;
    touchPadCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    touchPadCtx.stroke();

    touchPadCtx.restore();
  }

  function updateJoystickVector(pt) {
    joystick.currX = pt.x;
    joystick.currY = pt.y;

    const dx = pt.x - joystick.originX;
    const dy = pt.y - joystick.originY;
    const dist = Math.hypot(dx, dy);

    if (dist <= DEADZONE) {
      joystick.vx = 0;
      joystick.vy = 0;
    } else {
      const mag = Math.min(1, (dist - DEADZONE) / (MAX_RADIUS - DEADZONE));
      joystick.vx = (dx / dist) * mag;
      joystick.vy = (dy / dist) * mag;
    }
    renderTouchPadJoystick();
  }

  // Reveal #touchPad on first touch/pen interaction if browser did not match (pointer: coarse)
  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (!document.body.classList.contains('touch')) {
        document.body.classList.add('touch');
        if (window.BH && BH.Game && BH.Game.applyOrientation) {
          requestAnimationFrame(BH.Game.applyOrientation);
        }
        window.dispatchEvent(new Event('resize'));
      }
    }
  }, { passive: true });

  if (touchPad) {
    touchPad.addEventListener('pointerdown', function (e) {
      if (!document.body.classList.contains('playing')) return;
      if (joystick.activeId !== null) return;

      const pt = toPadCoords(e.clientX, e.clientY);
      joystick.active = true;
      joystick.activeId = e.pointerId;
      joystick.originX = pt.x;
      joystick.originY = pt.y;
      joystick.currX = pt.x;
      joystick.currY = pt.y;
      joystick.vx = 0;
      joystick.vy = 0;
      renderTouchPadJoystick();

      try { touchPad.setPointerCapture(e.pointerId); } catch (err) { }
      e.preventDefault();
    });

    touchPad.addEventListener('pointermove', function (e) {
      if (e.pointerId !== joystick.activeId) return;
      const pt = toPadCoords(e.clientX, e.clientY);
      updateJoystickVector(pt);
      e.preventDefault();
    });

    function endPointer(e) {
      if (e.pointerId !== joystick.activeId) return;
      clearJoystick();
    }

    touchPad.addEventListener('pointerup', endPointer);
    touchPad.addEventListener('pointercancel', endPointer);

    ['touchstart', 'touchmove'].forEach(function (evName) {
      touchPad.addEventListener(evName, function (e) {
        if (document.body.classList.contains('playing')) {
          e.preventDefault();
        }
      }, { passive: false });
    });
  }

  window.addEventListener('resize', renderTouchPadJoystick);

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
    setLogicalSize: function () {},
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
      if (joystick.active) {
        x += joystick.vx;
        y += joystick.vy;
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
    getJoystick: function () {
      if (!joystick.active) {
        return {
          active: false,
          originX: 0,
          originY: 0,
          knobX: 0,
          knobY: 0,
          radius: MAX_RADIUS
        };
      }
      const dx = joystick.currX - joystick.originX;
      const dy = joystick.currY - joystick.originY;
      const dist = Math.hypot(dx, dy);
      let kx = joystick.currX;
      let ky = joystick.currY;
      if (dist > MAX_RADIUS) {
        kx = joystick.originX + (dx / dist) * MAX_RADIUS;
        ky = joystick.originY + (dy / dist) * MAX_RADIUS;
      }
      return {
        active: true,
        originX: joystick.originX,
        originY: joystick.originY,
        knobX: kx,
        knobY: ky,
        radius: MAX_RADIUS
      };
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
      clearJoystick();
    }
  };
})();
