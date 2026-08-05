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
    alerting: false,
    combatReady: false,
    alertFlash: 0,
  };

  // Procedural audio: user incoming clip (3s–8s) + Vulcan fire synth (unchanged)
  const AudioFX = (() => {
    let ctx = null;
    let master = null;
    let fireGain = null;
    let fireSources = [];
    let firing = false;
    let alertToken = 0;
    let incomingBuffer = null;
    let incomingLoading = null;
    let fireClip = null;
    let clipsTried = false;
    let alertSource = null;
    let alertTimer = null;

    // Only play this window of assets/incoming.mp3 at mission start
    const INCOMING_START = 3;
    const INCOMING_END = 8;

    function ensure() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      tryLoadClips();
      return ctx;
    }

    function tryLoadClips() {
      if (clipsTried) return;
      clipsTried = true;

      fireClip = new Audio("assets/fire.mp3");
      fireClip.preload = "auto";
      fireClip.loop = true;
      fireClip.volume = 0.75;
      fireClip.addEventListener("error", () => {
        fireClip = null;
      });

      incomingLoading = fetch("assets/incoming.mp3")
        .then((r) => {
          if (!r.ok) throw new Error("missing incoming.mp3");
          return r.arrayBuffer();
        })
        .then((ab) => ensure().decodeAudioData(ab.slice(0)))
        .then((buf) => {
          incomingBuffer = buf;
          return buf;
        })
        .catch(() => {
          incomingBuffer = null;
          return null;
        });
    }

    function beep(time, freq, dur, type = "square", vol = 0.18) {
      const c = ensure();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
      o.connect(g);
      g.connect(master);
      o.start(time);
      o.stop(time + dur + 0.02);
    }

    function playIncomingBuffer(onDone) {
      const c = ensure();
      if (!incomingBuffer) {
        onDone();
        return;
      }

      const start = Math.min(INCOMING_START, Math.max(0, incomingBuffer.duration - 0.05));
      const end = Math.min(INCOMING_END, incomingBuffer.duration);
      const dur = Math.max(0.05, end - start);

      const src = c.createBufferSource();
      src.buffer = incomingBuffer;
      const g = c.createGain();
      g.gain.value = 1;
      src.connect(g);
      g.connect(master);

      alertSource = src;
      src.onended = () => {
        alertSource = null;
        onDone();
      };
      // Play only 3.00 → 8.00
      src.start(0, start, dur);
    }

    function playIncomingHtml(onDone) {
      const a = new Audio("assets/incoming.mp3");
      a.preload = "auto";
      a.volume = 1;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (alertTimer) {
          clearInterval(alertTimer);
          alertTimer = null;
        }
        try {
          a.pause();
        } catch (_) {}
        onDone();
      };

      const startPlayback = () => {
        try {
          a.currentTime = INCOMING_START;
        } catch (_) {}
        const p = a.play();
        if (p && typeof p.catch === "function") p.catch(finish);
        alertTimer = setInterval(() => {
          if (a.ended || a.currentTime >= INCOMING_END) finish();
        }, 40);
      };

      if (a.readyState >= 1) startPlayback();
      else a.addEventListener("loadedmetadata", startPlayback, { once: true });

      a.addEventListener("error", finish);
      setTimeout(finish, (INCOMING_END - INCOMING_START) * 1000 + 2000);

      alertSource = {
        stop() {
          finish();
        },
      };
    }

    function playIncomingAlert(onComplete) {
      const token = ++alertToken;
      ensure();

      let finished = false;
      const done = () => {
        if (token !== alertToken || finished) return;
        finished = true;
        onComplete();
      };

      const run = () => {
        if (token !== alertToken) return;
        // Exact user clip only — no extra chirps/filters
        if (incomingBuffer) playIncomingBuffer(done);
        else playIncomingHtml(done);
      };

      const loader = incomingLoading || Promise.resolve(null);
      loader.then(run).catch(run);
      setTimeout(done, (INCOMING_END - INCOMING_START) * 1000 + 3000);
    }

    function cancelAlert() {
      alertToken += 1;
      if (alertTimer) {
        clearInterval(alertTimer);
        alertTimer = null;
      }
      if (alertSource) {
        try {
          alertSource.stop();
        } catch (_) {}
        alertSource = null;
      }
    }

    function stopFireSynth() {
      if (fireGain && ctx) {
        try {
          fireGain.gain.cancelScheduledValues(ctx.currentTime);
          fireGain.gain.setValueAtTime(fireGain.gain.value, ctx.currentTime);
          fireGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
        } catch (_) {}
      }
      for (const s of fireSources) {
        try {
          s.stop();
        } catch (_) {}
      }
      fireSources = [];
      fireGain = null;
    }

    function stopFire() {
      firing = false;
      stopFireSynth();
      if (fireClip) {
        try {
          fireClip.pause();
          fireClip.currentTime = 0;
        } catch (_) {}
      }
    }

    function startFireSynth() {
      const c = ensure();
      stopFireSynth();

      fireGain = c.createGain();
      fireGain.gain.value = 0.0001;
      fireGain.connect(master);
      fireGain.gain.linearRampToValueAtTime(0.55, c.currentTime + 0.04);

      const pulseRate = 75;
      const bufferSize = c.sampleRate * 0.5;
      const noiseBuf = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        const t = i / c.sampleRate;
        const pulse = Math.pow(Math.max(0, Math.sin(t * pulseRate * Math.PI * 2)), 8);
        const grit = (Math.random() * 2 - 1) * 0.7;
        const low = Math.sin(t * 90 * Math.PI * 2) * 0.25;
        data[i] = (grit * 0.85 + low) * (0.35 + pulse * 0.65);
      }

      const noise = c.createBufferSource();
      noise.buffer = noiseBuf;
      noise.loop = true;

      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800;
      bp.Q.value = 0.85;

      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 400;

      const rumble = c.createOscillator();
      rumble.type = "sawtooth";
      rumble.frequency.value = 55;
      const rumbleGain = c.createGain();
      rumbleGain.gain.value = 0.08;

      noise.connect(bp);
      bp.connect(hp);
      hp.connect(fireGain);
      rumble.connect(rumbleGain);
      rumbleGain.connect(fireGain);

      noise.start();
      rumble.start();
      fireSources = [noise, rumble];
    }

    function startFire() {
      if (firing) return;
      ensure();
      firing = true;

      if (fireClip) {
        fireClip.currentTime = 0;
        const p = fireClip.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => startFireSynth());
        }
        return;
      }
      startFireSynth();
    }

    function setFiring(on) {
      if (on) startFire();
      else stopFire();
    }

    function playIntercept() {
      const c = ensure();
      const t = c.currentTime;
      beep(t, 220, 0.12, "sawtooth", 0.12);
      beep(t, 90, 0.18, "triangle", 0.1);
      const nLen = Math.floor(c.sampleRate * 0.12);
      const buf = c.createBuffer(1, nLen, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < nLen; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = 0.22;
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 2400;
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start();
    }

    function playDamage() {
      const c = ensure();
      const t = c.currentTime;

      // Hull / mount impact: deep boom + metal crack + debris
      beep(t, 55, 0.42, "sine", 0.32);
      beep(t, 38, 0.55, "triangle", 0.22);
      beep(t + 0.02, 180, 0.12, "sawtooth", 0.14);
      beep(t + 0.04, 420, 0.08, "square", 0.08);

      const nLen = Math.floor(c.sampleRate * 0.35);
      const buf = c.createBuffer(1, nLen, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < nLen; i++) {
        const env = Math.pow(1 - i / nLen, 1.6);
        d[i] = (Math.random() * 2 - 1) * env;
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      const g = c.createGain();
      g.gain.value = 0.45;
      src.connect(lp);
      lp.connect(g);
      g.connect(master);
      src.start(t);

      // Short damage alarm sting
      beep(t + 0.08, 880, 0.07, "square", 0.12);
      beep(t + 0.18, 880, 0.07, "square", 0.1);
    }

    function hushAll() {
      cancelAlert();
      stopFire();
    }

    return {
      ensure,
      playIncomingAlert,
      cancelAlert,
      setFiring,
      playIntercept,
      playDamage,
      hushAll,
    };
  })();

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
    state.alerting = false;
    state.combatReady = false;
    state.alertFlash = 0;
    AudioFX.setFiring(false);
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
    AudioFX.ensure();
    AudioFX.hushAll();
    resetGame();
    state.running = true;
    state.alerting = true;
    state.combatReady = false;
    hideOverlay();

    AudioFX.playIncomingAlert(() => {
      if (!state.running) return;
      state.alerting = false;
      state.combatReady = true;
      state.time = 0;
      state.spawnTimer = 900; // first wave shortly after alert ends
    });
  }

  function gameOver() {
    state.running = false;
    state.alerting = false;
    state.combatReady = false;
    AudioFX.hushAll();
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
    if (state.running) AudioFX.setFiring(true);
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = pointerToCanvas(e.clientX, e.clientY);
    setAim(p.x, p.y);
  });

  canvas.addEventListener("pointerup", () => {
    state.fireHeld = false;
    AudioFX.setFiring(false);
  });

  canvas.addEventListener("pointercancel", () => {
    state.fireHeld = false;
    AudioFX.setFiring(false);
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
      AudioFX.playIntercept();
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
    AudioFX.playDamage();
    updateHud();
    if (state.lives <= 0) gameOver();
  }

  function update(dt) {
    if (state.alerting) state.alertFlash += dt;

    if (state.combatReady) state.time += dt;

    if (state._targetAngle == null) state._targetAngle = ciws.angle;
    let diff = state._targetAngle - ciws.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ciws.angle += diff * Math.min(1, 0.18);

    if (state.fireHeld) fire();
    else state.barrelSpin *= 0.92;

    // Hold missiles until "INCOMING" alert finishes
    if (state.combatReady) {
      const spawnInterval = Math.max(420, 1400 - state.wave * 90);
      state.spawnTimer += dt;
      if (state.spawnTimer >= spawnInterval) {
        state.spawnTimer = 0;
        const burst = 1 + Math.floor(state.wave / 3);
        for (let i = 0; i < burst; i++) {
          setTimeout(() => {
            if (state.running && state.combatReady) spawnMissile();
          }, i * 180);
        }
      }

      const nextWaveAt = state.wave * 20000;
      if (state.time > nextWaveAt) {
        state.wave += 1;
        updateHud();
      }
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

  function drawIncomingBanner() {
    if (!state.alerting) return;
    const pulse = 0.55 + 0.45 * Math.sin(state.alertFlash / 120);
    ctx.fillStyle = `rgba(180, 30, 20, ${0.18 * pulse})`;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 42px Orbitron, sans-serif";
    ctx.fillStyle = `rgba(255, 70, 50, ${0.75 + 0.25 * pulse})`;
    ctx.fillText("INCOMING", W / 2, H * 0.28);
    ctx.font = "700 18px Orbitron, sans-serif";
    ctx.fillStyle = `rgba(255, 200, 120, ${0.7 + 0.3 * pulse})`;
    ctx.fillText("INCOMING  ·  INCOMING  ·  INCOMING", W / 2, H * 0.28 + 40);
    ctx.font = "14px Share Tech Mono, monospace";
    ctx.fillStyle = "rgba(200, 220, 230, 0.75)";
    ctx.fillText("C-RAM ALERT — STAND BY FOR ENGAGEMENT", W / 2, H * 0.28 + 72);
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
    drawIncomingBanner();

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
