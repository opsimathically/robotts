# RobotTS

RobotTS is a Linux-only, TypeScript-oriented fork of RobotJS for desktop automation, screen capture, Linux desktop awareness, strict window targeting, and window-relative automation flows.

This fork is focused on:

- Linux-native behavior instead of cross-platform support
- strict and fail-closed window targeting
- typed APIs for mouse, keyboard, screen, displays, workspaces, and windows
- deterministic or auto-randomized mouse paths
- humanized cursor movement through geometry and speed variation

The currently validated path is X11-backed Linux. Wayland capability differences should be expected and checked at runtime through `robot.desktop.getCapabilities()`.

RobotTS expects a real graphical session for live input and capture work. If no usable X display is available, desktop discovery may report `unavailable`, and movement or capture calls can fail.

## Capabilities At A Glance

- Move, click, drag, scroll, and inspect the mouse cursor
- Type text, tap keys, toggle keys, and send Unicode input
- Capture the full screen, a display, or a window region
- Inspect displays, workspaces, windows, and the active window
- Resolve, assert, and focus strict Linux window targets
- Lock automation to one concrete window and use window-relative coordinates
- Move the cursor with `linear`, `wavy`, and `human_like` paths
- Use constant or humanized path speed profiles
- Use static seeds for repeatability or omit seeds for auto-generated randomness

## What RobotTS Is

RobotTS is not upstream RobotJS documentation. This fork has diverged significantly:

- Linux only
- Node 22+
- source build instead of upstream prebuilt-binary assumptions
- explicit desktop/window awareness
- strict targeting and locked-window flows
- richer path movement, speed-profile, and seed handling

If you need automation against real Linux windows instead of only global screen coordinates, this fork is designed around that use case.

## Requirements

- Linux
- Node.js 22 or newer
- Python 3
- `make`
- `g++`
- X11 development headers and libraries
- PNG and zlib development packages

Validated system packages:

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  python3 \
  make \
  g++ \
  pkg-config \
  libx11-dev \
  libxtst-dev \
  libxrandr-dev \
  libpng-dev \
  zlib1g-dev \
  valgrind
```

## Install And Build On Linux

Install dependencies without triggering the native build immediately:

```bash
npm install --ignore-scripts
```

Build the addon explicitly:

```bash
npm_config_devdir=/tmp/node-gyp-cache npm run build
```

With the current package surface, the primary import style is:

```ts
import robot from "robotts";
```

CommonJS compatibility is still available for consumers who need it, but the examples below use ESM import syntax consistently.

## Quick Start

```ts
import robot from "robotts";

robot.setMouseDelay(5);
robot.moveMouse(400, 300);
robot.mouseClick("left", false);

robot.typeString("Hello from RobotTS");
robot.keyTap("enter");
```

Inspect the current mouse position and the pixel under it:

```ts
import robot from "robotts";

const mouse = robot.getMousePos();
const hex = robot.getPixelColor(mouse.x, mouse.y);

console.log({ mouse, hex: `#${hex}` });
```

## Desktop Awareness And Targeting

Inspect backend capabilities before doing strict targeting work:

```ts
import robot from "robotts";

const capabilities = robot.desktop.getCapabilities();
console.log(capabilities);

if (!capabilities.supportsStrictTargetVerification) {
  throw new Error("Strict targeting is not available in this Linux session.");
}
```

Inspect the current desktop state:

```ts
import robot from "robotts";

const state = robot.desktop.getState();

console.log({
  backend: state.capabilities.backend,
  desktop_bounds: state.desktopBounds,
  displays: state.displays,
  workspaces: state.workspaces,
  active_window: state.activeWindow,
});
```

List windows and displays:

```ts
import robot from "robotts";

for (const display of robot.desktop.listDisplays()) {
  console.log("display", display);
}

for (const window_item of robot.desktop.listWindows()) {
  console.log("window", {
    id: window_item.windowId,
    title: window_item.title,
    class_name: window_item.className,
    workspace_id: window_item.workspaceId,
    geometry: window_item.geometry,
  });
}
```

Resolve a window by title:

```ts
import robot from "robotts";

const target = robot.desktop.resolveWindowTarget({
  title_includes: "Visual Studio Code",
});

console.log(target);
```

Assert or focus a target:

```ts
import robot from "robotts";

const asserted = robot.desktop.assertWindowTarget({
  title_includes: "Firefox",
  require_active: false,
});

const focused = robot.desktop.focusWindow({
  title_includes: "Terminal",
});

console.log({ asserted, focused });
```

## Mouse Movement And Pathing

### Direct Mouse Movement

```ts
import robot from "robotts";

robot.moveMouse(800, 400);
robot.moveMouseSmooth(1000, 500, 2.5);
robot.dragMouse(1100, 500);
robot.scrollMouse(0, -200);
```

### Strict Targeted Mouse Movement

Move to a point relative to a window:

```ts
import robot from "robotts";

robot.desktop.moveMouseTarget({
  title_includes: "Terminal",
  x: 40,
  y: 40,
  relative_to: "window",
  require_active: true,
});
```

Click a target-relative point:

```ts
import robot from "robotts";

