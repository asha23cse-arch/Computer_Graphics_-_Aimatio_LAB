/* ==========================================================
   চাষি ভাইয়ের অভিযান — A side-scrolling platformer
   Hero: a Bangladeshi farmer (lungi, jama/panjabi, gamcha on head)
   Plain JavaScript + Canvas. No libraries.
   ========================================================== */
(() => {
  'use strict';

  // ---------- Setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 960
  const H = canvas.height;  // 540

  const T = 36;             // tile size
  const ROWS = 15;
  const COLS = 170;
  const GROUND_ROW = 13;
  const FLAG_COL = 162;

  const GRAVITY = 0.55;
  const MAX_FALL = 13;
  const WALK = 3.2;
  const RUN = 4.8;
  const JUMP_V = -11.6;

  // Tile types
  const EMPTY = 0, GRASS = 1, SOIL = 2, BRICK = 3, QBLOCK = 4, USED = 5;

  // HUD / overlay elements
  const elScore = document.getElementById('score');
  const elCoins = document.getElementById('coins');
  const elLives = document.getElementById('lives');
  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ovTitle');
  const ovText = document.getElementById('ovText');
  const ovBtn = document.getElementById('ovBtn');

  // ---------- Input ----------
  const keys = { left: false, right: false, jump: false, run: false };
  const keyMap = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
    ShiftLeft: 'run', ShiftRight: 'run'
  };

  window.addEventListener('keydown', (e) => {
    const k = keyMap[e.code];
    if (k) { keys[k] = true; e.preventDefault(); }
    if ((e.code === 'Enter' || e.code === 'Space') && state !== 'play' && state !== 'dying') {
      startGame();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.code];
    if (k) { keys[k] = false; e.preventDefault(); }
  });
  window.addEventListener('blur', () => {
    keys.left = keys.right = keys.jump = keys.run = false;
  });

  // On-screen touch buttons
  document.querySelectorAll('.touch button').forEach((btn) => {
    const k = btn.dataset.key;
    const on = (e) => { keys[k] = true; e.preventDefault(); };
    const off = (e) => { keys[k] = false; e.preventDefault(); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
  });

  ovBtn.addEventListener('click', startGame);

  // ---------- Sound (tiny WebAudio beeps) ----------
  let audioCtx = null;
  function beep(type) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const presets = {
        jump:  { f: [320, 620], d: 0.14, w: 'square' },
        coin:  { f: [880, 1320], d: 0.12, w: 'triangle' },
        stomp: { f: [260, 120], d: 0.12, w: 'square' },
        bump:  { f: [140, 100], d: 0.08, w: 'square' },
        die:   { f: [400, 90], d: 0.6, w: 'sawtooth' },
        win:   { f: [520, 1040], d: 0.5, w: 'triangle' }
      };
      const p = presets[type];
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = p.w;
      o.frequency.setValueAtTime(p.f[0], audioCtx.currentTime);
      o.frequency.exponentialRampToValueAtTime(p.f[1], audioCtx.currentTime + p.d);
      g.gain.setValueAtTime(0.06, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + p.d);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + p.d);
    } catch (_) { /* audio is optional */ }
  }

  // ---------- Game state ----------
  let state = 'start';   // start | play | dying | over | win
  let grid, coins, enemies, effects;
  let score, coinCount, lives, checkpointX, camX, frame = 0;

  const player = {
    x: 0, y: 0, w: 26, h: 44, vx: 0, vy: 0,
    face: 1, onGround: false, jumpHeld: false, invul: 0, prevY: 0
  };

  // ---------- Level ----------
  const GAPS = [[22, 24], [46, 48], [70, 72], [95, 97], [121, 123], [140, 142]];

  function buildLevel() {
    grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
    coins = [];
    enemies = [];
    effects = [];

    // Ground with pits
    for (let c = 0; c < COLS; c++) {
      if (GAPS.some((g) => c >= g[0] && c <= g[1])) continue;
      grid[GROUND_ROW][c] = GRASS;
      grid[GROUND_ROW + 1][c] = SOIL;
    }

    // Blocks: B = brick, ? = question block (gives dhan), - = empty
    const blocks = (c, r, s) =>
      [...s].forEach((ch, i) => {
        if (ch === 'B') grid[r][c + i] = BRICK;
        else if (ch === '?') grid[r][c + i] = QBLOCK;
      });

    blocks(10, 9, 'B?B?B');
    blocks(28, 9, '?');
    blocks(30, 10, 'BBB');
    blocks(36, 8, 'B?B');
    blocks(52, 9, 'BB?BB');
    blocks(60, 7, '?B?');
    blocks(78, 9, 'B?B');
    blocks(84, 10, 'BBBB');
    blocks(90, 8, '?B?B?');
    blocks(100, 9, 'B?B?B');
    blocks(108, 10, 'BBB');
    blocks(114, 8, '?');
    blocks(128, 9, 'B?B');
    blocks(134, 9, '?B?');

    // Stairs before the flag
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k <= i; k++) grid[GROUND_ROW - 1 - k][150 + i] = BRICK;
    }

    // Dhan (paddy coins)
    const coinRow = (c, r, n) => {
      for (let i = 0; i < n; i++) coins.push({ x: (c + i) * T + T / 2, y: r * T + T / 2, got: false });
    };
    coinRow(5, 11, 4);
    coinRow(21, 10, 5);
    coinRow(31, 8, 3);
    coinRow(45, 10, 5);
    coinRow(55, 7, 3);
    coinRow(69, 10, 5);
    coinRow(85, 8, 4);
    coinRow(94, 10, 5);
    coinRow(110, 8, 3);
    coinRow(120, 10, 5);
    coinRow(139, 10, 5);
    coinRow(146, 11, 3);

    // Enemies: pests (poka)
    [16, 26, 33, 40, 52, 58, 64, 76, 82, 88, 100, 106, 112, 126, 132, 136, 146]
      .forEach((c) => {
        enemies.push({
          x: c * T + 4, y: GROUND_ROW * T - 26, w: 30, h: 26,
          vx: -0.9, vy: 0, onGround: false, alive: true, squash: 0
        });
      });
  }

  function resetPlayer(x) {
    player.x = x;
    player.y = GROUND_ROW * T - player.h - 1;
    player.vx = player.vy = 0;
    player.face = 1;
    player.onGround = false;
    player.jumpHeld = true; // must release jump first
    player.invul = 0;
  }

  function startGame() {
    buildLevel();
    score = 0; coinCount = 0; lives = 3;
    checkpointX = 3 * T;
    camX = 0;
    resetPlayer(checkpointX);
    state = 'play';
    overlay.classList.add('hidden');
    updateHud();
  }

  function updateHud() {
    elScore.textContent = score;
    elCoins.textContent = coinCount;
    elLives.textContent = Math.max(lives, 0);
  }

  function showOverlay(title, text, btn) {
    ovTitle.textContent = title;
    ovText.textContent = text;
    ovBtn.textContent = btn;
    overlay.classList.remove('hidden');
  }

  // ---------- Physics ----------
  function solidAt(c, r) {
    if (c < 0 || c >= COLS) return true;
    if (r < 0 || r >= ROWS) return false;
    return grid[r][c] > EMPTY;
  }

  // Moves an entity and resolves tile collisions (X first, then Y).
  // Returns true if it hit a wall horizontally.
  function moveEntity(e, onHeadHit) {
    let hitX = false;

    e.x += e.vx;
    if (e.vx !== 0) {
      const left = Math.floor(e.x / T);
      const right = Math.floor((e.x + e.w - 1) / T);
      const top = Math.floor(e.y / T);
      const bot = Math.floor((e.y + e.h - 1) / T);
      for (let r = top; r <= bot; r++) {
        if (e.vx > 0 && solidAt(right, r)) { e.x = right * T - e.w; hitX = true; break; }
        if (e.vx < 0 && solidAt(left, r)) { e.x = (left + 1) * T; hitX = true; break; }
      }
    }

    e.y += e.vy;
    e.onGround = false;
    const left = Math.floor(e.x / T);
    const right = Math.floor((e.x + e.w - 1) / T);
    if (e.vy > 0) {
      const bot = Math.floor((e.y + e.h - 1) / T);
      for (let c = left; c <= right; c++) {
        if (solidAt(c, bot)) { e.y = bot * T - e.h; e.vy = 0; e.onGround = true; break; }
      }
    } else if (e.vy < 0) {
      const top = Math.floor(e.y / T);
      // prefer the column closest to the entity centre
      const centre = (e.x + e.w / 2) / T;
      let best = -1;
      for (let c = left; c <= right; c++) {
        if (solidAt(c, top) && (best < 0 || Math.abs(c + 0.5 - centre) < Math.abs(best + 0.5 - centre))) best = c;
      }
      if (best >= 0) {
        e.y = (top + 1) * T; e.vy = 0;
        if (onHeadHit) onHeadHit(best, top);
      }
    }
    return hitX;
  }

  function hitBlockFromBelow(c, r) {
    if (grid[r][c] === QBLOCK) {
      grid[r][c] = USED;
      coinCount++; score += 100;
      effects.push({ kind: 'coin', x: c * T + T / 2, y: r * T, vy: -7, life: 28 });
      effects.push({ kind: 'text', text: '+100', x: c * T + T / 2, y: r * T - 10, vy: -1, life: 40 });
      beep('coin');
      updateHud();
    } else {
      beep('bump');
    }
  }

  // ---------- Update ----------
  function die() {
    if (state !== 'play') return;
    state = 'dying';
    lives--;
    player.vx = 0;
    player.vy = -10;
    beep('die');
    updateHud();
  }

  function afterDeath() {
    if (lives <= 0) {
      state = 'over';
      showOverlay('খেলা শেষ!', 'স্কোর: ' + score + ' — আবার চেষ্টা করবে?', 'আবার খেলো');
    } else {
      resetPlayer(checkpointX);
      player.invul = 120;
      state = 'play';
    }
  }

  function update() {
    frame++;
    updateEffects();

    if (state === 'dying') {
      player.vy += GRAVITY;
      player.y += player.vy;
      if (player.y > H + 150) afterDeath();
      return;
    }
    if (state !== 'play') return;

    const p = player;

    // Horizontal movement (smooth acceleration)
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const speed = keys.run ? RUN : WALK;
    p.vx += (dir * speed - p.vx) * 0.25;
    if (!dir && Math.abs(p.vx) < 0.05) p.vx = 0;
    if (dir) p.face = dir;

    // Jump (variable height: release early = short hop)
    if (keys.jump && !p.jumpHeld && p.onGround) {
      p.vy = JUMP_V;
      p.onGround = false;
      beep('jump');
    }
    p.jumpHeld = keys.jump;
    if (!keys.jump && p.vy < -4) p.vy = -4;

    p.vy = Math.min(p.vy + GRAVITY, MAX_FALL);
    p.prevY = p.y;
    moveEntity(p, hitBlockFromBelow);

    // Keep inside the visible area on the left
    if (p.x < camX) { p.x = camX; p.vx = Math.max(p.vx, 0); }
    if (p.invul > 0) p.invul--;

    // Checkpoints
    if (p.x > 105 * T) checkpointX = 105 * T;
    else if (p.x > 55 * T) checkpointX = Math.max(checkpointX, 55 * T);

    // Fell into a pit
    if (p.y > H + 40) { die(); return; }

    // Dhan coins
    for (const c of coins) {
      if (c.got) continue;
      if (Math.abs(c.x - (p.x + p.w / 2)) < 22 && Math.abs(c.y - (p.y + p.h / 2)) < 30) {
        c.got = true;
        coinCount++; score += 50;
        effects.push({ kind: 'text', text: '+50', x: c.x, y: c.y - 10, vy: -1, life: 30 });
        beep('coin');
        updateHud();
      }
    }

    // Enemies
    for (const e of enemies) {
      if (!e.alive) { if (e.squash > 0) e.squash--; continue; }
      if (Math.abs(e.x - p.x) > W + 100) continue; // only active near the screen

      e.vy = Math.min(e.vy + GRAVITY, MAX_FALL);
      const hitWall = moveEntity(e);
      if (hitWall) e.vx = -e.vx;
      if (e.onGround) {
        const aheadCol = Math.floor((e.vx > 0 ? e.x + e.w + 2 : e.x - 2) / T);
        const belowRow = Math.floor((e.y + e.h + 2) / T);
        if (!solidAt(aheadCol, belowRow)) e.vx = -e.vx;
      }
      if (e.y > H + 100) { e.alive = false; e.squash = 0; continue; }

      // Player vs enemy
      const overlap =
        p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y;
      if (!overlap) continue;

      if (p.vy > 0 && p.prevY + p.h <= e.y + 12) {
        e.alive = false; e.squash = 25;
        p.vy = keys.jump ? -10 : -7;
        score += 200;
        effects.push({ kind: 'text', text: '+200', x: e.x + e.w / 2, y: e.y - 6, vy: -1, life: 40 });
        beep('stomp');
        updateHud();
      } else if (p.invul === 0) {
        die();
        return;
      }
    }

    // Reached the flag!
    if (p.x + p.w > FLAG_COL * T + 8) {
      state = 'win';
      score += lives * 500;
      updateHud();
      beep('win');
      showOverlay('জয় বাংলা! 🇧🇩', 'তুমি পতাকার কাছে পৌঁছে গেছো! স্কোর: ' + score + ' | ধান: ' + coinCount, 'আবার খেলো');
    }

    // Camera
    const target = p.x + p.w / 2 - W * 0.4;
    camX += (Math.max(0, Math.min(COLS * T - W, target)) - camX) * 0.15;
  }

  function updateEffects() {
    for (const f of effects) {
      f.life--;
      if (f.kind === 'coin') { f.vy += 0.5; f.y += f.vy; }
      else f.y += f.vy;
    }
    effects = effects.filter((f) => f.life > 0);
  }

  // ---------- Drawing: background ----------
  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.85);
    sky.addColorStop(0, '#4fb3e8');
    sky.addColorStop(1, '#dff6ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Sun
    const sunG = ctx.createRadialGradient(W - 140, 90, 10, W - 140, 90, 90);
    sunG.addColorStop(0, 'rgba(255,230,120,1)');
    sunG.addColorStop(0.45, 'rgba(255,210,63,.9)');
    sunG.addColorStop(1, 'rgba(255,210,63,0)');
    ctx.fillStyle = sunG;
    ctx.beginPath(); ctx.arc(W - 140, 90, 90, 0, Math.PI * 2); ctx.fill();

    // Clouds (slow parallax)
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    const cp = 420;
    for (let i = -1; i < W / cp + 2; i++) {
      const ox = i * cp - ((camX * 0.15) % cp);
      cloud(ox + 80, 80, 1);
      cloud(ox + 290, 130, 0.7);
    }

    // Far green hills
    ctx.fillStyle = '#8bc48a';
    ctx.beginPath(); ctx.moveTo(0, 470);
    for (let x = 0; x <= W; x += 20) {
      const wx = x + camX * 0.3;
      ctx.lineTo(x, 400 + Math.sin(wx * 0.006) * 24 + Math.sin(wx * 0.017) * 10);
    }
    ctx.lineTo(W, 470); ctx.closePath(); ctx.fill();

    // Village: huts and palm/coconut trees (mid parallax)
    const hp = 560;
    for (let i = -1; i < W / hp + 2; i++) {
      const ox = i * hp - ((camX * 0.5) % hp);
      hut(ox + 120, GROUND_ROW * T);
      palm(ox + 300, GROUND_ROW * T, 1);
      palm(ox + 350, GROUND_ROW * T, 0.8);
      hut(ox + 470, GROUND_ROW * T);
    }

    // Paddy field strip behind the ground
    const fp = 48;
    for (let i = -1; i < W / fp + 2; i++) {
      const ox = i * fp - ((camX * 0.8) % fp);
      ctx.fillStyle = i % 2 ? '#7cc24a' : '#8fd45a';
      ctx.fillRect(ox, GROUND_ROW * T - 14, fp, 14);
      ctx.fillStyle = '#5da33a';
      for (let k = 0; k < 4; k++) ctx.fillRect(ox + 6 + k * 11, GROUND_ROW * T - 20, 2, 8);
    }
  }

  function cloud(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, 7);
    ctx.arc(x + 26 * s, y - 10 * s, 28 * s, 0, 7);
    ctx.arc(x + 56 * s, y, 22 * s, 0, 7);
    ctx.rect(x, y, 56 * s, 22 * s);
    ctx.fill();
  }

  function hut(x, groundY) {
    ctx.fillStyle = '#c9a66b';            // mud walls
    ctx.fillRect(x, groundY - 46, 82, 46);
    ctx.fillStyle = '#7a5c2e';            // door
    ctx.fillRect(x + 32, groundY - 30, 18, 30);
    ctx.fillStyle = '#9b7a35';            // thatched roof
    ctx.beginPath();
    ctx.moveTo(x - 12, groundY - 44);
    ctx.lineTo(x + 41, groundY - 86);
    ctx.lineTo(x + 94, groundY - 44);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#6e5424'; ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 41, groundY - 86);
      ctx.lineTo(x - 12 + i * 26, groundY - 44);
      ctx.stroke();
    }
  }

  function palm(x, groundY, s) {
    ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 9 * s; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.quadraticCurveTo(x + 14 * s, groundY - 70 * s, x + 4 * s, groundY - 130 * s);
    ctx.stroke();
    ctx.strokeStyle = '#2f8f46'; ctx.lineWidth = 6 * s;
    const tx = x + 4 * s, ty = groundY - 130 * s;
    for (let a = -2; a <= 2; a++) {
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + a * 22 * s, ty - 30 * s, tx + a * 36 * s, ty + 12 * s);
      ctx.stroke();
    }
    ctx.fillStyle = '#5b3a1e';            // coconuts
    ctx.beginPath(); ctx.arc(tx - 4 * s, ty + 6 * s, 5 * s, 0, 7); ctx.arc(tx + 6 * s, ty + 8 * s, 5 * s, 0, 7); ctx.fill();
    ctx.lineCap = 'butt';
  }

  // ---------- Drawing: tiles ----------
  function drawTiles() {
    const c0 = Math.max(0, Math.floor(camX / T));
    const c1 = Math.min(COLS - 1, Math.floor((camX + W) / T));
    for (let r = 0; r < ROWS; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = grid[r][c];
        if (t === EMPTY) continue;
        const x = Math.round(c * T - camX), y = r * T;
        switch (t) {
          case GRASS:
            ctx.fillStyle = '#8d5a2b'; ctx.fillRect(x, y, T, T);
            ctx.fillStyle = '#4caf50'; ctx.fillRect(x, y, T, 9);
            ctx.fillStyle = '#6cc66a';
            for (let k = 0; k < 4; k++) ctx.fillRect(x + 3 + k * 9, y + 9, 3, 4);
            break;
          case SOIL:
            ctx.fillStyle = '#76481f'; ctx.fillRect(x, y, T, T);
            ctx.fillStyle = '#8d5a2b';
            ctx.fillRect(x + 5, y + 7, 8, 5); ctx.fillRect(x + 20, y + 21, 9, 5);
            break;
          case BRICK:
            ctx.fillStyle = '#c8553d'; ctx.fillRect(x, y, T, T);
            ctx.strokeStyle = '#7a2e1f'; ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
            ctx.beginPath();
            ctx.moveTo(x, y + T / 2); ctx.lineTo(x + T, y + T / 2);
            ctx.moveTo(x + T / 2, y); ctx.lineTo(x + T / 2, y + T / 2);
            ctx.moveTo(x + T / 4, y + T / 2); ctx.lineTo(x + T / 4, y + T);
            ctx.moveTo(x + 3 * T / 4, y + T / 2); ctx.lineTo(x + 3 * T / 4, y + T);
            ctx.stroke();
            break;
          case QBLOCK: {
            ctx.fillStyle = '#f2b632'; ctx.fillRect(x, y, T, T);
            ctx.strokeStyle = '#a8741a'; ctx.lineWidth = 3;
            ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
            const bob = Math.sin(frame * 0.1) * 1.5;
            ctx.fillStyle = '#fff3c4';
            ctx.font = 'bold 24px "Hind Siliguri", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('?', x + T / 2, y + 26 + bob);
            break;
          }
          case USED:
            ctx.fillStyle = '#a08a63'; ctx.fillRect(x, y, T, T);
            ctx.strokeStyle = '#6e5d3f'; ctx.lineWidth = 3;
            ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
            break;
        }
      }
    }
  }

  // ---------- Drawing: flag (Bangladesh flag) ----------
  function drawFlag() {
    const x = FLAG_COL * T - camX + 14;
    if (x < -120 || x > W + 50) return;
    const top = 4 * T, bottom = GROUND_ROW * T;
    ctx.fillStyle = '#d9d9d9';
    ctx.fillRect(x, top, 6, bottom - top);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(x + 3, top, 7, 0, 7); ctx.fill();
    // flag with a gentle wave
    const fw = 90, fh = 54, fy = top + 8;
    ctx.fillStyle = '#006a4e';
    ctx.beginPath();
    ctx.moveTo(x + 6, fy);
    for (let i = 0; i <= fw; i += 6) ctx.lineTo(x + 6 + i, fy + Math.sin(frame * 0.12 + i * 0.08) * 3);
    for (let i = fw; i >= 0; i -= 6) ctx.lineTo(x + 6 + i, fy + fh + Math.sin(frame * 0.12 + i * 0.08) * 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f42a41';
    ctx.beginPath();
    ctx.arc(x + 6 + fw * 0.45, fy + fh / 2 + Math.sin(frame * 0.12 + fw * 0.036) * 3, fh * 0.3, 0, 7);
    ctx.fill();
  }

  // ---------- Drawing: dhan coins ----------
  function drawCoins() {
    for (const c of coins) {
      if (c.got) continue;
      const x = c.x - camX;
      if (x < -20 || x > W + 20) continue;
      const sx = Math.abs(Math.cos(frame * 0.08 + c.x * 0.02));
      ctx.fillStyle = '#e8a317';
      ctx.beginPath(); ctx.ellipse(x, c.y, 9 * sx + 1.5, 11, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.ellipse(x, c.y, 6 * sx + 1, 8, 0, 0, 7); ctx.fill();
    }
  }

  // ---------- Drawing: pest (poka) ----------
  function drawEnemy(e) {
    const x = e.x - camX;
    if (x < -50 || x > W + 50) return;
    if (!e.alive) {
      if (e.squash > 0) {
        ctx.fillStyle = '#5a3418';
        ctx.beginPath(); ctx.ellipse(x + e.w / 2, e.y + e.h - 3, 17, 4, 0, 0, 7); ctx.fill();
      }
      return;
    }
    const cx = x + e.w / 2, cy = e.y + e.h / 2;
    const step = Math.sin(frame * 0.3) * 3;
    ctx.strokeStyle = '#2b1a0c'; ctx.lineWidth = 2.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(cx + i * 8, cy + 4); ctx.lineTo(cx + i * 12 + step * i, cy + 13); ctx.stroke();
    }
    ctx.fillStyle = '#7b3f12';                    // shell
    ctx.beginPath(); ctx.ellipse(cx, cy + 2, 15, 12, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#9a5520';
    ctx.beginPath(); ctx.ellipse(cx - 3, cy - 2, 7, 5, -0.4, 0, 7); ctx.fill();
    ctx.strokeStyle = '#4b2508'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 13); ctx.stroke();
    const d = e.vx > 0 ? 1 : -1;                  // eyes face walking direction
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx + d * 8, cy - 4, 4, 0, 7); ctx.arc(cx + d * 2, cy - 6, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(cx + d * 9, cy - 4, 1.8, 0, 7); ctx.arc(cx + d * 3, cy - 6, 1.8, 0, 7); ctx.fill();
    ctx.strokeStyle = '#2b1a0c'; ctx.lineWidth = 1.5; // angry brows
    ctx.beginPath();
    ctx.moveTo(cx + d * 5, cy - 11); ctx.lineTo(cx + d * 12, cy - 7);
    ctx.stroke();
  }

  // ---------- Drawing: the farmer ----------
  // Lungi (checked wrap), jama (panjabi shirt) and a gamcha tied on the head.
  function drawFarmer(p) {
    if (p.invul > 0 && state === 'play' && Math.floor(frame / 4) % 2) return; // blink
    const sx = Math.round(p.x - camX + p.w / 2);
    const sy = Math.round(p.y);
    const moving = Math.abs(p.vx) > 0.4 && p.onGround;
    const air = !p.onGround;
    const ph = moving ? Math.sin(frame * 0.3 * Math.max(0.8, Math.abs(p.vx) / 3.2)) : 0;
    const skin = '#b9773a';

    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(p.face, 1);

    // Legs + bare feet
    ctx.fillStyle = skin;
    if (air) {
      ctx.fillRect(-9, 38, 5, 6); ctx.fillRect(4, 36, 5, 6);
    } else {
      ctx.fillRect(-8 + ph * 4, 38, 5, 6);
      ctx.fillRect(3 - ph * 4, 38, 5, 6);
    }
    ctx.fillStyle = '#5b3516';
    if (air) { ctx.fillRect(-10, 43, 8, 2); ctx.fillRect(4, 41, 8, 2); }
    else { ctx.fillRect(-9 + ph * 4, 43, 8, 2); ctx.fillRect(3 - ph * 4, 43, 8, 2); }

    // Lungi: green checked cloth wrapped around the waist
    const sway = moving ? ph * 2 : 0;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-10, 30); ctx.lineTo(10, 30);
    ctx.lineTo(12 + sway, 41); ctx.lineTo(-12 + sway, 41);
    ctx.closePath();
    ctx.fillStyle = '#1b7f5c'; ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
    for (let i = -12; i <= 12; i += 6) { ctx.beginPath(); ctx.moveTo(i, 28); ctx.lineTo(i, 42); ctx.stroke(); }
    for (let j = 30; j <= 42; j += 5) { ctx.beginPath(); ctx.moveTo(-14, j); ctx.lineTo(14, j); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(8,60,40,.6)';
    for (let i = -9; i <= 12; i += 6) { ctx.beginPath(); ctx.moveTo(i, 28); ctx.lineTo(i, 42); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#d6a22b';                         // lungi knot / waist fold
    ctx.fillRect(-10, 29, 20, 3);

    // Jama (panjabi): off-white long shirt
    ctx.fillStyle = '#f8f4e3';
    ctx.strokeStyle = '#bdb594'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-9, 19); ctx.lineTo(9, 19); ctx.lineTo(10, 33); ctx.lineTo(-10, 33);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 19); ctx.lineTo(0, 27); ctx.stroke();   // placket
    ctx.fillStyle = '#8c8566';
    ctx.fillRect(-1, 21, 2, 2); ctx.fillRect(-1, 25, 2, 2);               // buttons

    // Arms (sleeves + hands)
    const armA = air ? -2.2 : ph * 0.9;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * 9, 21);
      ctx.rotate(s * armA * (s === 1 ? 1 : -1) + (s === 1 ? 0.15 : -0.15));
      ctx.fillStyle = '#f8f4e3';
      ctx.fillRect(-2.5, 0, 5, 10);
      ctx.strokeRect(-2.5, 0, 5, 10);
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(0, 12, 3, 0, 7); ctx.fill();
      ctx.restore();
    }

    // Head
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(0, 13, 8, 0, 7); ctx.fill();
    ctx.fillStyle = '#8f5a28';                          // ear
    ctx.beginPath(); ctx.arc(-7, 14, 2.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';                             // eye
    ctx.beginPath(); ctx.ellipse(4, 12, 2.4, 2.8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(4.8, 12, 1.3, 0, 7); ctx.fill();
    ctx.fillStyle = '#2a1608';                          // moustache
    ctx.fillRect(1, 16, 8, 2);
    ctx.fillStyle = '#7a3f1d';                          // smile
    ctx.fillRect(3, 19, 4, 1);

    // Gamcha: red-and-white checked towel tied on the head
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 11, 9.5, Math.PI, 0);
    ctx.lineTo(9.5, 11); ctx.lineTo(-9.5, 11);
    ctx.closePath();
    ctx.fillStyle = '#d62828'; ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.3;
    for (let i = -10; i <= 10; i += 4) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 12); ctx.stroke(); }
    for (let j = 2; j <= 11; j += 4) { ctx.beginPath(); ctx.moveTo(-10, j); ctx.lineTo(10, j); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#d62828';                          // knot tail flapping behind
    const flap = Math.sin(frame * 0.25) * (moving || air ? 3 : 1);
    ctx.beginPath();
    ctx.moveTo(-8, 7); ctx.lineTo(-16, 10 + flap); ctx.lineTo(-14, 15 + flap); ctx.lineTo(-7, 11);
    ctx.closePath(); ctx.fill();

    ctx.restore();
  }

  // ---------- Drawing: effects ----------
  function drawEffects() {
    ctx.textAlign = 'center';
    for (const f of effects) {
      const x = f.x - camX;
      if (f.kind === 'coin') {
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.ellipse(x, f.y, 7, 10, 0, 0, 7); ctx.fill();
      } else {
        ctx.font = 'bold 18px "Hind Siliguri", sans-serif';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#1b4332'; ctx.lineWidth = 3;
        ctx.strokeText(f.text, x, f.y); ctx.fillText(f.text, x, f.y);
      }
    }
  }

  // ---------- Render ----------
  function render() {
    ctx.clearRect(0, 0, W, H);
    if (!grid) { drawBackground(); return; }
    drawBackground();
    drawTiles();
    drawFlag();
    drawCoins();
    enemies.forEach(drawEnemy);
    drawFarmer(player);
    drawEffects();
  }

  // ---------- Main loop (fixed 60 updates / second) ----------
  let last = 0, acc = 0;
  const STEP = 1000 / 60;
  function loop(ts) {
    if (!last) last = ts;
    acc += Math.min(100, ts - last);
    last = ts;
    while (acc >= STEP) { update(); acc -= STEP; }
    render();
    requestAnimationFrame(loop);
  }

  // Show the title screen over a preview of level 1
  buildLevel();
  score = 0; coinCount = 0; lives = 3; camX = 0; checkpointX = 3 * T;
  resetPlayer(3 * T);
  updateHud();
  requestAnimationFrame(loop);
})();