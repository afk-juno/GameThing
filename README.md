# LPWS sim

A simple Space Invaders–style shooter where you operate an **LPWS** (Land-Based Phalanx Weapon System) on a fixed mount and stop incoming missiles with a dense 20mm tracer stream before they hit the emplacement. Tracers self-destruct at about **70% of the playfield height** as **20mm HEIT-SD airbursts** with a small splash radius.

## Play locally

1. Open `index.html` in a browser (Chrome, Edge, or Firefox).
2. Click **ENGAGE** (or press Space).
3. Aim with the mouse / finger or slew with WASD. Hold click / touch to fire.

## Controls

| Input | Action |
|--------|--------|
| Mouse / touch | Traverse and elevate the turret |
| WASD / arrow keys | Slew turret (left/right traverse, up/down elevation) |
| Hold click / touch | Fire continuous tracer stream (with LPWS fire audio) |
| R | Reload (3 seconds; also auto-reloads at 0) |
| Space | Start / restart |

On **ENGAGE**, the system plays an **INCOMING / INCOMING / INCOMING** alert. Missiles do not approach until that callout finishes.

## Share with coworkers

### Live link

**Play here:** https://afk-juno.github.io/GameThing/

Repo: https://github.com/afk-juno/GameThing

### Zip and send

Zip this folder and email / Teams / Slack it. Recipients unzip and open `index.html`.

### Netlify Drop

Upload the folder to [Netlify Drop](https://app.netlify.com/drop) for a shareable URL without GitHub.

## Goal

Destroy missiles and drones before they reach the mount. Destroyed **drones can drop ammo crates** (random chance). Shoot or collect a crate to refill to max and gain **5 seconds of infinite ammo**.

| Type | Look | Behavior |
|------|------|----------|
| Standard missile | Orange body, straight | Default speed, straight path |
| Drone | Black UAV, larger | Slides in from the left or right, then weaves as it drops |
| Fast missile | Magenta dart, slim | High speed, smaller target |

Score climbs with each intercept. Waves scale: **10 + (wave × 5)** threats, spawn delay **−10%** per wave (min 0.3s), and speed **+5%** per wave. A 3-second **WAVE COMPLETE** break lets you reload.
