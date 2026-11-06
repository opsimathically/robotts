# Changelog

All notable changes to RobotTS are documented here.

## 0.0.6 - 2026-07-30

### Fixed

- Fuzzy catalog fingerprint selection now groups nearby antialiasing shades and
  adapts its evidence target for low-entropy references, preventing common
  screen colors from flooding the candidate limit without changing match
  acceptance semantics

## 0.0.5 - 2026-07-30

### Added

- Configurable `thread_count` controls for direct fuzzy search and watched fuzzy catalogs, including an `"auto"` mode
- Native catalog and direct-search timing, work, memory, and effective-thread metrics
- A repeatable fuzzy catalog benchmark covering `1`, `2`, `4`, `8`, and automatic thread selection

### Changed

- Fuzzy catalog candidate generation now uses a dense color index, squared-distance filtering, immediate evidence qualification, and bounded native parallel scanning
- Watched display sources apply one CPU budget across the complete sweep
- Concurrent native fuzzy searches share a process-wide hardware budget to prevent CPU oversubscription
- Direct fuzzy search evaluates source ranges in parallel while preserving deterministic best-match selection

## 0.0.4 - 2026-07-30

### Added

- Locked-window spatial utilities for refreshed geometry, local mouse and pixel positions, bidirectional coordinate conversion, and explicit inside-window state
- Same-ID locked-window identity checks that reject X11 window reuse by a different process or application class
- Desktop and locked-window held-key handles with normalized chords, deterministic release, shared-key ownership, and structured failures
- Synchronous emergency held-key cleanup for natural exit, explicit exit, uncaught exceptions, and controllable termination signals

### Fixed

- Locked-window click helpers now apply the documented left-button and single-click defaults before calling the native addon

## 0.0.3 - 2026-07-30

### Fixed

- Fuzzy catalog matching now qualifies offsets with multiple distinctive pixel signals before applying the candidate limit, preventing incidental full-HD color hits from exhausting the default budget

## 0.0.2 - 2026-07-30

### Added

- Strict locked-window catalog sources with per-sweep identity verification and window-relative match coordinates

## 0.0.1 - 2026-07-30

### Added

- Linux X11 desktop, display, workspace, and window discovery
- Strict window targeting and reusable locked-window sessions
- Humanized and deterministic mouse paths, typing, and double-click timing
- Screen, display, window, and region capture APIs
- Exact, multiple-result, fuzzy, and partial image search
- Image-guided mouse movement
- Recursive watched PNG catalogs with live filesystem updates
- Shared native catalog matching, normalized-image deduplication, and multi-image sets
- Unbiased inclusive random integer generation across JavaScript's safe-integer range
- Cancellable exact and randomized asynchronous timing utilities
- Asynchronous Linux text message boxes and confirmation dialogs
- Desktop-wide X11 hotkeys with typed callbacks and explicit lifecycle handles
- CommonJS, ESM, and strict TypeScript package surfaces

### Changed

- Published package name is `@opsimathically/robotts`
- The supported platform is explicitly Linux X11
- Native builds use a Linux-only node-gyp configuration
- Public runtime exports now match the documented TypeScript API
- Screen capture rejects incomplete, invalid, and out-of-bounds regions
- Native and development dependencies were updated for the release

### Removed

- Unsupported macOS and Windows build configurations
- Undocumented low-level native binding exports from the package entrypoint