robot.desktop.mouseClickTarget({
  title_includes: "Terminal",
  x: 80,
  y: 80,
  relative_to: "window",
  button: "left",
  double: false,
  require_active: true,
});
```

### Path Movement Styles

Linear path with constant speed:

```ts
import robot from "robotts";

const result = robot.desktop.moveMousePath({
  relative_to: "global",
  x: 1200,
  y: 500,
  style: "linear",
  duration_ms: 120,
  steps: 16,
  speed_profile: "constant",
});

console.log(result);
```

Wavy path with deterministic geometry:

```ts
import robot from "robotts";

const result = robot.desktop.moveMousePath({
  relative_to: "global",
  x: 1400,
  y: 550,
  style: "wavy",
  duration_ms: 180,
  steps: 22,
  random_seed: "wave-demo-1",
  wave_amplitude: 14,
  wave_frequency: 2,
  speed_profile: "constant",
});

console.log(result);
```

Human-like path with humanized timing:

```ts
import robot from "robotts";

const result = robot.desktop.moveMousePath({
  relative_to: "global",
  x: 1500,
  y: 620,
  style: "human_like",
  duration_ms: 220,
  steps: 24,
  humanization_amount: 0.7,
  speed_profile: "humanized",
  speed_variation_amount: 0.45,
  min_step_delay_ms: 4,
  max_step_delay_ms: 24,
});

console.log(result);
```

Move and click at the end of a path:

```ts
import robot from "robotts";

const result = robot.desktop.mouseClickPath({
  relative_to: "global",
  x: 1300,
  y: 700,
  style: "linear",
  duration_ms: 100,
  steps: 12,
  speed_profile: "humanized",
  button: "left",
  double: false,
});

console.log(result);
```

## Keyboard Input

Basic keyboard actions:

```ts
import robot from "robotts";

robot.keyTap("a");
robot.keyTap("a", "shift");
robot.keyToggle("shift", "down");
robot.keyTap("tab");
robot.keyToggle("shift", "up");
robot.typeString("typed text");
robot.typeStringDelayed("slow typing", 240);
robot.unicodeTap(0x03A9);
```

Guarded keyboard input against a target window:

```ts
import robot from "robotts";

robot.desktop.keyTapTarget({
  title_includes: "Terminal",
  key: "a",
  modifier: "control",
});

robot.desktop.typeStringTarget({
  title_includes: "Terminal",
  text: "guarded text input",
});
```

`keyTapTarget()` and `typeStringTarget()` focus and verify the target unless you explicitly set `require_active: false`.

## Screen Capture And Pixel Access

Capture the full screen:

```ts
import robot from "robotts";

const bitmap = robot.screen.capture();
console.log(bitmap.width, bitmap.height);
```

Capture a region:

```ts
import robot from "robotts";

const bitmap = robot.screen.capture(100, 100, 300, 200);
console.log(bitmap.colorAt(10, 10));
```

Capture a specific display:

```ts
import robot from "robotts";

const displays = robot.desktop.listDisplays();
const secondary = displays.find((display) => !display.isPrimary);

if (secondary) {
  const bitmap = robot.screen.captureDisplay({
    display_id: secondary.id,
  });

  console.log(bitmap.width, bitmap.height);
}
```

Capture a target window:

```ts
import robot from "robotts";

const bitmap = robot.screen.captureWindow({
  title_includes: "Terminal",
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  require_active: true,
});

console.log(bitmap.width, bitmap.height);
```

## Window Locks

Lock to one concrete window and reuse that context:

```ts
import robot from "robotts";

const locked_window = robot.desktop.lockWindow({
  title_includes: "Terminal",
});

console.log(locked_window.getTarget());
locked_window.assert();
locked_window.focus();
```

Use window-relative movement and clicking:

```ts
import robot from "robotts";

const locked_window = robot.desktop.lockWindow({
  title_includes: "Terminal",
});

locked_window.moveMouse({
  x: 40,
  y: 40,
  require_active: true,
});

locked_window.mouseClick({
  x: 80,
  y: 80,
  button: "left",
  double: false,
  require_active: true,
});
```

Use path movement inside the locked window:

```ts
import robot from "robotts";

const locked_window = robot.desktop.lockWindow({
  title_includes: "Terminal",
});

const result = locked_window.moveMousePath({
  x: 120,
  y: 120,
  style: "human_like",
  duration_ms: 180,
  steps: 18,
  speed_profile: "humanized",
  require_active: true,
});

console.log(result);
```

Capture from the locked window:

```ts
import robot from "robotts";

const locked_window = robot.desktop.lockWindow({
  title_includes: "Terminal",
});

const bitmap = locked_window.capture({
  x: 0,
  y: 0,
  width: 128,
  height: 128,
  require_active: true,
});

console.log(bitmap.colorAt(5, 5));
```

Send text to the locked window:

```ts
import robot from "robotts";

const locked_window = robot.desktop.lockWindow({
  title_includes: "Terminal",
});

locked_window.keyTap({
  key: "a",
  modifier: "shift",
});

locked_window.typeString({
  text: "typed into the locked window",
});
```

## Seeding And Repeatability

### Static Seed For Reproducible Movement

```ts
import robot from "robotts";

