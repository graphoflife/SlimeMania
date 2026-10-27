# SlimeMania

A small, satisfying pixel-art shooter for the browser, for phones and desktop.

Giant slimes grow into existence at the top of the sky and wobble their way down. Your turret
rides a chain belt along the bottom and fires on its own. Every slime pops into three smaller ones,
and those pop into three tiny ones. Every pop pays out its HP as money. Spend the money on 27 weird
weapons and exponential upgrades, then push to higher levels.

Each level has two slime types. Each type has its own colour for big, medium and small, and all six
colours are different. They are re-rolled whenever a level is loaded.

Every projectile is fast and flies straight up until it hits a slime or leaves the screen. Nothing
explodes early: a projectile uses up its hits, and only then may it split into new projectiles,
which hit and split again (plasma goes 2, 4, 8). A projectile that could not hit anything again
gives all its remaining hits to the slime it is in, so no hits are wasted. Weapons are silent, only
the slime hits and pops make sound.

## How to play

- **Move**: touch where the gun should go (and drag), move the mouse, or use the arrow keys / A and D.
- **Menu bar**: below the chain belt: money, level selector and the shop (cart) button. On phones the game goes
  fullscreen when you start (on iPhone use "Add to Home Screen" instead).
- **Armory**: buy weapons and upgrade them. Tap a weapon to equip it (up to 3; equipping a fourth
  replaces the one equipped longest ago). Tap the square ▲ button for one level, or hold it for
  turbo upgrades.
- **Levels**: clear the first wave of a level to unlock the next one. You can keep farming any
  unlocked level for as long as you like. If a slime reaches the bottom, the level restarts.
- **Night**: between 20:00 and 06:00 (device clock) the sky turns to night with stars and a moon.
  It can also be set by hand in the settings.
- `E` / `Tab` opens the Armory on desktop, `Esc` closes it.

- **Settings** (gear button at the bottom of the Armory): sound on/off, sky AUTO/DAY/NIGHT and
  RESET GAME (after a confirmation).

Progress is saved in the browser (localStorage).

## The numbers

- All weapons share one ladder of levels. DPS and upgrade cost depend only on where a weapon stands
  on that ladder, so two weapons whose next upgrade costs about the same deal about the same DPS.
- Buying a weapon costs exactly the price of its first level on the ladder. Its level 2 costs the
  next, more expensive step. So a freshly bought weapon is as strong as an old one upgraded to that
  price.
- Every step adds +5% DPS. The first 30 upgrades of each weapon also shorten its pulse interval
  down to 50%. After that only damage grows.
- Slime HP doubles every level. A big slime has 18 HP on level 1, a medium one 1/3 of that and a
  small one 1/9.
- You earn exactly the HP of every slime you kill, so income is roughly your DPS.
- Each weapon's entry step is placed so that the next weapon takes about 5 minutes of play at the
  start and about 10 minutes for the last one (~3.6 h total).
- Numbers use steps of 1000: K, M, G, T, P, E, Z, Y, R, Q (10^30). After that, KQ, MQ and so on.

All weapons are the same "class": a set of numbers (pulse interval, projectiles per pulse, pulse
length, speed, angle, damage split, hits per projectile, rest between hits, recoil, rotation kick,
sub-projectiles and sub-sub-projectiles). They are balanced against each other by simulation, so
they all have the same power at the same level.

## Development

No build step. Serve the folder with any static server:

```bash
python3 tools/serve.py 8080
```

Then open http://localhost:8080. Testing helpers:

- `?autoplay` lets the autopilot play.
- `?testall` replaces the save with every weapon unlocked at equal DPS (the last weapon at level 30)
  and jumps to a matching level. The parameter is removed from the address after loading.

Balancing tools (Node 18+):

```bash
node tools/balance.mjs --write   # simulate every weapon, write js/balance.js
node tools/pacing.mjs --write    # place weapon entry steps for 5 -> 10 minute pacing
node tools/early.mjs             # check that level 1 is easy and level 2 is not
```

## Code map

| File | What it does |
| --- | --- |
| `js/world.js` | Simulation: gun, slimes, waves, projectiles, hits, splitting (no DOM) |
| `js/weapons.js` | The 30 weapon definitions and the per-level stat builder |
| `js/economy.js` | DPS, HP, cost and price curves |
| `js/render.js` | Drawing, effects, chain belt and turret |
| `js/sprites.js` | Procedural pixel art, rotation cache, slime bodies and faces, hit explosion |
| `js/projectile-art.js` | Detailed projectile sprites built from shaded signed-distance shapes |
| `js/pixelart.js` | Canvas and colour helpers |
| `js/background.js` | Parallax landscape and clouds |
| `js/audio.js` | Synthesised sound effects (WebAudio) |
| `js/ui.js` | HUD, banners, Armory |
| `js/main.js` | Main loop, input, level flow |
