# RobotTS

RobotTS is a Linux-only, TypeScript-oriented fork of RobotJS for desktop automation, screen capture, Linux desktop awareness, strict window targeting, and window-relative automation flows.

This fork is focused on:

- Linux-native behavior instead of cross-platform support
- strict and fail-closed window targeting
- typed APIs for mouse, keyboard, screen, displays, workspaces, and windows
- deterministic or auto-randomized mouse paths
- humanized cursor movement through geometry and speed variation
- humanized typing rhythm and humanized double-click timing
- scoped clipboard-copy helpers with callback context

The currently validated path is X11-backed Linux. Wayland capability differences should be expected and checked at runtime through `robot.desktop.getCapabilities()`.

RobotTS expects a real graphical session for live input and capture work. If no usable X display is available, desktop discovery may report `unavailable`, and movement or capture calls can fail.

## Capabilities At A Glance

- Move, click, drag, scroll, and inspect the mouse cursor
- Type text, tap keys, toggle keys, and send Unicode input
- Capture the full screen, a display, or a window region
- Search screen content with exact or fuzzy bitmap matching
- Inspect displays, workspaces, windows, and the active window
- Resolve, assert, and focus strict Linux window targets
- Lock automation to one concrete window and use window-relative coordinates
- Move the cursor with `linear`, `wavy`, and `human_like` paths
- Use constant or humanized path speed profiles
- Use static seeds for repeatability or omit seeds for auto-generated randomness
- Use structured scoped-window errors instead of ambiguous generic failures

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

Recommended first-run bootstrap from a fresh checkout:

```bash
./build.sh
```

The bootstrap script checks that you are on Linux, verifies the required toolchain and native development libraries, sets `npm_config_devdir` automatically, installs Node dependencies with scripts disabled when needed, builds the native addon, and then runs safe post-build verification.

Available verification commands:

```bash
npm run verify:build
npm run verify:live
npm run verify:all
```

`verify:build` is non-invasive and is already run by `./build.sh`. `verify:live` is opt-in, opens a local verification harness window, moves the mouse, clicks, and types text to prove live input injection is working. The live verifier needs a real Linux GUI session and Python Tk support such as `python3-tk`.

If you prefer the low-level manual flow, use the explicit steps below.

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

### Image-Match Movement

Move directly to the center of an exact image match:

```ts
import robot from "robotts";

const result = robot.desktop.moveMouseToImage({
  source: {
    type: "screen",
  },
  reference: {
    png_path: "./fixtures/login-button.png",
  },
});

if (result.moved) {
  console.log(result.destination, result.match.global_location);
}
```

Move along a human-like path to a fuzzy match using offsets:

```ts
import robot from "robotts";

const result = robot.desktop.moveMousePathToImageFuzzy({
  source: {
    type: "screen",
  },
  reference: {
    png_path: "./fixtures/status-badge.png",
  },
  threshold: 0.9,
  tolerance: 0.12,
  match_anchor: "top_left",
  offset_x: 12,
  offset_y: 8,
  style: "human_like",
  duration_ms: 200,
  steps: 20,
  speed_profile: "humanized",
  include_effective_seed: true,
});

if (!result.moved) {
  console.log("image was not accepted", result.match.score);
}
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

Humanized typing with seeded or auto-generated timing:

```ts
import robot from "robotts";

const typing_result = robot.typeStringHumanized({
  text: "humanized text output",
  level: "medium",
  include_effective_seed: true,
});

console.log(typing_result);
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

Humanized guarded typing against a verified window:

```ts
import robot from "robotts";

const result = robot.desktop.typeStringTargetHumanized({
  title_includes: "Terminal",
  text: "humanized guarded text input",
  level: "low",
  include_effective_seed: true,
});

console.log(result);
```

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

## Image Search

RobotTS exposes native-backed image search through `robot.image_search`. Reference images can come from either:

- a RobotTS bitmap that already exists in memory
- a PNG file path that is loaded once and reused

Exact search from a bitmap reference:

