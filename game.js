(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const waveEl = document.getElementById("wave");
  const livesEl = document.getElementById("lives");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("start-btn");

  const W = canvas.width;
  const H = canvas.height;

  const state = {
    running: false,
    score: 0,
    wave: 1,
    lives: 3,
    time: 0,
    fireHeld: false,
    aimX: W / 2,
    aimY: H * 0.35,
    lastShot: 0,
    spawnTimer: 0,
    shake: 0,
    bullets: [],
    missiles: [],
    particles: [],
    flashes: [],
    barrelSpin: 0,
  };

  const ship = {
    x: W / 2,
    deckY: H - 70,
    width: 280,
  };

  // Land-style Centurion C-RAM / LPWS mount on the deck
  const ciws = {
    x: W / 2,
    y: H - 88,
    angle: -Math.PI / 2,
    barrelLen: 52,
    fireRate: 14, // ~4300 rpm continuous stream
  };

  const MISSILE_HIT_R = 28;
  const MISSILE_SCALE = 1.75;

  function resetGame() {
    state.score = 0;
    state.wave = 1;
    state.lives = 3;
    state.time = 0;
    state.spawnTimer = 0;
    state.shake = 0;
    state.bullets = [];
    state.missiles = [];
    state.particles = [];
    state.flashes = [];
    state.lastShot = 0;
    state.barrelSpin = 0;
    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = String(state.score);
    waveEl.textContent = String(state.wave);
    livesEl.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const pip = document.createElement("span");
      pip.className = "pip" + (i >= state.lives ? " lost" : "");
      livesEl.appendChild(pip);
    }
  }

  function showOverlay(title, text, buttonLabel) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = text;
    startBtn.textContent = buttonLabel;
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function startGame() {
    resetGame();
    state.running = true;
    hideOverlay();
  }

  function gameOver() {
    state.running = false;
    showOverlay(
      "SHIP HIT — MISSION FAILED",
      `Missiles penetrated the inner defense zone.<br />Final score: <strong style="color:#e8a83a">${state.score}</strong> · Wave ${state.wave}`,
      "RE-ENGAGE"
    );
  }

  function pointerToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function setAim(x, y) {
    state.aimX = x;
    state.aimY = y;
    const dx = x - ciws.x;
    const dy = y - ciws.y;
    let angle = Math.atan2(dy, dx);
    const min = -Math.PI + 0.15;
    const max = -0.15;
    if (angle > 0) angle = angle > Math.PI / 2 ? min : max;
    state._targetAngle = Math.max(min, Math.min(max, angle));
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = pointerToCanvas(e.clientX, e.clientY);
    setAim(p.x, p.y);
    state.fireHeld = true;
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = pointerToCanvas(e.clientX, e.clientY);
    setAim(p.x, p.y);
  });

  canvas.addEventListener("pointerup", () => {
    state.fireHeld = false;
  });

  canvas.addEventListener("pointercancel", () => {
    state.fireHeld = false;
  });

  startBtn.addEventListener("click", startGame);

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (!state.running) startGame();
    }
  });

  function spawnMissile() {
    const sideBias = Math.random();
    const x =
      sideBias < 0.15
        ? Math.random() * 80
        : sideBias > 0.85
          ? W - Math.random() * 80
          : 40 + Math.random() * (W - 80);
    const speed = 1.15 + state.wave * 0.18 + Math.random() * 0.4;
    const targetX = ship.x + (Math.random() - 0.5) * ship.width * 0.7;
    const dx = targetX - x;
    const dy = ship.deckY - 20;
    const dist = Math.hypot(dx, dy) || 1;
    // Dense tracer stream: missiles need a short burst to kill
    const hp = 2 + Math.floor(state.wave / 4);
    state.missiles.push({
      x,
      y: -30 - Math.random() * 50,
      vx: (dx / dist) * speed * 0.35,
      vy: (dy / dist) * speed,
      angle: Math.atan2(dy, dx),
      hp,
      maxHp: hp,
      trail: [],
    });
  }

  function muzzlePos(angle) {
    // Pivot is slightly above pedestal; barrels extend along aim angle
    const pivotY = ciws.y - 4;
    const len = ciws.barrelLen + 18;
    return {
      x: ciws.x + Math.cos(angle) * len,
      y: pivotY + Math.sin(angle) * len,
    };
  }

  function fire() {
    const now = state.time;
    if (now - state.lastShot < ciws.fireRate) return;
    state.lastShot = now;
    state.barrelSpin += 0.55;

    const spread = (Math.random() - 0.5) * 0.045;
    const angle = ciws.angle + spread;
    const muzzle = muzzlePos(angle);
    const speed = 18;

    state.bullets.push({
      x: muzzle.x,
      y: muzzle.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      life: 42,
      trail: 14 + Math.random() * 6,
    });

    state.flashes.push({
      x: muzzle.x,
      y: muzzle.y,
      life: 5,
      angle,
    });

    // muzzle smoke puffs
    if (Math.random() < 0.45) {
      state.particles.push({
        x: muzzle.x + (Math.random() - 0.5) * 4,
        y: muzzle.y + (Math.random() - 0.5) * 4,
        vx: Math.cos(angle) * 0.4 + (Math.random() - 0.5) * 0.8,
        vy: Math.sin(angle) * 0.4 - 0.6 - Math.random() * 0.5,
        life: 22 + Math.random() * 18,
        color: "rgba(160,160,155,0.35)",
        size: 3 + Math.random() * 4,
        smoke: true,
      });
    }

    // brass casings eject downward/side
    if (Math.random() < 0.35) {
      const eject = angle + Math.PI / 2;
      state.particles.push({
        x: ciws.x + Math.cos(angle) * 10,
        y: ciws.y + Math.sin(angle) * 10 + 4,
        vx: Math.cos(eject) * (1.2 + Math.random()) + (Math.random() - 0.5),
        vy: 1.8 + Math.random() * 1.5,
        life: 28 + Math.random() * 12,
        color: "#c9a227",
        size: 1.6,
      });
    }
  }

  function explode(x, y, color, count = 18) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 4;
      state.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 20 + Math.random() * 25,
        color,
        size: 1.5 + Math.random() * 2.5,
      });
    }
  }

  function hitMissile(m, bi) {
    state.bullets.splice(bi, 1);
    m.hp -= 1;
    // spark on hit
    explode(m.x, m.y, "#ffe08a", 4);
    if (m.hp <= 0) {
      const idx = state.missiles.indexOf(m);
      if (idx >= 0) state.missiles.splice(idx, 1);
      state.score += 100 + state.wave * 10;
      explode(m.x, m.y, "#ff8a4a", 28);
      explode(m.x, m.y, "#ffe08a", 14);
      state.shake = Math.min(8, state.shake + 2);
      updateHud();
    }
  }

  function missileImpact(m) {
    const idx = state.missiles.indexOf(m);
    if (idx >= 0) state.missiles.splice(idx, 1);
    explode(m.x, m.y, "#ff5a3a", 36);
    explode(m.x, ship.deckY - 10, "#ffaa55", 20);
    state.shake = 14;
    state.lives -= 1;
    updateHud();
    if (state.lives <= 0) gameOver();
  }

  function update(dt) {
    state.time += dt;

    if (state._targetAngle == null) state._targetAngle = ciws.angle;
    let diff = state._targetAngle - ciws.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ciws.angle += diff * Math.min(1, 0.18);

    if (state.fireHeld) fire();
    else state.barrelSpin *= 0.92;

    const spawnInterval = Math.max(420, 1400 - state.wave * 90);
    state.spawnTimer += dt;
    if (state.spawnTimer >= spawnInterval) {
      state.spawnTimer = 0;
      const burst = 1 + Math.floor(state.wave / 3);
      for (let i = 0; i < burst; i++) {
        setTimeout(() => {
          if (state.running) spawnMissile();
        }, i * 180);
      }
    }

    const nextWaveAt = state.wave * 20000;
    if (state.time > nextWaveAt) {
      state.wave += 1;
      updateHud();
    }

    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      b.x += b.vx;
      b.y += b.vy;
      b.life -= 1;
      if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        state.bullets.splice(i, 1);
      }
    }

    for (let i = state.missiles.length - 1; i >= 0; i--) {
      const m = state.missiles[i];
      m.trail.push({ x: m.x, y: m.y });
      if (m.trail.length > 14) m.trail.shift();
      m.x += m.vx;
      m.y += m.vy;
      m.angle = Math.atan2(m.vy, m.vx);

      if (m.y >= ship.deckY - 8 && Math.abs(m.x - ship.x) < ship.width / 2 + 10) {
        missileImpact(m);
        continue;
      }
      if (m.y > H + 40) {
        state.missiles.splice(i, 1);
      }
    }

    const hitR2 = MISSILE_HIT_R * MISSILE_HIT_R;
    for (let bi = state.bullets.length - 1; bi >= 0; bi--) {
      const b = state.bullets[bi];
      for (let mi = 0; mi < state.missiles.length; mi++) {
        const m = state.missiles[mi];
        const dx = b.x - m.x;
        const dy = b.y - m.y;
        if (dx * dx + dy * dy < hitR2) {
          hitMissile(m, bi);
          break;
        }
      }
    }

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (!p.smoke) p.vy += 0.05;
      else {
        p.vx *= 0.98;
        p.size += 0.08;
      }
      p.life -= 1;
      if (p.life <= 0) state.particles.splice(i, 1);
    }

    for (let i = state.flashes.length - 1; i >= 0; i--) {
      state.flashes[i].life -= 1;
      if (state.flashes[i].life <= 0) state.flashes.splice(i, 1);
    }

    if (state.shake > 0) state.shake *= 0.88;
  }

  function drawSea() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a1824");
    g.addColorStop(0.5, "#0c2233");
    g.addColorStop(0.78, "#1a2a28");
    g.addColorStop(1, "#2a3224");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const haze = ctx.createLinearGradient(0, 0, 0, 140);
    haze.addColorStop(0, "rgba(120,160,190,0.12)");
    haze.addColorStop(1, "rgba(120,160,190,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, W, 140);

    ctx.fillStyle = "rgba(255,255,255,0.015)";
    for (let y = 0; y < H; y += 3) {
      ctx.fillRect(0, y, W, 1);
    }
  }

  function drawShip() {
    const y = ship.deckY;
    const x = ship.x;
    const half = ship.width / 2;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, H - 28, half + 30, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    const hull = ctx.createLinearGradient(0, y - 20, 0, H);
    hull.addColorStop(0, "#6d7f8f");
    hull.addColorStop(0.4, "#4a5a68");
    hull.addColorStop(1, "#2a3540");
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(x - half - 20, y + 10);
    ctx.lineTo(x - half + 30, y - 18);
    ctx.lineTo(x + half - 30, y - 18);
    ctx.lineTo(x + half + 20, y + 10);
    ctx.lineTo(x + half - 10, H - 18);
    ctx.lineTo(x - half + 10, H - 18);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#8a9aaa";
    ctx.fillRect(x - half + 40, y - 22, half * 2 - 80, 10);

    // Superstructure shifted left so C-RAM reads clearly center-deck
    ctx.fillStyle = "#9aabba";
    ctx.fillRect(x - 120, y - 55, 70, 35);
    ctx.fillStyle = "#7d8e9d";
    ctx.fillRect(x - 100, y - 72, 40, 20);
    ctx.fillStyle = "#c5d0da";
    ctx.fillRect(x - 92, y - 66, 24, 10);

    ctx.strokeStyle = "#b8c4ce";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 70, y - 72);
    ctx.lineTo(x - 70, y - 105);
    ctx.stroke();
    ctx.fillStyle = "#e8a83a";
    ctx.fillRect(x - 73, y - 108, 6, 4);
  }

  function drawCiws() {
    const { x, y, angle, barrelLen } = ciws;
    const tanMid = "#9a7348";

    // Tan armored pedestal (fixed, world space)
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, y + 28, 48, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#c4a76a";
    ctx.beginPath();
    ctx.moveTo(x - 42, y + 6);
    ctx.lineTo(x - 36, y + 32);
    ctx.lineTo(x + 36, y + 32);
    ctx.lineTo(x + 42, y + 6);
    ctx.lineTo(x + 28, y - 2);
    ctx.lineTo(x - 28, y - 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = tanMid;
    ctx.beginPath();
    ctx.moveTo(x - 42, y + 6);
    ctx.lineTo(x - 36, y + 32);
    ctx.lineTo(x - 20, y + 32);
    ctx.lineTo(x - 28, y + 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#a88858";
    ctx.fillRect(x - 30, y + 4, 60, 8);

    ctx.strokeStyle = "rgba(60,40,20,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 22, y + 14, 18, 12);
    ctx.strokeRect(x + 4, y + 14, 18, 12);

    ctx.fillStyle = "#e8c84a";
    ctx.fillRect(x - 14, y + 26, 28, 4);

    ctx.strokeStyle = "#8a6a42";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x - 40, y + 10 + i * 6);
      ctx.lineTo(x - 34, y + 10 + i * 6);
      ctx.stroke();
    }

    // Upper assembly: local +X = barrel aim direction
    ctx.save();
    ctx.translate(x, y - 4);
    ctx.rotate(angle);

    // Dark mount yoke
    ctx.fillStyle = "#3a4048";
    ctx.beginPath();
    ctx.moveTo(-8, -16);
    ctx.lineTo(16, -12);
    ctx.lineTo(20, 10);
    ctx.lineTo(-6, 14);
    ctx.lineTo(-14, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#2a3038";
    ctx.fillRect(-4, -10, 18, 16);

    // White radome behind the gun (negative X)
    ctx.fillStyle = "#eef2f6";
    ctx.beginPath();
    ctx.moveTo(-38, 14);
    ctx.lineTo(-38, -18);
    ctx.quadraticCurveTo(-26, -34, -14, -18);
    ctx.lineTo(-14, 14);
    ctx.closePath();
    ctx.fill();

    const domeShade = ctx.createLinearGradient(-38, 0, -14, 0);
    domeShade.addColorStop(0, "rgba(160,170,180,0.5)");
    domeShade.addColorStop(0.45, "rgba(255,255,255,0.15)");
    domeShade.addColorStop(1, "rgba(130,140,150,0.4)");
    ctx.fillStyle = domeShade;
    ctx.beginPath();
    ctx.moveTo(-38, 14);
    ctx.lineTo(-38, -18);
    ctx.quadraticCurveTo(-26, -34, -14, -18);
    ctx.lineTo(-14, 14);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(120,130,140,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-37, -4);
    ctx.lineTo(-15, -4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-37, 6);
    ctx.lineTo(-15, 6);
    ctx.stroke();

    // EO/IR sensor on radome side
    ctx.fillStyle = "#d8dee6";
    ctx.fillRect(-18, -22, 12, 10);
    ctx.fillStyle = "#2a3038";
    ctx.fillRect(-15, -19, 6, 5);
    ctx.fillStyle = "rgba(74,144,200,0.75)";
    ctx.fillRect(-14, -18, 4, 3);

    // Ammo drum under breech
    ctx.fillStyle = "#4a5058";
    ctx.beginPath();
    ctx.ellipse(6, 12, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a3038";
    ctx.beginPath();
    ctx.ellipse(6, 12, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c9a227";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(6, 12, 9, 0.15, Math.PI - 0.15);
    ctx.stroke();

    // Gun breech
    ctx.fillStyle = "#2a3038";
    ctx.fillRect(2, -9, 20, 14);
    ctx.fillStyle = "#1a1e24";
    ctx.fillRect(6, -7, 14, 10);

    // Six-barrel gatling along +X
    const spin = state.barrelSpin;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + spin;
      const oy = Math.sin(a) * 4.5;
      const depth = Math.cos(a);
      ctx.fillStyle = depth > 0 ? "#12151a" : "#0a0c10";
      ctx.globalAlpha = 0.55 + Math.max(0, depth) * 0.45;
      ctx.fillRect(18, oy - 1.5, barrelLen - 4, 3);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#3a4048";
    ctx.beginPath();
    ctx.arc(18, 0, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(barrelLen + 12, -5, 6, 10);

    ctx.restore();

    for (const f of state.flashes) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);
      const a = f.life / 5;
      ctx.fillStyle = `rgba(255, 240, 160, ${a})`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(26, -9);
      ctx.lineTo(18, 0);
      ctx.lineTo(26, 9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 140, 40, ${a * 0.85})`;
      ctx.beginPath();
      ctx.arc(3, 0, 7 + (5 - f.life), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawMissiles() {
    const s = MISSILE_SCALE;
    for (const m of state.missiles) {
      for (let i = 0; i < m.trail.length; i++) {
        const t = m.trail[i];
        const a = (i / m.trail.length) * 0.5;
        ctx.fillStyle = `rgba(255, 160, 80, ${a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, (2.5 + i * 0.35) * s * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);
      ctx.scale(s, s);

      const body = ctx.createLinearGradient(-18, 0, 22, 0);
      body.addColorStop(0, "#ff6a3a");
      body.addColorStop(0.25, "#e8e0d0");
      body.addColorStop(1, "#a09888");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(-12, -7);
      ctx.lineTo(-18, 0);
      ctx.lineTo(-12, 7);
      ctx.closePath();
      ctx.fill();

      // Nose tip
      ctx.fillStyle = "#ff4a2a";
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(14, -4);
      ctx.lineTo(14, 4);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#8a4030";
      ctx.beginPath();
      ctx.moveTo(-10, -7);
      ctx.lineTo(-18, -14);
      ctx.lineTo(-6, -3);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-10, 7);
      ctx.lineTo(-18, 14);
      ctx.lineTo(-6, 3);
      ctx.fill();

      // Mid fins
      ctx.fillStyle = "#6a3828";
      ctx.beginPath();
      ctx.moveTo(2, -6);
      ctx.lineTo(-2, -12);
      ctx.lineTo(6, -4);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(2, 6);
      ctx.lineTo(-2, 12);
      ctx.lineTo(6, 4);
      ctx.fill();

      ctx.fillStyle = "rgba(255,120,40,0.85)";
      ctx.beginPath();
      ctx.arc(-20, 0, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,220,120,0.7)";
      ctx.beginPath();
      ctx.arc(-18, 0, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  function drawBullets() {
    for (const b of state.bullets) {
      const len = b.trail;
      const tx = b.x - Math.cos(b.angle) * len;
      const ty = b.y - Math.sin(b.angle) * len;

      // Outer glow streak
      const grad = ctx.createLinearGradient(tx, ty, b.x, b.y);
      grad.addColorStop(0, "rgba(255,120,40,0)");
      grad.addColorStop(0.45, "rgba(255,160,50,0.45)");
      grad.addColorStop(1, "rgba(255,240,180,0.95)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // Hot core
      ctx.strokeStyle = "rgba(255,255,230,0.95)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(b.x - Math.cos(b.angle) * (len * 0.35), b.y - Math.sin(b.angle) * (len * 0.35));
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.fillStyle = "#fff6c8";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      ctx.globalAlpha = Math.max(0, p.life / (p.smoke ? 40 : 40));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawReticle() {
    if (!state.running) return;
    const x = state.aimX;
    const y = state.aimY;
    ctx.strokeStyle = "rgba(232, 168, 58, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 20, y);
    ctx.lineTo(x - 8, y);
    ctx.moveTo(x + 8, y);
    ctx.lineTo(x + 20, y);
    ctx.moveTo(x, y - 20);
    ctx.lineTo(x, y - 8);
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, y + 20);
    ctx.stroke();
  }

  function draw() {
    ctx.save();
    if (state.shake > 0.4) {
      ctx.translate(
        (Math.random() - 0.5) * state.shake,
        (Math.random() - 0.5) * state.shake
      );
    }

    drawSea();
    drawShip();
    drawMissiles();
    drawBullets();
    drawParticles();
    drawCiws();
    drawReticle();

    ctx.fillStyle = "rgba(140, 190, 220, 0.06)";
    ctx.fillRect(0, H - 40, W, 40);

    ctx.restore();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(40, now - last);
    last = now;
    if (state.running) update(dt);
    else {
      ciws.angle = -Math.PI / 2 + Math.sin(now / 900) * 0.25;
    }
    draw();
    requestAnimationFrame(loop);
  }

  updateHud();
  requestAnimationFrame(loop);
})();
