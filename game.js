(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const waveEl = document.getElementById("wave");
  const livesEl = document.getElementById("lives");
  const ammoEl = document.getElementById("ammo");
  const reloadStatusEl = document.getElementById("reload-status");
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
    ammo: 300,
    reloading: false,
    reloadTimer: 0,
  };

  // Procedural audio: LPWS warning clip + Vulcan fire (fire sound unchanged)
  // Prefer assets/incoming.mp3 for pre-missile alert. Optional: assets/fire.mp3
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

    function playAlarmBurst(startAt) {
      const c = ensure();
      const t0 = startAt ?? c.currentTime;
      for (let i = 0; i < 4; i++) {
        const t = t0 + i * 0.14;
        beep(t, 980, 0.09, "square", 0.2);
        beep(t + 0.05, 1320, 0.07, "square", 0.14);
      }
    }

    function playIncomingBuffer(onDone) {
      const c = ensure();
      if (!incomingBuffer) {
        onDone();
        return;
      }

      const src = c.createBufferSource();
      src.buffer = incomingBuffer;
      src.playbackRate.value = 1;

      const g = c.createGain();
      g.gain.value = 1.15;

      src.connect(g);
      g.connect(master);

      alertSource = src;
      src.onended = () => {
        alertSource = null;
        onDone();
      };
      src.start();
    }

    function playIncomingHtml(onDone) {
      const a = new Audio("assets/incoming.mp3");
      a.preload = "auto";
      a.volume = 1;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        onDone();
      };
      a.addEventListener("ended", finish);
      a.addEventListener("error", finish);
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(finish);
      setTimeout(finish, 30000);
      alertSource = {
        stop() {
          try {
            a.pause();
            a.currentTime = 0;
          } catch (_) {}
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
        // Play the user-provided incoming alarm; no extra TTS chirps over it
        if (incomingBuffer) {
          playIncomingBuffer(done);
        } else {
          playIncomingHtml(done);
        }
      };

      const loader = incomingLoading || Promise.resolve(null);
      loader.then(run).catch(run);
      setTimeout(done, 45000);
    }

    function cancelAlert() {
      alertToken += 1;
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

  const mount = {
    x: W / 2,
    y: H - 72,
    width: 760,
    thick: 28,
  };

  const TURRET_SCALE = 1.55;
  const LPWS_HOME = { x: W / 2, y: H - 112 };
  const AIM_MIN = -Math.PI + 0.15;
  const AIM_MAX = -0.15;
  const MAX_AMMO = 300;
  const RELOAD_MS = 3000;
  const lpws = {
    x: LPWS_HOME.x,
    y: LPWS_HOME.y,
    angle: -Math.PI / 2,
    azimuth: -Math.PI / 2,
    barrelLen: 58,
    fireRate: 14, // ~4300 rpm continuous stream
  };

  const keys = new Set();

  const MISSILE_HIT_R = 28;
  const MISSILE_SCALE = 1.75;

  const ENEMY = {
    standard: {
      speedMul: 1,
      hitR: 28,
      scale: 1.75,
      hpBonus: 0,
      score: 100,
      trail: [255, 160, 80],
    },
    drone: {
      speedMul: 0.55,
      hitR: 46,
      scale: 2.2,
      hpBonus: 1,
      score: 120,
      trail: [48, 48, 50],
    },
    fast: {
      speedMul: 1.6,
      hitR: 18,
      scale: 1.2,
      hpBonus: -1,
      score: 160,
      trail: [220, 90, 170],
    },
  };

  function pickEnemyType() {
    const r = Math.random();
    const w = state.wave;
    const droneP = Math.min(0.34, 0.1 + w * 0.04);
    const fastP = w <= 1 ? 0.08 : Math.min(0.3, 0.12 + w * 0.03);
    if (r < droneP) return "drone";
    if (r < droneP + fastP) return "fast";
    return "standard";
  }

  function spawnMissile() {
    const type = pickEnemyType();
    const spec = ENEMY[type];
    const hp = Math.max(1, 2 + Math.floor(state.wave / 4) + spec.hpBonus);
    const speed = (1.15 + state.wave * 0.18 + Math.random() * 0.4) * spec.speedMul;

    if (type === "drone") {
      const fromLeft = Math.random() < 0.5;
      const x = fromLeft ? -56 : W + 56;
      const y = 72 + Math.random() * 150;
      const vx = (fromLeft ? 1 : -1) * (1.35 + state.wave * 0.12);
      const vy = 0.22 + Math.random() * 0.12;
      state.missiles.push({
        type,
        x,
        y,
        vx,
        vy,
        baseVx: vx,
        descendMax: speed * 0.72,
        weaveT: Math.random() * Math.PI * 2,
        weaveAmp: 1.05 + Math.random() * 0.5,
        angle: Math.atan2(vy, vx),
        hp,
        maxHp: hp,
        hitR: spec.hitR,
        scale: spec.scale,
        score: spec.score,
        trailRgb: spec.trail,
        trail: [],
      });
      return;
    }

    const sideBias = Math.random();
    const x =
      sideBias < 0.15
        ? Math.random() * 80
        : sideBias > 0.85
          ? W - Math.random() * 80
          : 40 + Math.random() * (W - 80);
    const targetX = mount.x + (Math.random() - 0.5) * mount.width * 0.7;
    const dx = targetX - x;
    const dy = mount.y - 20;
    const dist = Math.hypot(dx, dy) || 1;
    const vx = (dx / dist) * speed * 0.35;
    const vy = (dy / dist) * speed;
    state.missiles.push({
      type,
      x,
      y: -30 - Math.random() * 50,
      vx,
      vy,
      baseVx: vx,
      weaveT: 0,
      weaveAmp: 0,
      angle: Math.atan2(vy, vx),
      hp,
      maxHp: hp,
      hitR: spec.hitR,
      scale: spec.scale,
      score: spec.score,
      trailRgb: spec.trail,
      trail: [],
    });
  }

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
    lpws.x = LPWS_HOME.x;
    lpws.y = LPWS_HOME.y;
    lpws.angle = -Math.PI / 2;
    lpws.azimuth = -Math.PI / 2;
    state.ammo = MAX_AMMO;
    state.reloading = false;
    state.reloadTimer = 0;
    keys.clear();
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
    updateAmmoHud();
  }

  function updateAmmoHud() {
    ammoEl.textContent = `${state.ammo} / ${MAX_AMMO}`;
    ammoEl.classList.toggle("low", state.ammo <= 40 && !state.reloading);
    reloadStatusEl.hidden = !state.reloading;
  }

  function canFire() {
    return state.running && !state.reloading && state.ammo > 0;
  }

  function requestReload() {
    if (!state.running || state.reloading) return;
    if (state.ammo >= MAX_AMMO) return;
    state.reloading = true;
    state.reloadTimer = 0;
    AudioFX.setFiring(false);
    updateAmmoHud();
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
      "MOUNT HIT — MISSION FAILED",
      `Missiles struck the emplacement.<br />Final score: <strong style="color:#c989a8">${state.score}</strong> · Wave ${state.wave}`,
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
    const dx = x - lpws.x;
    const dy = y - lpws.y;
    let angle = Math.atan2(dy, dx);
    if (angle > 0) angle = angle > Math.PI / 2 ? AIM_MIN : AIM_MAX;
    state._targetAngle = Math.max(AIM_MIN, Math.min(AIM_MAX, angle));
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = pointerToCanvas(e.clientX, e.clientY);
    setAim(p.x, p.y);
    state.fireHeld = true;
    if (canFire()) AudioFX.setFiring(true);
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

  function isSlewKey(code) {
    return (
      code === "KeyW" ||
      code === "KeyA" ||
      code === "KeyS" ||
      code === "KeyD" ||
      code === "ArrowUp" ||
      code === "ArrowDown" ||
      code === "ArrowLeft" ||
      code === "ArrowRight"
    );
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (!state.running) startGame();
      return;
    }
    if (e.code === "KeyR") {
      e.preventDefault();
      requestReload();
      return;
    }
    if (isSlewKey(e.code)) {
      e.preventDefault();
      keys.add(e.code);
    }
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
  });

  window.addEventListener("blur", () => keys.clear());

  function muzzlePos(angle) {
    const pivotY = lpws.y - 6;
    const len = (lpws.barrelLen + 16) * TURRET_SCALE;
    return {
      x: lpws.x + Math.cos(angle) * len,
      y: pivotY + Math.sin(angle) * len,
    };
  }

  function fire() {
    if (!canFire()) {
      AudioFX.setFiring(false);
      if (state.ammo <= 0 && !state.reloading) requestReload();
      return;
    }
    const now = state.time;
    if (now - state.lastShot < lpws.fireRate) return;
    state.lastShot = now;
    state.barrelSpin += 0.55;
    state.ammo -= 1;
    updateAmmoHud();
    if (state.ammo <= 0) requestReload();

    const spread = (Math.random() - 0.5) * 0.045;
    const angle = lpws.angle + spread;
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
        x: lpws.x + Math.cos(angle) * 10,
        y: lpws.y + Math.sin(angle) * 10 + 4,
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
      state.score += m.score + state.wave * 10;
      const [cr, cg, cb] = m.trailRgb || [255, 138, 74];
      explode(m.x, m.y, `rgb(${cr},${cg},${cb})`, 28);
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
    explode(m.x, mount.y - 10, "#ffaa55", 20);
    state.shake = 14;
    state.lives -= 1;
    AudioFX.playDamage();
    updateHud();
    if (state.lives <= 0) gameOver();
  }

  function update(dt) {
    if (state.alerting) state.alertFlash += dt;

    if (state.combatReady) state.time += dt;

    lpws.x = LPWS_HOME.x;
    lpws.y = LPWS_HOME.y;

    if (state._targetAngle == null) state._targetAngle = lpws.angle;

    const slew = 0.0028 * dt;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) state._targetAngle -= slew;
    if (keys.has("KeyD") || keys.has("ArrowRight")) state._targetAngle += slew;
    if (keys.has("KeyW") || keys.has("ArrowUp")) {
      const d = -Math.PI / 2 - state._targetAngle;
      state._targetAngle += Math.sign(d) * Math.min(slew, Math.abs(d));
    }
    if (keys.has("KeyS") || keys.has("ArrowDown")) {
      if (state._targetAngle > -Math.PI / 2) state._targetAngle += slew;
      else state._targetAngle -= slew;
    }
    state._targetAngle = Math.max(AIM_MIN, Math.min(AIM_MAX, state._targetAngle));

    let diff = state._targetAngle - lpws.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    lpws.angle += diff * Math.min(1, 0.18);

    const azTarget = Math.atan2(
      Math.max(-0.5, Math.min(-0.12, Math.sin(lpws.angle) * 0.35)),
      Math.cos(lpws.angle)
    );
    let azDiff = azTarget - lpws.azimuth;
    while (azDiff > Math.PI) azDiff -= Math.PI * 2;
    while (azDiff < -Math.PI) azDiff += Math.PI * 2;
    lpws.azimuth += azDiff * Math.min(1, 0.16);

    if (state.reloading) {
      state.reloadTimer += dt;
      if (state.reloadTimer >= RELOAD_MS) {
        state.reloading = false;
        state.reloadTimer = 0;
        state.ammo = MAX_AMMO;
        updateAmmoHud();
        if (state.fireHeld && canFire()) AudioFX.setFiring(true);
      }
    }

    if (state.fireHeld && canFire()) fire();
    else {
      state.barrelSpin *= 0.92;
      if (state.fireHeld && !canFire()) AudioFX.setFiring(false);
    }

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

      if (m.type === "drone") {
        const onScreen = m.x > 24 && m.x < W - 24;
        m.weaveT += dt * 0.0048;
        if (onScreen) {
          m.vx = m.baseVx + Math.sin(m.weaveT) * m.weaveAmp;
          m.vy = Math.min((m.vy || 0) + dt * 0.00042, m.descendMax || 1.1);
          if (m.x < 28) m.vx = Math.abs(m.vx);
          if (m.x > W - 28) m.vx = -Math.abs(m.vx);
        }
      }

      m.x += m.vx;
      m.y += m.vy;
      m.angle = Math.atan2(m.vy, m.vx);

      const hitMount =
        m.y >= mount.y - 8 && Math.abs(m.x - mount.x) < mount.width / 2 + 10;
      const hitGun = Math.hypot(m.x - lpws.x, m.y - lpws.y) < 52;
      if (hitMount || hitGun) {
        missileImpact(m);
        continue;
      }
      if (m.y > H + 40) {
        state.missiles.splice(i, 1);
      }
    }

    for (let bi = state.bullets.length - 1; bi >= 0; bi--) {
      const b = state.bullets[bi];
      for (let mi = 0; mi < state.missiles.length; mi++) {
        const m = state.missiles[mi];
        const r = m.hitR || MISSILE_HIT_R;
        const dx = b.x - m.x;
        const dy = b.y - m.y;
        if (dx * dx + dy * dy < r * r) {
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

  function drawBackdrop() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#241536");
    g.addColorStop(0.22, "#3a2450");
    g.addColorStop(0.48, "#7a4a6a");
    g.addColorStop(0.58, "#c49aa0");
    g.addColorStop(0.62, "#8a6a88");
    g.addColorStop(0.63, "#4a3a68");
    g.addColorStop(1, "#2a2048");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(232, 210, 230, 0.55)";
    for (let i = 0; i < 28; i++) {
      const sx = (i * 97 + 40) % W;
      const sy = 12 + ((i * 53) % 210);
      ctx.globalAlpha = 0.15 + (i % 5) * 0.06;
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;

    const sunX = W * 0.7;
    const sunY = H * 0.34;
    const cyanRing = ctx.createRadialGradient(sunX, sunY, 34, sunX, sunY, 120);
    cyanRing.addColorStop(0, "rgba(120, 190, 195, 0)");
    cyanRing.addColorStop(0.55, "rgba(110, 175, 185, 0.18)");
    cyanRing.addColorStop(1, "rgba(110, 175, 185, 0)");
    ctx.fillStyle = cyanRing;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 120, 0, Math.PI * 2);
    ctx.fill();

    const sunGlow = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 88);
    sunGlow.addColorStop(0, "rgba(245, 196, 196, 0.85)");
    sunGlow.addColorStop(0.35, "rgba(214, 130, 150, 0.4)");
    sunGlow.addColorStop(1, "rgba(214, 130, 150, 0)");
    ctx.fillStyle = sunGlow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 88, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(236, 176, 178, 0.7)";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(130, 186, 190, 0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 44, 0, Math.PI * 2);
    ctx.stroke();

    const horizon = H * 0.62;
    ctx.fillStyle = "rgba(196, 130, 160, 0.22)";
    ctx.fillRect(0, horizon - 6, W, 12);

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(196, 120, 168, 0.38)";
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      const y = horizon + Math.pow(t, 1.55) * (H - horizon);
      ctx.globalAlpha = 0.18 + t * 0.32;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(110, 176, 186, 0.32)";
    const rays = 20;
    for (let i = 0; i <= rays; i++) {
      const x = (i / rays) * W;
      ctx.beginPath();
      ctx.moveTo(W / 2, horizon);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255, 220, 240, 0.025)";
    for (let y = 0; y < H; y += 3) {
      ctx.fillRect(0, y, W, 1);
    }
  }

  function drawMount() {
    const x = mount.x;
    const y = mount.y;
    const half = mount.width / 2;
    const thick = mount.thick;

    ctx.fillStyle = "rgba(8, 6, 16, 0.5)";
    ctx.beginPath();
    ctx.ellipse(x, H - 10, half + 8, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    const pads = [-half + 40, -half * 0.38, half * 0.38, half - 40];
    for (const px of pads) {
      ctx.fillStyle = "#322c40";
      ctx.fillRect(x + px - 7, y + thick, 14, H - y - thick - 12);
      ctx.fillStyle = "#4a4458";
      ctx.fillRect(x + px - 18, H - 22, 36, 10);
      ctx.fillStyle = "#6a6478";
      ctx.fillRect(x + px - 16, H - 22, 32, 3);
    }

    ctx.fillStyle = "#2a2636";
    ctx.fillRect(x - half - 10, y + thick, half * 2 + 20, 10);

    const deck = ctx.createLinearGradient(0, y - 14, 0, y + thick);
    deck.addColorStop(0, "#7a748c");
    deck.addColorStop(0.4, "#5c566c");
    deck.addColorStop(1, "#3c364c");
    ctx.fillStyle = deck;
    ctx.beginPath();
    ctx.rect(x - half, y - 10, half * 2, thick + 10);
    ctx.fill();

    ctx.fillStyle = "#8a8498";
    ctx.fillRect(x - half, y - 10, half * 2, 4);
    ctx.fillStyle = "#2e2a3c";
    ctx.fillRect(x - half, y + thick - 3, half * 2, 3);

    ctx.fillStyle = "rgba(40, 34, 52, 0.45)";
    for (let i = 0; i < 18; i++) {
      ctx.fillRect(x - half + 12 + i * 42, y - 4, 28, 2);
    }

    ctx.fillStyle = "#262232";
    ctx.fillRect(x - half + 50, y + 2, half * 2 - 100, 10);
    ctx.fillStyle = "#6a90a0";
    ctx.fillRect(x - half + 50, y + 5, half * 2 - 100, 2);

    const stripeW = 18;
    for (let i = 0; i < Math.floor((half * 2) / stripeW); i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(196, 168, 90, 0.28)" : "rgba(28, 24, 36, 0.55)";
      ctx.fillRect(x - half + i * stripeW, y + thick - 12, stripeW, 8);
    }

    ctx.strokeStyle = "#a098b0";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.ellipse(x, y - 2, 120, 20, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#5a5468";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y - 2, 96, 14, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#c4b8a0";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 120, y - 2 + Math.sin(a) * 20, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#3a3648";
    ctx.beginPath();
    ctx.ellipse(x, y - 2, 72, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLpws() {
    const { x, y, angle, barrelLen } = lpws;
    const tanMid = "#9a7348";
    const hw = 86;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, y + 38, hw + 6, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#c4a76a";
    ctx.beginPath();
    ctx.moveTo(x - hw, y + 8);
    ctx.lineTo(x - hw + 10, y + 40);
    ctx.lineTo(x + hw - 10, y + 40);
    ctx.lineTo(x + hw, y + 8);
    ctx.lineTo(x + hw - 18, y - 4);
    ctx.lineTo(x - hw + 18, y - 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = tanMid;
    ctx.beginPath();
    ctx.moveTo(x - hw, y + 8);
    ctx.lineTo(x - hw + 10, y + 40);
    ctx.lineTo(x - hw + 32, y + 40);
    ctx.lineTo(x - hw + 22, y + 8);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#a88858";
    ctx.fillRect(x - 56, y + 6, 112, 10);

    ctx.strokeStyle = "rgba(60,40,20,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 48, y + 18, 36, 14);
    ctx.strokeRect(x + 12, y + 18, 36, 14);

    ctx.fillStyle = "#e8c84a";
    ctx.fillRect(x - 22, y + 34, 44, 5);

    ctx.strokeStyle = "#8a6a42";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x - hw + 4, y + 12 + i * 7);
      ctx.lineTo(x - hw + 16, y + 12 + i * 7);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(x, y - 6);
    ctx.rotate(lpws.azimuth);
    ctx.scale(TURRET_SCALE, TURRET_SCALE);

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

    ctx.fillStyle = "#d8dee6";
    ctx.fillRect(-18, -22, 12, 10);
    ctx.fillStyle = "#2a3038";
    ctx.fillRect(-15, -19, 6, 5);
    ctx.fillStyle = "rgba(74,144,200,0.75)";
    ctx.fillRect(-14, -18, 4, 3);
    ctx.restore();

    ctx.save();
    ctx.translate(x, y - 6);
    ctx.rotate(angle);
    ctx.scale(TURRET_SCALE, TURRET_SCALE);

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
    for (const m of state.missiles) {
      const s = m.scale || MISSILE_SCALE;
      const [tr, tg, tb] = m.trailRgb || [255, 160, 80];
      for (let i = 0; i < m.trail.length; i++) {
        const t = m.trail[i];
        const a = (i / m.trail.length) * 0.5;
        ctx.fillStyle = `rgba(${tr}, ${tg}, ${tb}, ${a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, (2.2 + i * 0.32) * s * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);
      ctx.scale(s, s);

      if (m.type === "drone") drawDrone();
      else if (m.type === "fast") drawFastMissile();
      else drawStandardMissile();

      ctx.restore();
    }
  }

  function drawStandardMissile() {
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
  }

  function drawDrone() {
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.ellipse(2, 2, 16, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#141414";
    ctx.beginPath();
    ctx.moveTo(14, -5);
    ctx.lineTo(18, 0);
    ctx.lineTo(14, 5);
    ctx.lineTo(-10, 6);
    ctx.lineTo(-14, 0);
    ctx.lineTo(-10, -6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(-8, -4, 16, 8);

    ctx.strokeStyle = "rgba(70, 70, 74, 0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-8.5, -4.5, 17, 9);

    ctx.fillStyle = "#1c1c1c";
    ctx.fillRect(-2, -3, 8, 6);
    ctx.fillStyle = "#3a1010";
    ctx.fillRect(0, -2, 4, 4);
    ctx.fillStyle = "rgba(180, 40, 40, 0.85)";
    ctx.fillRect(1, -1, 2, 2);

    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.moveTo(-4, -5);
    ctx.lineTo(-16, -16);
    ctx.lineTo(6, -7);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-4, 5);
    ctx.lineTo(-16, 16);
    ctx.lineTo(6, 7);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(55, 55, 58, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-8, -14, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-8, 14, 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.arc(-8, -14, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-8, 14, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#c45a4a";
    ctx.fillRect(-12, -1.5, 4, 3);
  }

  function drawFastMissile() {
    const body = ctx.createLinearGradient(-16, 0, 26, 0);
    body.addColorStop(0, "#c45a9a");
    body.addColorStop(0.35, "#e8d0e0");
    body.addColorStop(1, "#8a6a88");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(26, 0);
    ctx.lineTo(-8, -3.5);
    ctx.lineTo(-16, 0);
    ctx.lineTo(-8, 3.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#e85a9a";
    ctx.beginPath();
    ctx.moveTo(26, 0);
    ctx.lineTo(16, -2.4);
    ctx.lineTo(16, 2.4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#6a3858";
    ctx.beginPath();
    ctx.moveTo(-6, -3.5);
    ctx.lineTo(-14, -9);
    ctx.lineTo(-2, -1.5);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-6, 3.5);
    ctx.lineTo(-14, 9);
    ctx.lineTo(-2, 1.5);
    ctx.fill();

    ctx.fillStyle = "rgba(230, 90, 180, 0.9)";
    ctx.beginPath();
    ctx.arc(-17, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 190, 230, 0.8)";
    ctx.beginPath();
    ctx.arc(-15, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();
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
    ctx.strokeStyle = "rgba(201, 137, 168, 0.55)";
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
    ctx.fillText("LPWS ALERT — STAND BY FOR ENGAGEMENT", W / 2, H * 0.28 + 72);
  }

  function draw() {
    ctx.save();
    if (state.shake > 0.4) {
      ctx.translate(
        (Math.random() - 0.5) * state.shake,
        (Math.random() - 0.5) * state.shake
      );
    }

    drawBackdrop();
    drawMount();
    drawMissiles();
    drawBullets();
    drawParticles();
    drawLpws();
    drawReticle();
    drawIncomingBanner();

    ctx.fillStyle = "rgba(18, 12, 28, 0.28)";
    ctx.fillRect(0, H - 18, W, 18);

    ctx.restore();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(40, now - last);
    last = now;
    if (state.running) update(dt);
    else {
      lpws.x = LPWS_HOME.x;
      lpws.y = LPWS_HOME.y;
      lpws.angle = -Math.PI / 2 + Math.sin(now / 900) * 0.25;
      lpws.azimuth = Math.atan2(
        Math.max(-0.5, Math.min(-0.12, Math.sin(lpws.angle) * 0.35)),
        Math.cos(lpws.angle)
      );
    }
    draw();
    requestAnimationFrame(loop);
  }

  updateHud();
  requestAnimationFrame(loop);
})();
