# RobotTS

RobotTS is a TypeScript-ready Linux desktop automation library for Node.js. It
provides native X11 mouse and keyboard control, window discovery and strict
window targeting, screen capture, exact and fuzzy image matching, continuously
watched PNG catalogs, global hotkeys, clipboard workflows, dialogs, and timing
utilities.

```ts
import robot from "@opsimathically/robotts";

const editor = robot.desktop.lockWindow({
  title_includes: "Text Editor",
});

editor.focus();
editor.moveMouse({ x: 160, y: 90 });
editor.mouseClick({ button: "left" });
editor.typeString({ text: "Automated with RobotTS" });
```

## Capabilities

| Area | Included capabilities |
| --- | --- |
| Desktop | Displays, workspaces, windows, active-window state, capabilities, and global coordinates |
| Window targeting | Exact or metadata-based selectors, fail-closed identity locks, window-relative coordinates, and scoped capture |
| Mouse | Move, drag, click, scroll, paths, image-guided movement, and deterministic humanization |
| Keyboard | Key taps, text, Unicode, shortcuts, humanized typing, and reference-counted held keys |
| Screen | Full desktop, display, region, or verified-window capture and pixel inspection |
| Image matching | Exact, multi-result, fuzzy, partial, bitmap, display, region, window, and locked-window searches |
| Catalog watching | Live PNG discovery, deduplication, image sets, exact or fuzzy sweeps, locked-window sources, callbacks, and metrics |
| Services | Desktop-wide X11 hotkeys, clipboard copy, message boxes, confirmation dialogs, sleeps, and random integers |

RobotTS ships CommonJS and ESM entry points plus its own TypeScript
declarations. No separate `@types` package is required.

## Platform Requirements

RobotTS supports:

- Linux
- Node.js 22 or newer
- An X11 desktop session, or applications exposed through XWayland where the
  required X11 behavior is available

RobotTS does not support macOS or Windows. Native Wayland input injection,
screen capture, window discovery, and global shortcuts are not provided.

The package contains a native addon and builds during installation. Install the
compiler toolchain and X11 development libraries first.

### Ubuntu And Debian

```bash
sudo apt update
sudo apt install \
  build-essential \
  python3 \
  pkg-config \
  libx11-dev \
  libxtst-dev \
  libxrandr-dev \
  libpng-dev \
  zlib1g-dev
```

### Fedora And RHEL

```bash
sudo dnf install \
  gcc-c++ \
  make \
  python3 \
  pkgconf-pkg-config \
  libX11-devel \
  libXtst-devel \
  libXrandr-devel \
  libpng-devel \
  zlib-devel
```

### Arch Linux

```bash
sudo pacman -S \
  base-devel \
  python \
  pkgconf \
  libx11 \
  libxtst \
  libxrandr \
  libpng \
  zlib
```

## Installation

```bash
npm install @opsimathically/robotts
```

ESM:

```ts
import robot from "@opsimathically/robotts";

console.log(robot.getMousePos());
```

CommonJS:

```js
const robot = require("@opsimathically/robotts");

console.log(robot.getMousePos());
```

The process must inherit a usable `DISPLAY` and permission to connect to that
X server.

## First Automation

This example inspects the desktop, locks one application by identity, performs
window-relative input, and captures the result:

```ts
import robot from "@opsimathically/robotts";

const capabilities = robot.desktop.getCapabilities();

if (
  !capabilities.supportsGlobalInputInjection ||
  !capabilities.supportsScreenCapture
) {
  throw new Error("The current X11 session cannot run this automation");
}

const target = robot.desktop.lockWindow({
  title_includes: "Text Editor",
});

target.focus();

target.mouseClick({
  x: 120,
  y: 80,
  button: "left",
  require_active: true,
});

target.typeString({
  text: "RobotTS is ready.",
  require_active: true,
});

const capture = target.capture({
  x: 0,
  y: 0,
  width: 640,
  height: 360,
  require_active: true,
});

console.log({
  target: target.getTarget(),
  capture_size: {
    width: capture.width,
    height: capture.height,
  },
});
```

## Desktop And Coordinates

Top-level input and capture methods use global desktop coordinates. A
multi-display desktop may include negative coordinates when a display is left
of or above the primary display.

```ts
import robot from "@opsimathically/robotts";

const state = robot.desktop.getState();

console.log(state.session);
console.log(state.capabilities);
console.log(state.desktopBounds);
console.log(state.currentWorkspaceId);
console.log(state.activeWindow);

for (const display of state.displays) {
  console.log({
    id: display.id,
    name: display.name,
    x: display.x,
    y: display.y,
    width: display.width,
    height: display.height,
    primary: display.isPrimary,
  });
}
```

Focused discovery methods are also available:

```ts
const displays = robot.desktop.listDisplays();
const workspaces = robot.desktop.listWorkspaces();
const windows = robot.desktop.listWindows();
const active_window = robot.desktop.getActiveWindow();
```

Call `robot.updateScreenMetrics()` after changing the X11 display arrangement
if subsequent legacy top-level screen operations need refreshed dimensions.

## Window Targeting

Window selectors can identify a window by:

- `window_id`
- exact `title`
- `title_includes`
- `class_name`
- `instance_name`
- `pid`
- `workspace_id`
- `monitor_id`
- `active_only`
- a previously resolved `target`

Resolve once when several operations should use the same target:

```ts
import robot from "@opsimathically/robotts";

const terminal = robot.desktop.resolveWindowTarget({
  class_name: "Gnome-terminal",
});

robot.desktop.assertWindowTarget({
  target: terminal,
});

robot.desktop.focusWindow({ target: terminal });

robot.desktop.moveMouseTarget({
  target: terminal,
  relative_to: "window",
  x: 80,
  y: 60,
});

robot.desktop.keyTapTarget({
  target: terminal,
  key: "l",
  modifier: "control",
});
```

Ambiguous selectors throw `ScopedWindowError`; RobotTS does not silently
select an arbitrary match.

### Locked Windows

`lockWindow()` resolves a window once and retains its X11 identity. Every
operation verifies that identity and reads current geometry. If the original
window disappears, or its ID is reused by another process or application
class, the handle fails closed instead of redirecting automation.

```ts
const editor = robot.desktop.lockWindow({
  title_includes: "Text Editor",
});

editor.focus();
editor.moveMouse({ x: 120, y: 80 });
editor.mouseClick({ x: 120, y: 80, button: "left" });
editor.keyTap({ key: "s", modifier: "control" });
editor.typeString({ text: "Window-scoped input" });
```

Coordinates accepted by locked-window methods are relative to the current
window origin. Spatial results provide both coordinate systems:

```ts
const geometry = editor.getGeometry();
console.log(geometry.geometry); // Global desktop rectangle
console.log(geometry.window_bounds); // Zero-origin window rectangle

const pointer = editor.getMousePos();
console.log(pointer.window_position);
console.log(pointer.global_position);
console.log(pointer.inside_window);

const global_point = editor.toGlobalPoint({
  x: 120,
  y: 80,
});

const local_point = editor.toWindowPoint({
  x: global_point.global_position.x,
  y: global_point.global_position.y,
});

const pixel = editor.getPixelColor({
  x: 120,
  y: 80,
});

console.log(local_point.window_position, pixel.color);
```

Conversions do not clamp out-of-window points. Such results retain their signed
coordinates and set `inside_window` to `false`. Pass
`{ require_active: true }` to observation or action methods when an inactive
target must be rejected.

## Mouse Automation

### Direct Control

```ts
import robot from "@opsimathically/robotts";

robot.setMouseDelay(10);

robot.moveMouse(400, 250);
robot.moveMouseSmooth(700, 400, 2);
robot.mouseClick("left");
robot.mouseClick("right");
robot.mouseClick("left", true);

robot.mouseToggle("down", "left");
robot.dragMouse(900, 500);
robot.mouseToggle("up", "left");

// Scroll values are horizontal and vertical X11 wheel-click counts.
robot.scrollMouse(0, -3);
```

Mouse buttons are `"left"`, `"middle"`, and `"right"`.

### Paths And Humanized Movement

`moveMousePath()` supports `"linear"`, `"wavy"`, and `"human_like"` paths:

```ts
const movement = robot.desktop.moveMousePath({
  relative_to: "global",
  x: 1200,
  y: 620,
  style: "human_like",
  duration_ms: 260,
  steps: 28,
  speed_profile: "humanized",
  speed_variation_amount: 0.4,
  humanization_amount: 0.7,
  min_step_delay_ms: 4,
  max_step_delay_ms: 24,
  random_seed: "checkout-submit",
  include_effective_seed: true,
});

console.log(movement.x, movement.y, movement.effective_seed);
```

Move through a path and click at a window-relative destination:

```ts
robot.desktop.mouseClickPath({
  title_includes: "Settings",
  relative_to: "window",
  x: 240,
  y: 180,
  style: "wavy",
  duration_ms: 180,
  steps: 20,
  wave_amplitude: 12,
  wave_frequency: 1.5,
  button: "left",
});
```

Locked-window handles provide the corresponding `moveMousePath()` and
`mouseClickPath()` methods.

## Keyboard Automation

### Keys, Shortcuts, And Text

```ts
import robot from "@opsimathically/robotts";

robot.setKeyboardDelay(20);

robot.keyTap("a");
robot.keyTap("a", "shift");
robot.keyTap("s", ["control", "shift"]);

robot.keyToggle("shift", "down");
robot.keyTap("tab");
robot.keyToggle("shift", "up");

robot.typeString("Plain text");
robot.typeStringDelayed("Typed at 240 characters per minute", 240);
robot.unicodeTap(0x03bb);
```

Supported modifiers include `alt`, `right_alt`, `command`, `control`,
`left_control`, `right_control`, `shift`, `right_shift`, and `none`. Named
navigation, editing, function, media, and numeric-keypad keys are supported,
along with single characters.

Targeted keyboard methods focus and verify a selected window by default:

```ts
robot.desktop.typeStringTarget({
  title_includes: "Text Editor",
  text: "Verified window input",
});

robot.desktop.keyTapTarget({
  title_includes: "Text Editor",
  key: "s",
  modifier: "control",
});
```

### Hold And Release Keys

Use a held-key handle when one or more keys must remain down across operations:

```ts
const held_keys = robot.desktop.holdKeysDown({
  keys: "ctrl+shift",
});

try {
  robot.keyTap("a");
} finally {
  held_keys.releaseKeys();
}
```

`keys` accepts a `+`-separated chord or an array. Aliases are normalized,
duplicates are removed, modifiers are pressed before ordinary keys, and keys
are released in reverse acquisition order.