const first = robot.desktop.moveMousePath({
  relative_to: "global",
  x: 1000,
  y: 500,
  style: "human_like",
  duration_ms: 160,
  steps: 18,
  random_seed: "fixed-seed-1",
  speed_profile: "humanized",
  include_effective_seed: true,
});

const second = robot.desktop.moveMousePath({
  relative_to: "global",
  x: 1000,
  y: 500,
  style: "human_like",
  duration_ms: 160,
  steps: 18,
  random_seed: "fixed-seed-1",
  speed_profile: "humanized",
  include_effective_seed: true,
});

console.log(first, second);
```

### Auto-Generated Seed

If you omit `random_seed`, RobotTS resolves a high-entropy effective seed automatically:

```ts
import robot from "robotts";

const result = robot.desktop.moveMousePath({
  relative_to: "global",
  x: 900,
  y: 450,
  style: "human_like",
  duration_ms: 160,
  steps: 18,
  speed_profile: "humanized",
  include_effective_seed: true,
});

console.log(result.effective_seed);
```

### Replay An Auto-Generated Seed

```ts
import robot from "robotts";

const first = robot.desktop.moveMousePath({
  relative_to: "global",
  x: 900,
  y: 450,
  style: "human_like",
  duration_ms: 160,
  steps: 18,
  speed_profile: "humanized",
  include_effective_seed: true,
});

const replay = robot.desktop.moveMousePath({
  relative_to: "global",
  x: 900,
  y: 450,
  style: "human_like",
  duration_ms: 160,
  steps: 18,
  speed_profile: "humanized",
  random_seed: first.effective_seed,
  include_effective_seed: true,
});

console.log({ first, replay });
```

## Multi-Monitor Examples

Move to the center of a specific display:

```ts
import robot from "robotts";

const displays = robot.desktop.listDisplays();
const secondary = displays.find((display) => !display.isPrimary);

if (!secondary) {
  throw new Error("No secondary display was found.");
}

robot.desktop.moveMousePath({
  relative_to: "global",
  x: secondary.x + Math.round(secondary.width / 2),
  y: secondary.y + Math.round(secondary.height / 2),
  style: "linear",
  duration_ms: 120,
  steps: 12,
});
```

Move to a window on a non-primary monitor:

```ts
import robot from "robotts";

const target = robot.desktop.resolveWindowTarget({
  title_includes: "Firefox",
  monitor_id: 1,
});

robot.desktop.moveMouseTarget({
  target,
  x: 100,
  y: 100,
  relative_to: "window",
  require_active: false,
});
```

## Safety And Fail-Closed Examples

Handle missing targets cleanly:

```ts
import robot from "robotts";

try {
  robot.desktop.resolveWindowTarget({
    title: "__definitely_not_a_real_window__",
  });
} catch (error) {
  console.error("target resolution failed:", error.message);
}
```

Handle unavailable strict verification:

```ts
import robot from "robotts";

const capabilities = robot.desktop.getCapabilities();

if (!capabilities.supportsStrictTargetVerification) {
  console.warn("Strict window targeting is unavailable in this Linux session.");
} else {
  const locked_window = robot.desktop.lockWindow({
    title_includes: "Terminal",
  });

  locked_window.focus();
}
```

## API Notes And Caveats

- Linux only. macOS and Windows are intentionally out of scope for this fork.
- The validated desktop path today is X11. Backend capability differences should be checked at runtime through `robot.desktop.getCapabilities()`.
- Window-relative coordinates use the outer window geometry, not a client-area-only coordinate system.
- Locked-window APIs fail closed if the target window disappears or cannot be verified.
- `mouseClickPath()` performs a real click after the path completes.
- `include_effective_seed` is optional. Omit it if you only care about movement behavior and not replay/debug logging.
- `random_seed` supports two modes:
  - pass a static seed for repeatability
  - omit it for an autogenerated effective seed
- Very small `duration_ms` values can be invalid for humanized timing if they fall below the minimum per-step delay budget.

## Development And Validation

Basic build flow:

```bash
npm install --ignore-scripts
npm_config_devdir=/tmp/node-gyp-cache npm run build
```

Useful checks:

```bash
node -c index.js
npm test
```

Native validation expectations for this fork:

- use focused live Linux testing against real applications where possible
- use `valgrind` for memory-safety validation on native changes
- use `helgrind` for timing/shared-state validation when relevant
- call out any untested backend or session limitations explicitly

Troubleshooting:

- `Could not open main display`
  - confirm `DISPLAY` is set correctly
  - confirm `XAUTHORITY` points at a valid X11 authority file
- missing windows or unsupported targeting
  - inspect `robot.desktop.getCapabilities()` and `robot.desktop.getState()`
- native build failures
  - verify Linux system packages are installed
  - verify Node 22+ and the explicit build flow above

## Personal Use Disclaimer

This code is primarily for my own purposes. It is not guaranteed to be stable, complete, or suitable for anyone else's environment.

If you choose to use this code, you do so at your own risk. I change this project as needed to suit my own workflow, and behavior, APIs, and implementation details may change at any time.