```ts
import robot from "robotts";

const haystack = robot.screen.capture();
const reference = robot.screen.capture(100, 100, 64, 64);

const result = robot.image_search.find({
  source: {
    type: "bitmap",
    bitmap: haystack,
  },
  reference: {
    bitmap: reference,
  },
  tolerance: 0,
});

if (result.found) {
  console.log(result.location, result.size);
}
```

Exact search from a PNG reference:

```ts
import robot from "robotts";

const result = robot.image_search.find({
  source: {
    type: "screen",
  },
  reference: {
    png_path: "./fixtures/button.png",
  },
  tolerance: 0.05,
});

if (result.found) {
  console.log("found", result.global_location);
}
```

When the search source maps back to the real desktop, `location` is relative to the searched source and `global_location` is the absolute screen coordinate for the match origin. The image-based mouse movement helpers use that absolute coordinate plus the selected anchor and offsets.

Load and reuse a PNG reference across multiple searches:

```ts
import robot from "robotts";

const reference_bitmap = robot.image_search.loadReference({
  png_path: "./fixtures/icon.png",
});

const first = robot.image_search.find({
  source: {
    type: "screen",
  },
  reference: {
    bitmap: reference_bitmap,
  },
});

const second = robot.image_search.find({
  source: {
    type: "display",
    display_id: 1,
  },
  reference: {
    bitmap: reference_bitmap,
  },
});

console.log({ first, second });
```

Get every exact match instead of only the first one:

```ts
import robot from "robotts";

const matches = robot.image_search.findAll({
  source: {
    type: "screen",
  },
  reference: {
    png_path: "./fixtures/repeated-icon.png",
  },
  max_results: 10,
});

for (const match of matches) {
  console.log(match.location, match.score);
}
```

Fuzzy search for near matches with palette or small rendering variance:

```ts
import robot from "robotts";

const result = robot.image_search.findFuzzy({
  source: {
    type: "screen",
  },
  reference: {
    png_path: "./fixtures/status-indicator.png",
  },
  threshold: 0.9,
  tolerance: 0.15,
  allow_partial_match: true,
  minimum_overlap_ratio: 0.75,
  sample_step: 2,
});

if (result.found) {
  console.log("fuzzy match", {
    score: result.score,
    location: result.location,
    overlap_ratio: result.overlap_ratio,
  });
}
```

`threshold` is the minimum accepted confidence in the `0..1` range. Fuzzy search always evaluates candidates as "best score wins", and `score` reports the best measured confidence for the returned candidate. When partial matching is enabled, `size` reflects the actual matched overlap inside the searched source and `overlap_ratio` reports how much of the reference image was covered.

Search inside a strict target window:

```ts
import robot from "robotts";

const result = robot.image_search.find({
  source: {
    type: "window",
    title_includes: "Terminal",
    require_active: true,
  },
  reference: {
    png_path: "./fixtures/prompt.png",
  },
});

console.log(result);
```

Search inside a locked window:

```ts
import robot from "robotts";

const locked_window = robot.desktop.lockWindow({
  title_includes: "Firefox",
});

const exact_match = locked_window.findImage({
  reference: {
    png_path: "./fixtures/toolbar-button.png",
  },
  x: 0,
  y: 0,
  width: 500,
  height: 150,
  require_active: true,
});

const fuzzy_match = locked_window.findImageFuzzy({
  reference: {
    png_path: "./fixtures/toolbar-button.png",
  },
  threshold: 0.92,
  tolerance: 0.1,
  allow_partial_match: true,
  require_active: true,
});

console.log({ exact_match, fuzzy_match });
```

Move to a match inside a locked window:

```ts
import robot from "robotts";

const locked_window = robot.desktop.lockWindow({
  title_includes: "Firefox",
});

const move_result = locked_window.moveMousePathToImage({
  reference: {
    png_path: "./fixtures/toolbar-button.png",
  },
  match_anchor: "center",
  style: "human_like",
  duration_ms: 180,
  steps: 18,
});

console.log(move_result);
```

Handle the typed no-match result:

```ts
import robot from "robotts";

const result = robot.image_search.find({
  source: {
    type: "screen",
  },
  reference: {
    png_path: "./fixtures/does-not-exist-on-screen.png",
  },
});

if (!result.found) {
  console.log("no match", {
    source_type: result.source_type,
    reference_type: result.reference_type,
    score: result.score,
    location: result.location,
  });
}
```