Overlapping handles are reference-counted:

```ts
const first = robot.desktop.holdKeysDown({
  keys: "control+shift",
});
const second = robot.desktop.holdKeysDown({
  keys: ["ctrl", "alt"],
});

first.releaseKeys(); // Shift is released; control remains held.
second.releaseKeys(); // Alt and then control are released.
```

Acquire through a locked window when focus and identity must be verified before
the key-down sequence:

```ts
const editor = robot.desktop.lockWindow({
  title_includes: "Text Editor",
});

const held_keys = editor.holdKeysDown({
  keys: ["control", "shift"],
  require_active: true,
});

try {
  robot.keyTap("s");
} finally {
  held_keys.releaseKeys();
}
```

`releaseKeys()` is idempotent. RobotTS also installs best-effort process cleanup
while keys are owned and exposes `robot.desktop.releaseAllHeldKeys()` for
explicit emergency cleanup. Always use `try/finally`; cleanup cannot run after
`SIGKILL`, power loss, or a fatal native crash.

### Humanized Typing And Double Clicks

```ts
const typing = robot.typeStringHumanized({
  text: "Humanized timing can be replayed.",
  level: "medium",
  min_delay_ms: 40,
  max_delay_ms: 110,
  random_seed: "message-42",
  include_effective_seed: true,
});

const click = robot.desktop.doubleClickTargetHumanized({
  title_includes: "File Manager",
  relative_to: "window",
  x: 180,
  y: 140,
  button: "left",
  level: "medium",
  min_interval_ms: 70,
  max_interval_ms: 130,
  random_seed: "open-item",
  include_effective_seed: true,
});

console.log(typing.effective_seed, click.effective_seed);
```

Humanized movement, typing, and double clicks accept a `random_seed`. Omit the
seed and set `include_effective_seed: true` to generate varied behavior that can
still be replayed. `mistake_probability` is reserved and currently accepts only
`0`.

Use `robot.desktop.typeStringTargetHumanized()` or the locked-window
`typeStringHumanized()` method when humanized typing must be preceded by target
verification.

## Screen Capture

Capture the desktop, a region, a display, or a verified window:

```ts
import robot from "@opsimathically/robotts";

const desktop = robot.screen.capture();
const region = robot.screen.capture(100, 80, 640, 360);

const primary_display = robot.desktop
  .listDisplays()
  .find((display) => display.isPrimary);

if (!primary_display) {
  throw new Error("No primary display was reported");
}

const display = robot.screen.captureDisplay({
  display_id: primary_display.id,
});

const window_region = robot.screen.captureWindow({
  title_includes: "Browser",
  x: 0,
  y: 0,
  width: 900,
  height: 160,
  require_active: true,
});

console.log({
  desktop: [desktop.width, desktop.height],
  region: [region.width, region.height],
  display: [display.width, display.height],
  window: [window_region.width, window_region.height],
  sample_rgb: desktop.colorAt(0, 0),
});
```

A bitmap contains `width`, `height`, `image`, `byteWidth`, `bitsPerPixel`,
`bytesPerPixel`, and `colorAt(x, y)`. Capture regions are validated before
native code runs.

A locked window can capture its current bounds or a window-relative subregion:

```ts
const editor = robot.desktop.lockWindow({
  title_includes: "Text Editor",
});

const content = editor.capture({
  x: 0,
  y: 0,
  width: 600,
  height: 400,
  require_active: true,
});
```

## Image Search

RobotTS accepts PNG references or previously loaded bitmaps and can search:

- the full desktop
- a global region
- one display or a display-relative subregion
- a selected window or window-relative subregion
- a locked window
- an existing bitmap

### Reusable References

Decode and cache a PNG once when it will be used repeatedly:

```ts
const save_icon = robot.image_search.loadReference({
  png_path: "./images/save-button.png",
  use_cache: true,
});

console.log(save_icon.width, save_icon.height);
```

Every search accepts either reference form:

```ts
const png_reference = {
  png_path: "./images/save-button.png",
  use_cache: true,
};

const bitmap_reference = {
  bitmap: save_icon,
};
```

### Exact Search

```ts
const result = robot.image_search.find({
  source: {
    type: "screen",
  },
  reference: {
    png_path: "./images/save-button.png",
  },
  tolerance: 0,
});

if (result.found) {
  console.log({
    source_position: result.location,
    global_position: result.global_location,
    size: result.size,
    score: result.score,
  });
}
```

Find every accepted occurrence in a region:

```ts
const rows = robot.image_search.findAll({
  source: {
    type: "region",
    x: 100,
    y: 100,
    width: 800,
    height: 600,
  },
  reference: {
    png_path: "./images/list-row-marker.png",
  },
  tolerance: 0,
  max_results: 50,
});

for (const row of rows) {
  console.log(row.global_location);
}
```

### Fuzzy Search

Fuzzy search scores candidates when scaling, antialiasing, compositing, color
variation, or partial visibility prevents an exact match:

```ts
const result = robot.image_search.findFuzzy({
  source: {
    type: "display",
    display_id: 1,
  },
  reference: {
    png_path: "./images/status-indicator.png",
  },
  threshold: 0.9,
  tolerance: 0.1,
  allow_partial_match: true,
  minimum_overlap_ratio: 0.65,
  sample_step: 0,
  thread_count: "auto",
});

console.log({
  found: result.found,
  score: result.score,
  source_position: result.location,
  global_position: result.global_location,
  overlap_ratio: result.overlap_ratio,
  metrics: result.metrics,
});
```

