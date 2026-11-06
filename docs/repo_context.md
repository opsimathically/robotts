# Repository Context

This document describes the current package architecture, implementation boundaries, and verification tools.

## High-Level Architecture

- Package surface
  - The public npm package is `@opsimathically/robotts`.
  - `package.json` points CommonJS consumers to `index.js`, ESM consumers to `index.mjs`, and TypeScript consumers to `index.d.ts`.
  - The package is explicitly Linux-only, targets Node `>=22`, and builds a native addon through `node-gyp`.
- JavaScript wrapper layer
  - `index.js` is the main orchestration layer and is much larger than a thin binding wrapper.
  - It adds desktop/window targeting, locked-window spatial utilities and coordinate conversion, held-key acquisition, mouse path generation, humanized typing and double-click behavior, clipboard-copy helpers, image-search source normalization, watched image-catalog orchestration, system utilities, and bitmap wrappers on top of native exports.
  - `lib/image_catalog_watcher.js` owns recursive catalog generations, display and strict locked-window sources, filesystem reconciliation, lifecycle, event dispatch, repeat policies, coordinate mapping, and multi-image set evaluation.
  - `lib/system_utilities.js` owns unbiased random integer generation, cancellable delays, and asynchronous Linux text dialogs through installed desktop dialog providers.
  - `lib/hotkey_manager.js` owns hotkey parsing, registration lifecycles, callback scheduling, cancellation, and structured errors.
  - `lib/held_key_manager.js` owns held-key parsing, transactional acquisition, process-wide shared-key ownership, deterministic release, and process cleanup hooks.
  - `index.mjs` re-exports the documented high-level CommonJS namespaces, errors, and top-level helpers.
- Native addon layer
  - `src/robotjs.cc` is the internal N-API bridge. It provides native mouse, keyboard, screen, desktop-state, clipboard, bitmap-loading, image-search, and asynchronous catalog-matcher functions to the JavaScript wrapper.
  - `src/bitmap_catalog.cc` owns the immutable shared fingerprint index, distinctive-pixel fuzzy evidence filtering, and bounded parallel single-traversal exact/fuzzy catalog search.
  - `src/native_thread_budget.cc` coordinates process-wide native fuzzy-search concurrency so simultaneous watchers and direct searches do not oversubscribe available logical CPUs.
  - `src/hotkey_manager.cc` owns a dedicated X11 connection and listener thread for passive key grabs and event delivery to Node.
  - The current validated desktop path is X11-oriented. `src/xdisplay.c` and `src/xdisplay.h` provide Linux display/window helpers used by desktop discovery and strict targeting.
- Supporting native subsystems
  - Mouse and keyboard injection: `src/mouse.c`, `src/keypress.c`, `src/keycode.c`, related headers
  - Screen capture and bitmap handling: `src/screen.c`, `src/screengrab.c`, `src/MMBitmap.c`, related headers
  - Image search and pixel/color helpers: `src/bitmap_find.c`, `src/color_find.c`, `src/png_io.c`, `src/bmp_io.c`, `src/io.c`
  - Clipboard and desktop utility paths: `src/pasteboard.c`, `src/alert.c`, `src/xdisplay.c`
- Test layout
  - `test/*.js` contains direct API tests for mouse, keyboard, screen, bitmap, and image-search behavior.
  - `scripts/verify-live.js` drives a dedicated Tk harness for controlled live input verification.

## Runtime Export Surface

The current runtime surface is grouped into timing/dialog helpers, input/state helpers, and three namespaces.

- Top-level exports on `require('./')`
  - Errors: `ScopedWindowError`, `ImageCatalogWatcherError`, `DialogError`, `HeldKeyError`
  - Global hotkeys: `registerHotkey`, `HotkeyError`
  - Random values, timing, and dialogs: `randomIntegerBetween`, `sleep`, `sleepRandom`, `showMessageBox`, `showConfirmationDialog`
  - Input and timing: `setKeyboardDelay`, `keyTap`, `keyToggle`, `unicodeTap`, `typeString`, `typeStringDelayed`, `typeStringHumanized`, `setMouseDelay`, `moveMouse`, `moveMouseSmooth`, `mouseClick`, `mouseToggle`, `dragMouse`, `scrollMouse`, `doubleClickHumanized`
  - Screen and state: `updateScreenMetrics`, `getMousePos`, `getPixelColor`, `getScreenSize`, `getDesktopState`, `focusWindow`
  - Namespaced APIs: `desktop`, `screen`, `image_search`
- `desktop`
  - `getState`, `getCapabilities`, `listDisplays`, `listWorkspaces`, `listWindows`, `getActiveWindow`
  - `resolveWindowTarget`, `assertWindowTarget`, `focusWindow`, `lockWindow`
  - `holdKeysDown`, `releaseAllHeldKeys`
  - Locked handles provide refreshed geometry, local/global mouse and pixel positions, bidirectional point conversion, and held-key acquisition in addition to scoped automation.
  - `moveMouseTarget`, `moveMousePath`, `mouseClickTarget`, `mouseClickPath`, `doubleClickTargetHumanized`
  - `keyTapTarget`, `typeStringTarget`, `typeStringTargetHumanized`
  - `copySelectionFromTarget`
  - `watchImageCatalog`
