# Repository Context

This document captures the current implementation shape of the repository so future work can start from verified repo facts instead of assumptions. It is intentionally descriptive, not normative. Durable policy lives in `AGENTS.md`.

## High-Level Architecture

- Package surface
  - `package.json` points CommonJS consumers to `index.js`, ESM consumers to `index.mjs`, and TypeScript consumers to `index.d.ts`.
  - The package currently targets Node `>=22` and builds a native addon through `node-gyp`.
- JavaScript wrapper layer
  - `index.js` is the main orchestration layer and is much larger than a thin binding wrapper.
  - It adds desktop/window targeting, locked-window helpers, mouse path generation, humanized typing and double-click behavior, clipboard-copy helpers, image-search source normalization, and bitmap wrappers on top of native exports.
  - `index.mjs` re-exports selected parts of the CommonJS surface and is currently narrower than `index.js`.
- Native addon layer
  - `src/robotjs.cc` is the N-API bridge. It exports native mouse, keyboard, screen, desktop-state, clipboard, bitmap-loading, and image-search functions.
  - The current validated desktop path is X11-oriented. `src/xdisplay.c` and `src/xdisplay.h` provide Linux display/window helpers used by desktop discovery and strict targeting.
- Supporting native subsystems
  - Mouse and keyboard injection: `src/mouse.c`, `src/keypress.c`, `src/keycode.c`, related headers
  - Screen capture and bitmap handling: `src/screen.c`, `src/screengrab.c`, `src/MMBitmap.c`, related headers
  - Image search and pixel/color helpers: `src/bitmap_find.c`, `src/color_find.c`, `src/png_io.c`, `src/bmp_io.c`, `src/io.c`
  - Clipboard and desktop utility paths: `src/pasteboard.c`, `src/alert.c`, `src/xdisplay.c`
- Test layout
  - `test/*.js` contains direct API tests for mouse, keyboard, screen, bitmap, and image-search behavior.
  - `test/integration/*.js` contains older live integration tests that drive a real UI fixture through `targetpractice`.

## Runtime Export Surface

The current runtime surface is grouped into four main areas.

- Top-level exports on `require('./')`
  - `ScopedWindowError`
  - Input and timing: `setKeyboardDelay`, `keyTap`, `keyToggle`, `unicodeTap`, `typeString`, `typeStringDelayed`, `typeStringHumanized`, `setMouseDelay`, `moveMouse`, `moveMouseSmooth`, `mouseClick`, `mouseToggle`, `dragMouse`, `scrollMouse`, `doubleClickHumanized`
  - Screen and state: `updateScreenMetrics`, `getMousePos`, `getPixelColor`, `getScreenSize`, `getDesktopState`, `focusWindow`
  - Native low-level helpers still directly exposed: `captureScreen`, `loadBitmapFromFile`, `findBitmap`, `findAllBitmaps`, `findFuzzyBitmap`, `getColor`, `getClipboardText`, `clearClipboardText`, `getXDisplayName`, `setXDisplayName`
  - Namespaced APIs: `desktop`, `screen`, `image_search`
- `desktop`
  - `getState`, `getCapabilities`, `listDisplays`, `listWorkspaces`, `listWindows`, `getActiveWindow`
  - `resolveWindowTarget`, `assertWindowTarget`, `focusWindow`, `lockWindow`
  - `moveMouseTarget`, `moveMousePath`, `mouseClickTarget`, `mouseClickPath`, `doubleClickTargetHumanized`
  - `keyTapTarget`, `typeStringTarget`, `typeStringTargetHumanized`
  - `copySelectionFromTarget`
- `screen`
  - `capture`, `captureWindow`, `captureDisplay`
- `image_search`
  - `loadReference`, `find`, `findAll`, `findFuzzy`

## Declared Type Surface

- `index.d.ts` is the only TypeScript file currently in the repository.
- The declarations model a richer TypeScript-first public API with:
  - base geometry, bitmap, desktop, workspace, window, and error types
  - namespaced `screen_api_i`, `image_search_api_i`, and `desktop_api_i`
  - locked-window flows, humanized input result types, clipboard-copy types, and image-search source/reference types
  - a default `robotts_api_t` export matching the package default import pattern shown in `README.md`
- Naming in `index.d.ts` already follows the repository's stated TypeScript conventions: `snake_case` type aliases with `_t`, `snake_case` interfaces with `_i`.