| Option | Default | Meaning |
| --- | ---: | --- |
| `threshold` | `0.85` | Minimum aggregate similarity score from `0` to `1` |
| `tolerance` | `0.15` | Per-pixel color tolerance from `0` to `1` |
| `allow_partial_match` | `false` | Allow the reference to extend beyond the source |
| `minimum_overlap_ratio` | `0.6` | Minimum visible fraction accepted for a partial candidate |
| `sample_step` | `0` | Direct-search sample interval; `0` selects the native default |
| `thread_count` | `"auto"` | CPU budget: `"auto"` or an integer from `1` through `64` |

An unsuccessful fuzzy result may still include the best candidate and score.
Exact no-match results use `null` for unavailable match fields.

`thread_count: "auto"` uses up to eight logical CPUs available to the process.
An explicit count is reduced when necessary by the native scheduler.
`thread_count: 1` is strictly single-threaded. Thread count changes execution,
not result acceptance, score, ordering, or overlap semantics.

Direct fuzzy results expose:

- `candidate_offsets_evaluated`
- requested, available, and effective thread counts
- candidate scan and verification time
- thread-budget wait time
- total native elapsed time

No `UV_THREADPOOL_SIZE` configuration is required.

### Locked-Window Search

Locked handles keep search input and result coordinates relative to one verified
window:

```ts
const browser = robot.desktop.lockWindow({
  title_includes: "Browser",
});

const match = browser.findImageFuzzy({
  reference: {
    png_path: "./images/refresh-button.png",
  },
  threshold: 0.92,
  tolerance: 0.08,
  thread_count: 4,
  require_active: true,
});

if (match.found) {
  console.log(match.location); // Window-relative
  console.log(match.global_location); // Global desktop
}
```

Locked windows also expose `findImage()` and `findAllImages()`.

### Image-Guided Movement

Move to the center or top-left of a match, with optional offsets:

```ts
const movement = robot.desktop.moveMousePathToImageFuzzy({
  source: {
    type: "window",
    title_includes: "Browser",
    require_active: true,
  },
  reference: {
    png_path: "./images/confirm-button.png",
  },
  threshold: 0.92,
  tolerance: 0.1,
  thread_count: "auto",
  match_anchor: "center",
  offset_x: 0,
  offset_y: 0,
  style: "human_like",
  duration_ms: 220,
  steps: 24,
  random_seed: "confirm-action",
  include_effective_seed: true,
});

if (!movement.moved) {
  console.log("No accepted match", movement.match);
}
```

Exact and immediate variants are available as `moveMouseToImage()` and
`moveMousePathToImage()`. Locked handles expose all four image-guided movement
methods. A raw bitmap source cannot be used for movement because it has no
global desktop origin.

## Watched Image Catalogs

`robot.desktop.watchImageCatalog()` continuously searches a desktop source
against a recursively discovered PNG directory. It is intended for workflows
that repeatedly look for many interface states.

Each sweep:

1. Runs `on_before_sweep` once.
2. Captures each selected display once, or captures one locked window once.
3. Searches the complete active catalog.
4. Emits match, no-match, and satisfied-set events according to repeat policy.
5. Waits `check_period_ms` after the search finishes before beginning the next
   sweep.

The catalog service watches PNG additions, changes, renames, and deletions.
Decoded images remain in memory, and pixel-identical PNGs are deduplicated
under one content ID while every path is retained as an alias.

### Display Watcher

```ts
import robot from "@opsimathically/robotts";

const abort_controller = new AbortController();

const watcher = await robot.desktop.watchImageCatalog({
  image_dir: "./watch-images",
  source: {
    type: "displays",
    display_ids: [0, 1],
  },
  check_period_ms: 500,
  signal: abort_controller.signal,
  matching: {
    mode: "fuzzy",
    threshold: 0.9,
    tolerance: 0.1,
    candidate_step: 1,
    max_results_per_image: 100,
    max_candidates_per_image: 1_000_000,
    thread_count: "auto",
  },

  on_before_sweep(event) {
    console.log("sweep", event.statistics.sweeps + 1);
  },

  on_matches_found(event) {
    for (const match of event.matches) {
      console.log("aliases", match.image.aliases);

      for (const occurrence of match.occurrences) {
        console.log({
          display_id: occurrence.display.id,
          display_position: occurrence.display_position,
          global_position: occurrence.global_position,
          score: occurrence.score,
        });
      }
    }

    console.log(event.native_metrics);
  },

  on_no_matches_found(event) {
    console.log(event.reason);
  },

  on_catalog_changed(event) {
    console.log({
      added: event.added_paths,
      changed: event.changed_paths,
      deleted: event.deleted_paths,
      diagnostics: event.diagnostics,
    });
  },

  on_error(event) {
    console.error(
      event.error.code,
      event.error.recoverable,
      event.error.message,
    );
  },
});

setTimeout(() => abort_controller.abort(), 30_000);

const completion = await watcher.completion;
console.log(completion.reason, completion.statistics);
```

`on_matches_found` is required. Every callback may return `"CONTINUE"`,
`"EXIT"`, or nothing. Returning `"EXIT"` ends the watcher normally and does not
throw. Omitting `source` searches all displays. The compatibility
`display_ids` option can be used at the top level only when `source` is omitted.