For exact searches, a true no-match result keeps `score` and `location` as `null`. For fuzzy searches, `found: false` can still include the best candidate's `score`, `location`, `size`, and `overlap_ratio` when nothing cleared the requested threshold.

The image-based mouse movement methods return a combined result with `found`, `moved`, `match`, and `destination`. If no accepted match exists, they return `moved: false`, keep the search result in `match`, and do not move the mouse.

Scoped window searches still fail closed. If a targeted or locked window disappears, RobotTS throws a structured scoped-window error instead of silently searching some other window.

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

Use humanized typing, clipboard copy, and humanized double-clicks in a locked window:

```ts
import robot from "robotts";

const locked_window = robot.desktop.lockWindow({
  title_includes: "Editor",
});

const typing_result = locked_window.typeStringHumanized({
  text: "humanized locked-window text",
  level: "medium",
  include_effective_seed: true,
});

const copy_result = await locked_window.copySelection({
  require_active: true,
  timeout_ms: 2000,
  poll_interval_ms: 75,
});

const double_click_result = locked_window.doubleClickHumanized({
  x: 220,
  y: 120,
  level: "medium",
  include_effective_seed: true,
  require_active: true,
});

console.log({ typing_result, copy_result, double_click_result });
```

Use the callback form when you want to process the copied text immediately:

```ts
import robot from "robotts";

const result = await robot.desktop.copySelectionFromTarget({
  title_includes: "Editor",
  timeout_ms: 2000,
  poll_interval_ms: 75,
  callback: async ({ data, context }) => {
    return {
      line_count: data.split("\n").length,
      title: context.window.title,
      backend: context.backend,
      copy_method: context.copy_method,
    };
  },
});

console.log(result);
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

Handle structured scoped-window failures:

```ts
import robot from "robotts";

try {
  robot.desktop.typeStringTargetHumanized({
    title: "__definitely_not_a_real_window__",
    text: "never sent",
  });
} catch (error) {
  if (error instanceof robot.ScopedWindowError) {
    console.error(error.code, error.details);
  } else {
    throw error;
  }
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
- Scoped target failures throw `ScopedWindowError` with a stable `code` and optional `details`.
- `mouseClickPath()` performs a real click after the path completes.
- `typeStringHumanized()` varies per-character timing, but it does not currently simulate typo-and-correction behavior.
- `doubleClickHumanized()` sends two real clicks with a humanized interval that stays within a conservative double-click range.
- `copySelectionFromTarget()` and `locked_window.copySelection()` clear the clipboard first, then send `Ctrl+C`, then poll for plain-text clipboard data.
- Clipboard-copy helpers fail closed with a timeout if the target app never publishes non-empty text to the clipboard after `Ctrl+C`.
- `include_effective_seed` is optional. Omit it if you only care about movement behavior and not replay/debug logging.
- `random_seed` supports two modes:
  - pass a static seed for repeatability
  - omit it for an autogenerated effective seed
- Very small `duration_ms` values can be invalid for humanized timing if they fall below the minimum per-step delay budget.

## Development And Validation

Basic build flow:

```bash
./build.sh
```

Low-level equivalent:

```bash
npm install --ignore-scripts
npm_config_devdir=/tmp/node-gyp-cache npm run build
npm run verify:build
```

Useful checks:

```bash
node -c index.js
npm test
npm run verify:build
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
  - `./build.sh` checks build prerequisites and sets `npm_config_devdir` automatically
- desktop runtime failures after a successful build
  - `DISPLAY` and `XAUTHORITY` affect runtime desktop automation, not native compilation
- live verification failures
  - `npm run verify:live` requires a real graphical Linux session
  - verify Python Tk support is installed, for example with `python3-tk`
  - the live verifier intentionally moves the mouse and types into its own harness window

## Personal Use Disclaimer

This code is primarily for my own purposes. It is not guaranteed to be stable, complete, or suitable for anyone else's environment.

If you choose to use this code, you do so at your own risk. I change this project as needed to suit my own workflow, and behavior, APIs, and implementation details may change at any time.
