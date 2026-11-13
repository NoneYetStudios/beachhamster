/* Beach Hamster - menus, orientation/tilt toggles, dual-mode leaderboard, game-over flow. */
(function () {
  'use strict';
  const CFG = BH.CONFIG, Game = BH.Game, Snd = BH.Audio, In = BH.Input;
  const $ = function (id) { return document.getElementById(id); };
  const screens = ['menu', 'how', 'board', 'pause', 'over'];

  let current = 'menu';
  let boardReturn = 'menu';
  let lastResult = null;
  let submitted = false;
  let highlight = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  function fmtTime(s) {
    s = Math.floor(s);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  $('backBtn').href = CFG.ARCADE_URL;

  function show(name) {
    current = name;
    screens.forEach(function (s) {
      $('screen-' + s).classList.toggle('active', s === name);
    });
    if (name === 'menu') {
      $('menuHi').textContent = Game.getHigh().toLocaleString();
    }
  }

  function hideAll() {
    current = 'none';
    screens.forEach(function (s) {
      $('screen-' + s).classList.remove('active');
    });
  }

  function play() {
    Snd.resume();
    hideAll();
    Game.start();
  }

  /* ---------- Sound Toggle ---------- */
  function syncSound() {
    $('btnSound').classList.toggle('off', !Snd.sfxOn);
  }
  function toggleSound() {
    Snd.resume();
    Snd.setSfx(!Snd.sfxOn);
    syncSound();
  }
  $('btnSound').addEventListener('click', function () {
    toggleSound();
    this.blur();
  });
  syncSound();

  /* ---------- Orientation Toggle (Auto / Portrait / Landscape) ---------- */
  function syncOrientationUi(pref, eff) {
    const labelMap = {
      auto: 'VIEW: AUTO',
      portrait: 'VIEW: 9:16',
      landscape: 'VIEW: 16:9'
    };
    $('btnView').textContent = labelMap[pref] || 'VIEW: AUTO';
    $('btnView').title = 'Orientation (' + eff + ') - Click to switch';

    document.querySelectorAll('[data-orient]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-orient') === pref);
    });
  }

  Game.onOrientChange = syncOrientationUi;
  syncOrientationUi(Game.getOrientationMode(), Game.getEffectiveOrientation());

  $('btnView').addEventListener('click', function () {
    Snd.resume();
    Snd.sfx.click();
    const order = ['auto', 'portrait', 'landscape'];
    const cur = Game.getOrientationMode();
    const next = order[(order.indexOf(cur) + 1) % order.length];
    Game.setOrientationMode(next);
    this.blur();
  });

  document.querySelectorAll('[data-orient]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      Snd.resume();
      Snd.sfx.click();
      Game.setOrientationMode(btn.getAttribute('data-orient'));
    });
  });

  /* ---------- Tilt (DeviceOrientation) Toggle ---------- */
  function syncTiltUi(enabled) {
    const btnHud = $('btnTilt');
    const btnPause = $('btnPauseTilt');
    if (btnHud) {
      btnHud.classList.toggle('off', !enabled);
      btnHud.classList.toggle('on', enabled);
      btnHud.textContent = enabled ? 'TILT: ON' : 'TILT';
    }
    if (btnPause) {
      btnPause.textContent = enabled ? 'TILT STEER: ON' : 'TILT STEER: OFF';
      btnPause.classList.toggle('active', enabled);
    }
  }

  In.onTiltChange(syncTiltUi);
  syncTiltUi(In.isTiltEnabled());

  async function handleTiltToggle() {
    Snd.resume();
    Snd.sfx.click();
    const target = !In.isTiltEnabled();
    const res = await In.setTiltEnabled(target);
    const statusEl = $('tiltStatus');
    if (!res.ok && statusEl) {
      statusEl.textContent = res.error || 'Tilt unavailable.';
    } else if (statusEl) {
      statusEl.textContent = res.enabled ? 'Tilt calibrated to current angle.' : '';
    }
  }

  if ($('btnTilt')) {
    $('btnTilt').addEventListener('click', function () {
      handleTiltToggle();
      this.blur();
    });
  }
  if ($('btnPauseTilt')) {
    $('btnPauseTilt').addEventListener('click', function () {
      handleTiltToggle();
      this.blur();
    });
  }

  /* ---------- Pause ---------- */
  function pause() {
    if (Game.pause()) show('pause');
  }
  function resume() {
    if (Game.resume()) hideAll();
  }
  Game.onAutoPause = pause;

  $('btnPause').addEventListener('click', function () {
    this.blur();
    if (Game.getMode() === 'play') pause();
    else if (Game.getMode() === 'pause') resume();
  });
  $('btnResume').addEventListener('click', resume);
  $('btnQuit').addEventListener('click', function () {
    Game.quit();
    show('menu');
  });

  /* ---------- Menu Wiring ---------- */
  $('btnPlay').addEventListener('click', play);
  $('btnHow').addEventListener('click', function () { show('how'); });
  $('btnHowPlay').addEventListener('click', play);
  $('btnHowBack').addEventListener('click', function () { show('menu'); });
  $('btnBoard').addEventListener('click', function () { boardReturn = 'menu'; openBoard(); });
  $('btnBoardPlay').addEventListener('click', play);
  $('btnBoardRefresh').addEventListener('click', loadBoard);
  $('btnBoardBack').addEventListener('click', function () { highlight = null; show(boardReturn); });
  $('btnAgain').addEventListener('click', function () { Game.quit(); play(); });
  $('btnOverBoard').addEventListener('click', function () { boardReturn = 'over'; openBoard(); });
  $('btnOverMenu').addEventListener('click', function () { Game.quit(); show('menu'); });

  window.addEventListener('keydown', function (e) {
    const typing = e.target && e.target.tagName === 'INPUT';
    if (e.code === 'KeyM' && !typing) {
      toggleSound();
    } else if ((e.code === 'Escape' || e.code === 'KeyP') && !typing) {
      const m = Game.getMode();
      if (m === 'play') pause();
      else if (m === 'pause') resume();
      else if (current === 'how' || current === 'board') {
        $(current === 'how' ? 'btnHowBack' : 'btnBoardBack').click();
      }
    } else if (e.code === 'Enter' && !typing && current === 'menu') {
      play();
    }
  });

  /* ---------- Handbook Legend Icons ---------- */
  function drawLegendIcons() {
    const TAU = Math.PI * 2;
    function ctxOf(id) {
      const el = $(id);
      if (!el) return null;
      const c = el.getContext('2d');
      c.clearRect(0, 0, 48, 48);
      c.save();
      c.translate(24, 24);
      return c;
    }

    // Common Sand Dollar
    let c = ctxOf('icoCommon');
    if (c) {
      c.fillStyle = '#f6f2e6';
      c.strokeStyle = '#d4cab4';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 0, 17, 0, TAU);
      c.fill();
      c.stroke();
      c.fillStyle = '#dfd6c2';
      for (let k = 0; k < 5; k++) {
        const a = (k * TAU) / 5 - Math.PI / 2;
        c.beginPath();
        c.arc(Math.cos(a) * 7, Math.sin(a) * 7, 2, 0, TAU);
        c.fill();
      }
      c.restore();
    }

    // Medium Sun-Bleached
    c = ctxOf('icoMedium');
    if (c) {
      c.fillStyle = '#fffdf4';
      c.strokeStyle = '#cbb994';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 0, 14, 0, TAU);
      c.fill();
      c.stroke();
      c.strokeStyle = '#c5af84';
      c.lineWidth = 1.6;
      for (let k = 0; k < 5; k++) {
        const a = (k * TAU) / 5 - Math.PI / 2;
        c.beginPath();
        c.ellipse(Math.cos(a) * 5.5, Math.sin(a) * 5.5, 4, 1.8, a, 0, TAU);
        c.stroke();
      }
      c.restore();
    }

    // Tiny Golden Pearl
    c = ctxOf('icoPearl');
    if (c) {
      c.fillStyle = 'rgba(20, 10, 2, 0.72)';
      c.beginPath();
      c.ellipse(2, 5, 10, 8, 0, 0, TAU);
      c.fill();
      const g = c.createRadialGradient(-3, -3, 1, 0, 0, 9);
      g.addColorStop(0, '#fff9c4');
      g.addColorStop(0.55, '#ffd028');
      g.addColorStop(1, '#c97800');
      c.fillStyle = g;
      c.strokeStyle = '#7a4400';
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(0, 0, 8.5, 0, TAU);
      c.fill();
      c.stroke();
      c.restore();
    }

    // Rare Sea Star
    c = ctxOf('icoStar');
    if (c) {
      c.fillStyle = 'rgba(25, 12, 3, 0.65)';
      c.beginPath();
      c.ellipse(1.5, 4, 13, 9, 0, 0, TAU);
      c.fill();

      // 5-pointed star
      c.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k * TAU) / 10 - Math.PI / 2;
        const rad = k % 2 === 0 ? 16 : 6.5;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (k === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      const sg = c.createRadialGradient(0, 0, 1, 0, 0, 16);
      sg.addColorStop(0, '#fff4b8');
      sg.addColorStop(0.45, '#ffd23f');
      sg.addColorStop(1, '#ff6b57');
      c.fillStyle = sg;
      c.fill();
      c.strokeStyle = '#c43d22';
      c.lineWidth = 1.6;
      c.stroke();

      // Center sparkle
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(0, 0, 2.5, 0, TAU);
      c.fill();
      c.restore();
    }

    // Crab
    c = ctxOf('icoCrab');
    if (c) {
      c.strokeStyle = '#c23a1d';
      c.lineWidth = 2.4;
      for (let s = -1; s <= 1; s += 2) {
        for (let j = -1; j <= 1; j++) {
          c.beginPath();
          c.moveTo(j * 4, s * 4);
          c.lineTo(j * 7, s * 13);
          c.stroke();
        }
      }
      c.fillStyle = '#e85232';
      c.beginPath();
      c.ellipse(0, 0, 12, 9, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#111';
      c.beginPath();
      c.arc(-5, -3, 2, 0, TAU);
      c.arc(-5, 3, 2, 0, TAU);
      c.fill();
      c.restore();
    }

    // Wave
    c = ctxOf('icoWave');
    if (c) {
      c.fillStyle = '#1fa7c9';
      c.beginPath();
      c.moveTo(-20, 18);
      c.lineTo(-20, 2);
      c.quadraticCurveTo(0, -14, 20, 2);
      c.lineTo(20, 18);
      c.closePath();
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 3.5;
      c.beginPath();
      c.moveTo(-20, 2);
      c.quadraticCurveTo(0, -14, 20, 2);
      c.stroke();
      c.restore();
    }

    // Seagull
    c = ctxOf('icoGull');
    if (c) {
      c.fillStyle = '#edf3f8';
      c.strokeStyle = '#6c7d91';
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(2, -2);
      c.quadraticCurveTo(8, -16, 18, -12);
      c.lineTo(6, 2);
      c.closePath();
      c.fill();
      c.stroke();
      c.beginPath();
      c.moveTo(2, 2);
      c.quadraticCurveTo(8, 16, 18, 12);
      c.lineTo(6, -2);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.ellipse(0, 0, 11, 5.5, 0, 0, TAU);
      c.fill();
      c.stroke();
      c.fillStyle = '#ffb703';
      c.beginPath();
      c.moveTo(-10, -2);
      c.lineTo(-18, 0);
      c.lineTo(-10, 2);
      c.closePath();
      c.fill();
      c.restore();
    }
  }
  drawLegendIcons();

  /* ---------- Dual-Mode Leaderboard (PHP API + Local Fallback) ---------- */
  const LOCAL_SCORES_KEY = 'bh_local_scores_v1';
  let serverAvailable = null; // null = untried, true = php ok, false = fallback local

  function getLocalScores() {
    try {
      const raw = localStorage.getItem(LOCAL_SCORES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalScores(list) {
    try {
      localStorage.setItem(LOCAL_SCORES_KEY, JSON.stringify(list));
    } catch (e) { }
  }

  function submitLocalScore(playerName, score, sandDollars, survivalTime) {
    let list = getLocalScores();
    const nameKey = playerName.toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    const existingIdx = list.findIndex(function (e) {
      return ((e.player_name || e.name || '').toLowerCase()) === nameKey;
    });

    let status = 'new';
    let record = {
      player_name: playerName,
      score: score,
      sand_dollars: sandDollars,
      survival_time: survivalTime,
      created_at: now
    };

    if (existingIdx >= 0) {
      const ex = list[existingIdx];
      if (score > ex.score || (score === ex.score && survivalTime > ex.survival_time)) {
        list[existingIdx] = record;
        status = 'improved';
      } else if (score === ex.score && sandDollars === ex.sand_dollars && survivalTime === ex.survival_time) {
        status = 'duplicate';
        record = ex;
      } else {
        status = 'not_improved';
        record = ex;
      }
    } else {
      list.push(record);
      status = 'new';
    }

    list.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.survival_time !== a.survival_time) return b.survival_time - a.survival_time;
      if (b.sand_dollars !== a.sand_dollars) return b.sand_dollars - a.sand_dollars;
      return (a.created_at || 0) - (b.created_at || 0);
    });

    if (list.length > 100) list = list.slice(0, 100);
    saveLocalScores(list);

    const rank = list.findIndex(function (e) {
      return ((e.player_name || e.name || '').toLowerCase()) === nameKey;
    }) + 1;

    return { ok: true, status: status, rank: rank || 1 };
  }

  function renderTableRows(bodyEl, entries, includeDate) {
    bodyEl.innerHTML = entries.map(function (e) {
      const pname = e.player_name || e.name || 'HAMSTER';
      const me = highlight && pname.toLowerCase() === highlight.toLowerCase();
      const cls = (me ? 'me ' : '') + (e.rank <= 3 ? 'top' + e.rank : '');
      const date = e.created_at ? new Date(e.created_at * 1000).toLocaleDateString() : '';
      return '<tr class="' + cls + '"><td>' + e.rank + '</td><td>' + esc(pname) + '</td><td>' +
        Number(e.score).toLocaleString() + '</td><td>' + Number(e.sand_dollars || 0) +
        '</td><td>' + fmtTime(e.survival_time) + '</td>' +
        (includeDate ? '<td class="hide-sm">' + esc(date) + '</td>' : '') + '</tr>';
    }).join('');
  }

  function fetchLeaderboardEntries(limit) {
    return fetch(CFG.API_LEADERBOARD + '?limit=' + limit + '&_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') === -1) throw new Error('Not JSON');
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || 'Bad response');
        serverAvailable = true;
        return { local: false, entries: d.entries || [] };
      })
      .catch(function () {
        serverAvailable = false;
        const list = getLocalScores().slice(0, limit).map(function (e, idx) {
          return Object.assign({ rank: idx + 1 }, e);
        });
        return { local: true, entries: list };
      });
  }

  function openBoard() {
    show('board');
    loadBoard();
  }

  function loadBoard() {
    const body = $('boardBody'), msg = $('boardMsg'), notice = $('boardModeNotice');
    msg.textContent = 'Loading…';
    body.innerHTML = '';
    if (notice) notice.textContent = '';

    fetchLeaderboardEntries(CFG.LEADERBOARD_SIZE).then(function (res) {
      if (notice) notice.textContent = res.local ? 'Local leaderboard active.' : '';
      if (!res.entries.length) {
        msg.textContent = res.local
          ? 'No local scores yet. Be the first beach hamster on the board!'
          : 'No scores yet. Be the first beach hamster on the board!';
        body.innerHTML = '';
        return;
      }
      msg.textContent = '';
      renderTableRows(body, res.entries, true);
    });
  }

  function loadGameOverBoard() {
    const body = $('overBoardBody'), msg = $('overBoardMsg'), notice = $('overBoardNotice');
    if (!body || !msg) return;
    msg.textContent = 'Loading top scores…';
    body.innerHTML = '';
    if (notice) notice.textContent = '';

    fetchLeaderboardEntries(CFG.GAMEOVER_BOARD_SIZE).then(function (res) {
      if (notice) notice.textContent = res.local ? 'Local leaderboard' : 'Global leaderboard';
      if (!res.entries.length) {
        msg.textContent = 'No scores posted yet — claim #1!';
        body.innerHTML = '';
        return;
      }
      msg.textContent = '';
      renderTableRows(body, res.entries, false);
    });
  }

  /* ---------- Game Over & Score Submission ---------- */
  function cleanName(s) {
    return s.replace(/[^A-Za-z0-9 _.\-!?]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  }

  Game.onGameOver = function (r) {
    lastResult = r;
    submitted = false;
    $('goScore').textContent = r.score.toLocaleString();
    $('goShells').textContent = r.sand_dollars;
    $('goTime').textContent = fmtTime(r.survival_time);
    $('goBreakdown').textContent =
      'Common ' + r.tiers.common + ' · Sun-Bleached ' + r.tiers.medium + ' · Golden Pearl ' + r.tiers.pearl +
      (r.tiers.star ? ' · Sea Star ' + r.tiers.star : '');
    $('newHigh').classList.toggle('show', !!r.newHigh);

    const msg = $('submitMsg');
    msg.textContent = '';
    msg.className = 'submit-msg';
    $('btnSubmit').disabled = false;
    $('btnSubmit').textContent = 'SUBMIT';
    $('nameInput').value = cleanName(lsGet('bh_name') || '');
    $('nameInput').disabled = false;

    show('over');
    loadGameOverBoard();

    if (!window.matchMedia('(pointer: coarse)').matches) {
      setTimeout(function () {
        if (current === 'over') $('nameInput').focus();
      }, 400);
    }
  };

  $('nameInput').addEventListener('input', function () {
    const pos = this.selectionStart;
    const v = this.value.replace(/[^A-Za-z0-9 _.\-!?]/g, '');
    if (v !== this.value) {
      this.value = v;
      this.setSelectionRange(Math.max(0, pos - 1), Math.max(0, pos - 1));
    }
  });

  function completeSubmissionSuccess(d, name) {
    const msg = $('submitMsg'), btn = $('btnSubmit');
    highlight = name;
    const txt = {
      new: 'Score posted! You are ranked #' + d.rank + '.',
      improved: 'New personal record for ' + name + '! Ranked #' + d.rank + '.',
      not_improved: 'Higher score already on file for ' + name + ' (rank #' + d.rank + ').',
      duplicate: 'This exact score is already on file (rank #' + d.rank + ').'
    }[d.status] || 'Score posted! Rank #' + d.rank + '.';

    msg.className = 'submit-msg ok';
    msg.textContent = (serverAvailable === false ? '[Local Mode] ' : '') + txt;
    submitted = true;
    btn.textContent = 'SUBMITTED';
    $('nameInput').disabled = true;

    loadGameOverBoard();
  }

  $('submitForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!lastResult || submitted) return;
    const msg = $('submitMsg'), name = cleanName($('nameInput').value);
    if (!name) {
      msg.className = 'submit-msg err';
      msg.textContent = 'Enter a name (1-12 characters: letters, numbers, spaces).';
      return;
    }

    lsSet('bh_name', name);
    const btn = $('btnSubmit');
    btn.disabled = true;
    btn.textContent = '…';
    msg.className = 'submit-msg';
    msg.textContent = 'Saving score…';

    if (serverAvailable === false) {
      const res = submitLocalScore(name, lastResult.score, lastResult.sand_dollars, lastResult.survival_time);
      completeSubmissionSuccess(res, name);
      return;
    }

    fetch(CFG.API_SUBMIT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        player_name: name,
        score: lastResult.score,
        sand_dollars: lastResult.sand_dollars,
        survival_time: lastResult.survival_time
      })
    })
      .then(function (r) {
        const ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') === -1) {
          throw new Error('NO_API');
        }
        return r.json().then(function (d) {
          return { status: r.status, ok: r.ok, data: d };
        });
      })
      .then(function (res) {
        serverAvailable = true;
        if (!res.ok || !res.data || !res.data.ok) {
          msg.className = 'submit-msg err';
          msg.textContent = (res.data && res.data.error) || 'Could not submit score.';
          btn.disabled = false;
          btn.textContent = 'SUBMIT';
          return;
        }
        completeSubmissionSuccess(res.data, name);
      })
      .catch(function (err) {
        if (err && err.message !== 'NO_API') {
          // Network or static server fallback
        }
        serverAvailable = false;
        const localRes = submitLocalScore(name, lastResult.score, lastResult.sand_dollars, lastResult.survival_time);
        completeSubmissionSuccess(localRes, name);
      });
  });

  show('menu');
})();