`on_no_matches_found` fires when the entire active catalog has no accepted
matches. Its reason is `"no_match"` or `"empty_catalog"`.

### Locked-Window Watcher

Use a locked source to constrain every sweep to one verified window:

```ts
const order_window = robot.desktop.lockWindow({
  title_includes: "Order Entry",
});

const watcher = await robot.desktop.watchImageCatalog({
  image_dir: "./watch-images",
  source: {
    type: "locked_window",
    locked_window: order_window,
    require_active: false,
  },
  check_period_ms: 250,
  matching: {
    mode: "fuzzy",
    threshold: 0.9,
    tolerance: 0.08,
    candidate_step: 1,
    thread_count: 4,
  },

  on_before_sweep(event) {
    if (event.source.type === "locked_window") {
      console.log(event.source.target.windowId);
      console.log(event.source.geometry);
    }
  },

  on_matches_found(event) {
    for (const match of event.matches) {
      for (const occurrence of match.occurrences) {
        if (occurrence.source_type === "locked_window") {
          console.log({
            window_position: occurrence.window_position,
            display_position: occurrence.display_position,
            global_position: occurrence.global_position,
          });
        }
      }
    }

    if (event.source.type === "locked_window") {
      event.source.locked_window.assert();
    }
  },
});

await watcher.completion;
```

Every callback receives a source snapshot. For a locked source it includes the
exact handle passed at startup, its target metadata, current verified geometry,
and the active-window policy. Window movement and resizing are reflected in the
next sweep.

If `require_active` is `true`, an inactive window is a recoverable sweep error.
If the original window disappears or strict identity verification becomes
unavailable, the watcher stops with `LOCKED_WINDOW_UNAVAILABLE`; it never falls
back to a broader desktop capture.

### Image Sets

A named image set is satisfied when every distinct member has at least one
accepted occurrence in the same sweep:

```ts
const watcher = await robot.desktop.watchImageCatalog({
  image_dir: "./watch-images",
  image_sets: [
    {
      name: "confirmation-dialog",
      members: [
        "dialogs/title.png",
        "dialogs/message.png",
        "dialogs/confirm-button.png",
      ],
    },
    {
      name: "signed-in-header",
      members: ["header/logo.png", "header/account-menu.png"],
    },
  ],
  on_matches_found() {},
  on_image_sets_found(event) {
    for (const image_set of event.sets) {
      console.log(image_set.name);

      for (const member of image_set.members) {
        console.log(
          member.image.aliases,
          member.occurrences.map((item) => item.global_position),
        );
      }
    }
  },
  on_catalog_changed(event) {
    for (const diagnostic of event.diagnostics) {
      console.warn(diagnostic.code, diagnostic.message);
    }
  },
});
```

Members may use relative catalog paths. Bare filenames are accepted only when
they identify one deduplicated image. Missing or ambiguous members produce
catalog diagnostics. Set evaluation reuses ordinary match results and does not
generate combinations of occurrences.

### Repeat And Callback Policies

| Repeat mode | Behavior |
| --- | --- |
| `changes_only` | Default. Emit when images, positions, scores, sets, or match state change |
| `every_sweep` | Emit after every completed sweep |
| `transition_only` | Emit only when moving between matches and no matches |
| `throttled` | Emit changes immediately and unchanged state after `interval_ms` |

```ts
const watcher = await robot.desktop.watchImageCatalog({
  image_dir: "./watch-images",
  repeat: {
    mode: "throttled",
    interval_ms: 5000,
  },
  on_matches_found(event) {
    console.log(event.statistics.sweeps);
  },
});
```

Callbacks are serial by default and apply backpressure. Concurrent callbacks
allow later sweeps to proceed while application work remains pending:

```ts
const watcher = await robot.desktop.watchImageCatalog({
  image_dir: "./watch-images",
  callback_mode: "concurrent",
  max_pending_callbacks: 4,
  callback_error_policy: "continue",
  on_matches_found: async (event) => {
    await persistMatches(event.matches);
  },
  on_error(event) {
    console.error(event.error);
  },
});

async function persistMatches(matches: unknown): Promise<void> {
  await robot.sleep({ milliseconds: 50 });
  console.log(matches);
}
```

`on_before_sweep` and `on_catalog_changed` remain serial control points. A
callback exception stops the watcher by default.
`callback_error_policy: "continue"` reports the failure and continues.

### Cancellation And Typed Context

`stop()` is idempotent. The first stop, abort, or callback `"EXIT"` wins:

```ts
const completion_a = watcher.stop();
const completion_b = watcher.stop();

console.log(completion_a === completion_b); // true
await completion_a;
```

Application data can be typed and passed to every callback:

```ts
type watcher_context_t = {
  workflow_id: string;
  attempt: number;
};

const watcher = await robot.desktop.watchImageCatalog<watcher_context_t>({
  image_dir: "./watch-images",
  extra: {
    workflow_id: "checkout",
    attempt: 1,
  },
  on_matches_found(event, robot_instance, extra) {
    console.log(extra.workflow_id, extra.attempt);
    console.log(robot_instance.getMousePos(), event.matches);
  },
});
```

### Fuzzy Catalog Performance

Fuzzy catalog matching is implemented in the native C++ addon. A sweep builds a
shared catalog index, traverses each source capture once to qualify candidate
offsets for the complete catalog, and then performs full scoring only on
qualified candidates. Distinctive reference signals and bounded evidence
workspaces reduce unnecessary verification on large captures.