## Known Surface Drift To Expect

- Linux-only policy vs inherited cross-platform implementation
  - `binding.gyp` still contains macOS and Windows branches.
  - Multiple native C files still carry `IS_MACOSX` and `IS_WINDOWS` branches even though repo policy treats those paths as removable legacy code.
- TS-first goal vs current implementation reality
  - There is no TypeScript runtime source today. The implementation is still JavaScript-first with handwritten declarations in `index.d.ts`.
- CommonJS surface vs ESM surface
  - `index.js` exposes a broader API than `index.mjs`.
  - Examples of CommonJS-visible exports not re-exported by `index.mjs` include `image_search`, `typeStringHumanized`, `doubleClickHumanized`, and several native low-level helpers.
- Runtime surface vs declared type surface
  - The default typed API focuses on the higher-level wrapper surface and does not declare every low-level native helper exposed at runtime, such as `loadBitmapFromFile`, `findBitmap`, `findAllBitmaps`, `findFuzzyBitmap`, `getColor`, `getClipboardText`, `clearClipboardText`, `getXDisplayName`, and `setXDisplayName`.
  - This means consumers using undocumented runtime helpers may be able to call behavior that the main declaration surface does not promise.
- Tests vs current project direction
  - The test suite mixes `jasmine`-style specs and `tape`-style tests.
  - Integration tests still include older cross-platform assumptions, such as OS-specific scroll expectations and `targetpractice` fixture usage, even though the repo direction is Linux-only.

## Build And Packaging Notes

- Current build entrypoints in `package.json`
  - `install`, `build`, and `rebuild` all call `node-gyp rebuild`
  - `install-debug` calls `node-gyp rebuild --debug`
  - `test` runs `jasmine test/**/*.js`
- Current native dependency expectations from `README.md` and `binding.gyp`
  - X11, Xtst, Xrandr, png, and zlib development libraries are part of the Linux build path
  - `node-addon-api` is the runtime dependency for N-API headers
- Current package-layout fact
  - The package still ships a direct handwritten root-level surface rather than a `src/` TypeScript application layout or a generated typings pipeline

## Test And Validation Notes

- Unit-like tests
  - `test/mouse.js`, `test/keyboard.js`, `test/screen.js`, and `test/bitmap.js` exercise direct API behavior and argument validation.
  - `test/image-search.js` creates temporary PNG fixtures and exercises the search helpers without requiring a real desktop.
- Live integration tests
  - `test/integration/*.js` depends on the `targetpractice` fixture and a usable graphical session.
  - These tests are environment-sensitive and are not reliable evidence by themselves for Linux input authenticity.
- Validation policy already documented in repo
  - Native changes are expected to get focused Linux validation, including `valgrind` and `helgrind` when feasible.
  - Mouse and keyboard changes should be checked against real Linux applications where feasible, not just functional tests.

## Current Workspace Reality

The following facts were verified in this workspace during repository preparation:

- `node_modules/` exists.
- `build/Release/robotjs.node` exists.
- `node -c index.js` succeeds.
- Requiring the package succeeds in this shell session and exposes the runtime API groups listed above.
- `robot.getDesktopState()` and `robot.desktop.getCapabilities()` currently report an unavailable backend because the X display is not usable from this session.

Observed capability snapshot from this shell session:

```json
{
  "backend": "unavailable",
  "supportsGlobalInputInjection": false,
  "supportsWindowDiscovery": false,
  "supportsMonitorGeometry": false,
  "supportsWorkspaceIdentity": false,
  "supportsFocusChanges": false,
  "supportsStrictTargetVerification": false
}
```

The native layer also emitted `Could not open main display` during that check, which is consistent with the unavailable capability snapshot and means live desktop/input validation should be treated as blocked in the current shell context unless display access changes.

## Recommended Orientation Pass For Future Tasks

When starting a task in this repository, the highest-value read order is:

1. `AGENTS.md` for policy and validation expectations
2. `docs/repo_context.md` for current implementation facts and drift
3. `index.js`, `index.d.ts`, and `README.md` for public-surface behavior
4. `src/robotjs.cc` plus the relevant native subsystem files for backend details
5. `test/` files that exercise the specific surface being changed

Any public-surface change should be treated as a four-surface update unless the task explicitly says otherwise:

- runtime behavior
- TypeScript declarations
- tests
- user-facing documentation