- `screen`
  - `capture`, `captureWindow`, `captureDisplay`
- `image_search`
  - `loadReference`, `find`, `findAll`, `findFuzzy`

## Declared Type Surface

- `index.d.ts` remains the handwritten public declaration surface; `test/types/` contains strict compile-time contract fixtures, while there is still no TypeScript runtime source.
- The declarations model a richer TypeScript-first public API with:
  - base geometry, bitmap, desktop, workspace, window, and error types
  - namespaced `screen_api_i`, `image_search_api_i`, and `desktop_api_i`
  - locked-window flows, humanized input result types, clipboard-copy types, image-search source/reference types, and generic watched-catalog session/events
  - a default `robotts_api_t` export matching the package default import pattern shown in `README.md`
- Naming in `index.d.ts` already follows the repository's stated TypeScript conventions: `snake_case` type aliases with `_t`, `snake_case` interfaces with `_i`.

## Known Implementation Boundaries

- Linux-only policy vs inherited cross-platform implementation
  - `binding.gyp` is Linux-only and links the X11, Xtst, Xrandr, PNG, and zlib libraries directly.
  - Multiple native C files still carry `IS_MACOSX` and `IS_WINDOWS` branches even though repo policy treats those paths as removable legacy code.
- TS-first goal vs current implementation reality
  - There is no TypeScript runtime source today. The implementation is still JavaScript-first with handwritten declarations in `index.d.ts`.
- CommonJS surface vs ESM surface
  - Documented high-level namespaces and helpers are available from both entrypoints.
- Runtime surface vs declared type surface
  - The supported CommonJS, ESM, and TypeScript surfaces are kept aligned.
  - Low-level N-API helpers remain internal to `index.js` and are not re-exported by the package entrypoint.
- Tests vs current project direction
  - The maintained live integration path is Linux-specific and uses the local Tk verification harness.

## Build And Packaging Notes

- Current build entrypoints in `package.json`
  - `install`, `build`, and `rebuild` all call `node-gyp rebuild`
  - `install-debug` calls `node-gyp rebuild --debug`
  - `test` runs deterministic unit tests, strict declaration checks, and safe build verification
  - `test:desktop` runs read-only screen and bitmap specs
  - `test:live` runs the controlled Tk live verifier
  - `test:all` runs all maintained test layers
  - `test:types` compiles the declaration contract under strict TypeScript settings
  - `benchmark:image-catalog` verifies fixed haystack traversal work as synthetic catalog size grows
  - `benchmark:fuzzy-catalog` records fuzzy catalog latency and native work metrics across configurable thread counts
  - `benchmark:fuzzy-direct` records direct fuzzy-search latency and native work metrics across configurable thread counts
  - `verify:hotkey-native` exercises native listener creation, X11 grabs, event delivery, conflicts, unregistering, and teardown
  - `prepublishOnly` rebuilds the addon and runs deterministic unit and type checks
- Current native dependency expectations from `README.md` and `binding.gyp`
  - X11, Xtst, Xrandr, png, and zlib development libraries are part of the Linux build path
  - `node-addon-api` is the runtime dependency for N-API headers
- Current package-layout fact
  - The package still ships a direct handwritten root-level surface rather than a `src/` TypeScript application layout or a generated typings pipeline
  - npm tarballs contain only runtime wrappers, declarations, native build sources, README, changelog, license, and package metadata

## Test And Validation Notes

- Unit-like tests
  - `test/mouse.js`, `test/keyboard.js`, `test/screen.js`, and `test/bitmap.js` exercise direct API behavior and argument validation.
  - `test/image-search.js` creates temporary PNG fixtures and exercises the search helpers without requiring a real desktop.
  - `test/image-catalog-watcher.js` covers native batch matching, catalog generations, deduplication, sets, display and locked-window sources, per-sweep geometry updates, cancellation, callback bounds, filesystem updates, and failure paths.
  - `test/held-key-manager.js` covers chord parsing, transactional acquisition, shared ownership, release failures, cleanup-hook lifecycles, and real child-process exit and signal behavior.
- Live integration tests
  - `scripts/verify-live.js` starts `scripts/live_verification_harness.py` and verifies mouse movement, clicking, keyboard input, desktop and locked-window held keys, pixel reads, screen capture, and display/locked-window watched-catalog matching against that dedicated window.
  - The locked-window live case includes an outside matching decoy and a same-title replacement window. It verifies source scoping, window/global coordinates, callback handle identity, and fail-closed replacement behavior.
  - Live verification requires a usable graphical session and Python Tk support.
  - Functional harness results are not sufficient evidence by themselves for Linux input authenticity in third-party applications.
- Validation policy already documented in repo
  - Native changes are expected to get focused Linux validation, including `valgrind` and `helgrind` when feasible.
  - Mouse and keyboard changes should be checked against real Linux applications where feasible, not just functional tests.