`matching.thread_count` controls the CPU budget for the complete watcher:

- `1` forces single-threaded matching.
- `"auto"` uses up to eight logical CPUs available to the process.
- Integers from `1` through `64` request an explicit budget.
- The native process-wide scheduler prevents concurrent direct searches and
  watchers from oversubscribing the logical CPUs available to Node.
- Multi-display watchers capture all selected displays first, then search them
  sequentially with the one requested sweep budget.

`candidate_step: 1` is exhaustive for ordinary non-partial fuzzy catalog
matching. Increasing it performs less index work but can miss valid candidates;
this is an explicit speed-versus-recall choice. Thread count does not change
accepted matches, scores, ordering, limits, or candidate-limit behavior.

Representative catalog timings on an Intel Core i7-14700KF with 28 logical CPUs
available to the process:

| Threads | Median native time |
| ---: | ---: |
| 1 | 246 ms |
| 2 | 129 ms |
| 4 | 69 ms |
| 8 | 44 ms |

The fixture is a 960 x 540 bitmap, sixteen 24 x 24 references, a `0.9`
threshold, `0.08` tolerance, and exhaustive `candidate_step: 1`. Direct fuzzy
search over a 960 x 540 source and one 32 x 32 reference measured approximately
283 ms with one thread and 98 ms with eight threads on the same machine.
Results depend on image entropy, capture size, thresholds, overlap settings,
CPU topology, and concurrent work; these values are reference measurements,
not guarantees.

Watcher `native_metrics` separate:

- capture, bitmap-copy, queue, and thread-budget wait time
- candidate scan, extraction, and verification time
- fingerprint collisions and evidence votes
- generated and verified candidate counts
- compared pixels, workspace bytes, and result construction
- requested, available, and effective thread counts

Use the metrics to tune the actual workload instead of assuming that adding
threads is always the dominant improvement. Benchmark methodology and metric
definitions are in
[Fuzzy Matching Performance](./docs/fuzzy_matching_performance.md).

### Limits And Failure Behavior

```ts
const watcher = await robot.desktop.watchImageCatalog({
  image_dir: "./watch-images",
  catalog_debounce_ms: 200,
  max_file_size_bytes: 32 * 1024 * 1024,
  max_catalog_images: 5000,
  max_total_decoded_bytes: 256 * 1024 * 1024,
  max_consecutive_errors: 3,
  callback_error_policy: "stop",
  on_matches_found() {},
  on_catalog_changed(event) {
    console.log(event.diagnostics);
  },
  on_error(event) {
    console.error(event.error);
  },
});
```

Watcher defaults:

| Option | Default |
| --- | ---: |
| `check_period_ms` | `1000` |
| `catalog_debounce_ms` | `150` |
| `max_file_size_bytes` | `64 MiB` |
| `max_catalog_images` | `10000` |
| `max_total_decoded_bytes` | `512 MiB` |
| `max_consecutive_errors` | `3` |
| `callback_mode` | `serial` |
| `max_pending_callbacks` | `8` |
| `callback_error_policy` | `stop` |

Operational behavior:

- Invalid configuration, a missing initial directory, an invalid locked handle,
  unavailable capture, or no selected displays rejects startup.
- Symlinks are not followed.
- Malformed, unreadable, oversized, or actively changing PNGs are quarantined.
- A previously valid path retains its last known-good decode until a valid
  replacement is ready.
- Recoverable capture and watcher failures use bounded retry and backoff.
- Reaching `max_consecutive_errors` stops the watcher and rejects `completion`.
- Callback failures are captured and do not become unhandled rejections.

For fuzzy mode, the defaults are `threshold: 0.85`, `tolerance: 0.15`,
`allow_partial_match: false`, `minimum_overlap_ratio: 0.6`,
`candidate_step: 1`, `max_results_per_image: 100`,
`max_candidates_per_image: 1_000_000`, and `thread_count: "auto"`.

## Global Hotkeys

Register a desktop-wide X11 key combination and receive a lifecycle handle:

```ts
import robot from "@opsimathically/robotts";

const registration = await robot.registerHotkey({
  name: "open-command-menu",
  hotkey: "alt+space",
  extra: {
    source: "example",
  },
  async on_pressed(event, robot_instance, extra) {
    console.log(event.type);
    console.log(event.name);
    console.log(event.hotkey);
    console.log(event.sequence);
    console.log(extra.source);

    await robot_instance.showMessageBox({
      title: "RobotTS",
      message: "The global hotkey was pressed.",
    });
  },
  on_error(event) {
    console.error(event.error.code, event.error.details);
  },
});

console.log(registration.name, registration.hotkey, registration.active);

// Later:
await registration.unregister();
await registration.completion;
```

Hotkey strings contain zero or more modifiers and exactly one main key,
separated by `+`. Modifiers are normalized:

| Canonical modifier | Accepted aliases |
| --- | --- |
| `ctrl` | `ctrl`, `control` |
| `alt` | `alt`, `option` |
| `shift` | `shift` |
| `super` | `super`, `meta`, `win`, `command`, `cmd` |

Main keys include letters, digits, `f1` through `f35`, common navigation and
editing keys, lock keys, and named punctuation. For example,
`SHIFT + control + J` normalizes to `ctrl+shift+j`.

Callbacks are serial per registration by default. Use
`callback_mode: "concurrent"` for independent presses and bound active or
queued work with `max_pending_callbacks`. The default callback error policy is
`"unregister"`; use `"continue"` to report the failure and retain the
registration.

```ts
const controller = new AbortController();

const registration = await robot.registerHotkey({
  name: "temporary-action",
  hotkey: "super+f9",
  signal: controller.signal,
  callback_mode: "serial",
  max_pending_callbacks: 8,
  callback_error_policy: "continue",
  on_pressed() {
    console.log("Temporary action");
  },
});

controller.abort();
await registration.completion;
```

Keyboard auto-repeat is suppressed until the main key is released. Global
hotkeys use exclusive X11 passive grabs, so the combination is normally
consumed rather than delivered to the focused application. Registration fails
with `HOTKEY_CONFLICT` when the combination is already owned.

## Clipboard

`copySelectionFromTarget()` focuses and verifies a target, sends `Ctrl+C`, and
waits for non-empty clipboard text:

```ts
const result = await robot.desktop.copySelectionFromTarget({
  title_includes: "Text Editor",
  timeout_ms: 2000,
  poll_interval_ms: 50,
  clear_clipboard: true,
});

console.log(result.data);
console.log(result.context);
```

A callback can transform the result:

```ts
const selected_length = await robot.desktop.copySelectionFromTarget({
  title_includes: "Text Editor",
  callback(result) {
    return result.data.trim().length;
  },
});

console.log(selected_length);
```

Locked windows expose `copySelection()` with the same timeout, polling,
clearing, and callback behavior. Clipboard access uses the native X11 path when
available and can fall back to `xclip` or `xsel`.

## Timing, Random Values, And Dialogs

Durations are additive:

```ts
await robot.sleep({
  seconds: 1,
  milliseconds: 250,
});

await robot.sleepRandom({
  minimum: {
    milliseconds: 400,
  },
  maximum: {
    seconds: 1,
    milliseconds: 200,
  },
});
```

Both sleep methods accept an `AbortSignal`.

`randomIntegerBetween()` returns an unbiased integer including both bounds:

```ts
const roll = robot.randomIntegerBetween(1, 6);
```

Display informational text or request a confirmation:

```ts
await robot.showMessageBox({
  title: "RobotTS",
  message: "The operation is complete.",
});

const choice = await robot.showConfirmationDialog({
  title: "RobotTS",
  message: "Continue with the next operation?",
});

if (choice === "confirm") {
  console.log("Confirmed");
}
```

Dialog providers are tried in this order: `zenity`, `kdialog`, and `xmessage`.
The confirmation result is `"confirm"` or `"cancel"`.

## Error Handling

RobotTS validates public inputs before native work and uses focused error
classes for recoverable application decisions.

### Window Errors

```ts
import robot, {
  ScopedWindowError,
} from "@opsimathically/robotts";

try {
  robot.desktop.mouseClickTarget({
    title_includes: "Critical Application",
    x: 100,
    y: 100,
    relative_to: "window",
    require_active: true,
  });
} catch (error) {
  if (error instanceof ScopedWindowError) {
    console.error(error.code, error.details);
  } else {
    throw error;
  }
}
```

Representative codes include `WINDOW_NOT_FOUND`, `WINDOW_NOT_ACTIVE`,
`WINDOW_IDENTITY_MISMATCH`, `WINDOW_TARGET_NOT_FOUND`,
`WINDOW_TARGET_AMBIGUOUS`, `WINDOW_FOCUS_FAILED`,
`WINDOW_GEOMETRY_UNAVAILABLE`, `WINDOW_VERIFICATION_UNSUPPORTED`,
`CLIPBOARD_UNAVAILABLE`, and `CLIPBOARD_TIMEOUT`.

### Service Errors

- `ImageCatalogWatcherError` exposes `code`, `details`, and `recoverable`.
- `DialogError` distinguishes `DIALOG_UNAVAILABLE` from `DIALOG_FAILED`.
- `HotkeyError` reports backend availability, conflicts, invalid keys,
  callback failures, and callback queue exhaustion.
- `HeldKeyError` reports acquisition, release, and cleanup failures.

```ts
import robot, {
  DialogError,
  HotkeyError,
} from "@opsimathically/robotts";

try {
  await robot.showMessageBox({
    message: "Waiting for input.",
  });
} catch (error) {
  if (error instanceof DialogError) {
    console.error(error.code, error.details);
  } else {
    throw error;
  }
}

try {
  await robot.registerHotkey({
    name: "example",
    hotkey: "ctrl+alt+r",
    on_pressed() {},
  });
} catch (error) {
  if (error instanceof HotkeyError) {
    console.error(error.code, error.details);
  } else {
    throw error;
  }
}
```

## API Map

### Top-Level

| Method | Purpose |
| --- | --- |
| `registerHotkey(options)` | Register a desktop-wide X11 hotkey |
| `randomIntegerBetween(min, max)` | Return an integer including both bounds |
| `sleep(options)` | Wait for an additive duration |
| `sleepRandom(options)` | Wait for a random duration in an inclusive range |
| `showMessageBox(options)` | Show a dismissible text dialog |
| `showConfirmationDialog(options)` | Show a confirm/cancel dialog |
| `setMouseDelay(ms)` | Set delay after native mouse events |
| `moveMouse(x, y)` | Move to global coordinates |
| `moveMouseSmooth(x, y, speed?)` | Move with native smoothing |
| `dragMouse(x, y)` | Drag to global coordinates |
| `mouseClick(button?, double?)` | Click a mouse button |
| `mouseToggle(state?, button?)` | Press or release a mouse button |
| `scrollMouse(x, y)` | Emit horizontal and vertical wheel clicks |
| `doubleClickHumanized(options?)` | Double-click with configurable timing |
| `setKeyboardDelay(ms)` | Set delay after native key events |
| `keyTap(key, modifiers?)` | Press and release a key |
| `keyToggle(key, state, modifiers?)` | Press or release a key |
| `unicodeTap(code_point)` | Type one Unicode code point |
| `typeString(text)` | Type text |
| `typeStringDelayed(text, cpm)` | Type at a target character rate |
| `typeStringHumanized(options)` | Type with varied, replayable timing |
| `getMousePos()` | Return the global pointer position |
| `getPixelColor(x, y)` | Return a six-character RGB hex string |
| `getScreenSize()` | Return X11 desktop dimensions |
| `getDesktopState()` | Return session, display, workspace, and window state |
| `updateScreenMetrics()` | Refresh legacy screen dimensions after a display-layout change |
| `focusWindow(window_id)` | Focus a window directly by X11 ID |

### Namespaces

| Namespace | Methods |
| --- | --- |
| `robot.screen` | `capture`, `captureWindow`, `captureDisplay` |
| `robot.image_search` | `loadReference`, `find`, `findAll`, `findFuzzy` |
| `robot.desktop` | Discovery, target resolution, window locks, targeted input, paths, held keys, image-guided movement, clipboard copy, and `watchImageCatalog` |

### Locked Window

| Group | Methods |
| --- | --- |
| Identity | `getTarget`, `assert`, `focus` |
| Coordinates | `getGeometry`, `getMousePos`, `getPixelColor`, `toGlobalPoint`, `toWindowPoint` |
| Input | `holdKeysDown`, `moveMouse`, `moveMousePath`, `mouseClick`, `mouseClickPath`, `keyTap`, `typeString` |
| Humanization | `typeStringHumanized`, `doubleClickHumanized` |
| Image matching | `findImage`, `findAllImages`, `findImageFuzzy` |
| Image movement | `moveMouseToImage`, `moveMousePathToImage`, `moveMouseToImageFuzzy`, `moveMousePathToImageFuzzy` |
| Data | `capture`, `copySelection` |

The complete public contract, event payloads, result types, and option types are
defined in [`index.d.ts`](./index.d.ts).

## Source Checkout

Install dependencies and build:

```bash
npm install
npm run build
```

Run unit tests, TypeScript contract tests, and build verification:

```bash
npm test
```

Desktop and live tests interact with the active graphical session:

```bash
npm run test:desktop
npm run test:live
```

Run all configured validation:

```bash
npm run test:all
```

Benchmark native fuzzy matching:

```bash
npm run benchmark:fuzzy-catalog -- --threads=1,2,4,8,auto
npm run benchmark:fuzzy-direct -- --threads=1,2,4,8,auto
```

Add `--full` to `benchmark:fuzzy-catalog` for its full-HD, 50-image fixture.
Benchmark output is newline-delimited JSON.

## Troubleshooting

### Native Build Failure

Verify the runtime and native libraries:

```bash
node --version
npm --version
python3 --version
pkg-config --exists x11 xtst xrandr libpng zlib
```

Rebuild with lifecycle output:

```bash
npm rebuild @opsimathically/robotts --foreground-scripts
```

If node-gyp cannot use its normal cache:

```bash
npm_config_devdir=/tmp/node-gyp-cache \
  npm rebuild @opsimathically/robotts --foreground-scripts
```

### Cannot Open The Display

```bash
printf 'DISPLAY=%s\n' "${DISPLAY:-}"
printf 'XAUTHORITY=%s\n' "${XAUTHORITY:-}"
```

Running through `sudo`, SSH, cron, a service manager, or a container commonly
changes the X11 environment and permissions.

### Window Discovery Is Empty

```ts
console.log(robot.desktop.getCapabilities());
console.log(robot.desktop.getState().session);
```

Complete window and workspace discovery requires the window manager to expose
standard EWMH properties.

### Clipboard Copy Is Unavailable

Install an X11 clipboard fallback:

```bash
sudo apt install xclip
```

`xsel` is also supported.

### Text Dialogs Are Unavailable

Install a supported provider:

```bash
sudo apt install zenity
```

Inspect `DialogError.code` and `DialogError.details` to distinguish a missing
provider from a runtime failure.

### Hotkey Registration Fails

`HOTKEY_BACKEND_UNAVAILABLE` means RobotTS could not start its X11 listener.
`HOTKEY_CONFLICT` means another registration, application, window manager, or
desktop environment owns the combination. Hotkeys use the active X11 keymap at
registration time; unregister and register again after changing layouts.

### TypeScript Cannot Resolve The Package

Use Node-style ESM or CommonJS module resolution and a current Node type
package. RobotTS includes its own declarations.

## License

RobotTS is released under the [MIT License](./LICENSE.md).

## Project Status

This code is maintained for the repository owner's personal purposes. It is not
guaranteed to be stable or complete.

Anyone using this code does so at their own risk. The repository and package may
change at any time to suit the owner's evolving needs.
