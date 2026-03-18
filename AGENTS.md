# AGENTS.md

## Purpose

This repository is a Linux-only fork-in-progress focused on turning RobotJS into a TypeScript-first project while improving the reliability, capability, and Linux-native quality of the underlying native code.

This file defines the operating contract for agents working in this repository. Follow it as repo-local policy.

## Project Priorities

Agents working in this repository should optimize for these goals:

1. Make the package fully typed for TypeScript.
2. Improve the reliability of the native C/C++ implementation.
3. Improve capability where the current public API or internal architecture is limiting.
4. Optimize for Linux behavior, Linux-native input fidelity, and Linux-native maintainability.
5. Keep package layout and dependency decisions reversible until the refactor direction is stable.

## Linux-Only Platform Policy

This fork targets Linux only.

macOS and Windows support are out of scope, unwanted, and not part of the project goals.

Agents must treat Linux as the only supported target operating system for design, implementation, validation, and documentation decisions.

This means:

- do not preserve non-Linux compatibility as a design constraint
- do not spend effort extending or testing macOS or Windows support
- treat existing macOS and Windows code as removable legacy code
- optimize future design decisions for Linux behavior, Linux-native implementation quality, and Linux application compatibility

Agents are explicitly authorized to remove non-Linux code, build branches, compatibility layers, and abstractions whose only purpose is preserving dropped operating systems.

If removing old macOS or Windows code improves clarity, correctness, authenticity, or maintainability, that cleanup is aligned with project goals.

## Current Repo Shape

The current layout matters, but it is not a long-term architecture commitment.

- The native Node addon entrypoint is currently `src/robotjs.cc`.
- The current JavaScript wrapper is `index.js`.
- The current handwritten type declarations are `index.d.ts`.
- The native build definition is `binding.gyp`.
- The current tests live under `test/` and cover mouse, keyboard, screen, and integration behavior.

Treat these as the present implementation, not as a frozen design target.

## API And Package Evolution

Agents are explicitly authorized to redesign the public API, package layout, module structure, typings layout, and surrounding developer experience when that improves usability, capability, maintainability, or correctness.

Do not treat the current `index.js` or `index.d.ts` surface as a compatibility boundary for this fork.

If you redesign a public interface, the same change must also update all relevant surfaces in one cohesive pass:

- exported runtime behavior
- TypeScript types
- tests
- README or other user-facing API documentation

Do not leave the repository in a partially migrated state where runtime behavior, types, tests, and docs disagree.

## Dependency And Bootstrap Policy

Do not start by running `npm install`, `node-gyp`, bootstrap commands, or dependency churn by default.

Dependency installation and build bootstrapping should be deferred until a task actually requires build, test, or runtime verification. This project is still in a refactor phase, and package structure, scripts, and dependencies may change as the design evolves.

When installation becomes necessary, keep the change scoped to the immediate task and avoid locking in unnecessary package decisions early.

## TypeScript Conventions

When writing TypeScript in this repository, follow these naming and interface conventions exactly:

- Type aliases use `snake_case` and end with `_t`.
- Interfaces use `snake_case` and end with `_i`.
- Variables use `snake_case`.
- Standalone functions use PascalCase.
- Classes use PascalCase.
- Class methods use camelCase.
- If a function or method takes parameters, prefer passing a single object parameter.
- If a function or method takes no parameters, do not require an empty object.

Additional TypeScript expectations:

- Prefer explicit types over `any`.
- Introduce `any` only when there is a concrete interoperability reason and no practical typed alternative for the current step.
- Keep types aligned with actual runtime behavior.
- Avoid declaration files that promise behavior the runtime does not implement.

## Security And Quality Expectations

Default to secure-by-default implementations.

This includes:

- validate inputs at API boundaries
- reject invalid states early
- avoid implicit coercions where they weaken correctness
- handle native-memory and buffer interactions carefully
- avoid introducing unsafe filesystem, process, or shell behavior without a justified need
- preserve clear failure behavior instead of silently ignoring errors

When changing native code, prioritize correctness, maintainability, and Linux-native behavior over preserving legacy cross-platform branches. Do not keep portability layers solely to retain dead macOS or Windows support.

## Authentic Input Design Goal

This fork still covers RobotJS-style automation such as moving the mouse, clicking, right-clicking, pressing keys, holding keys, releasing keys, and typing text.

For mouse and keyboard automation, the highest-priority product goal is not merely functional event injection. The goal is for Linux target applications to perceive emitted input as authentic local Linux mouse and keyboard activity as closely as the platform allows.

Agents must treat this as a hard design rule for native input work:

- prioritize app-authentic Linux-native event behavior over convenience-driven shortcuts
- evaluate changes based on how real Linux target applications are likely to perceive the event stream, not only whether the operating system API call succeeds
- prefer the most Linux-native event path reasonably available on the current platform
- avoid implementation shortcuts that are more likely to be ignored, downgraded, filtered, or handled differently by real applications

This policy applies to the native input backends implemented through the platform event layers in the C/C++ codebase, not just to the TypeScript wrapper or public API shape.

It covers:

- mouse move, drag, click, right-click, button press, button release, and scroll behavior
- keyboard key down, key up, modifiers, shortcuts, repeated presses, and text-entry behavior
- sequencing, focus interaction, layout translation, and event-shape details that may affect whether applications accept the input as real local interaction

When authenticity, maintainability, and performance conflict, do not silently choose the easiest implementation. Make the tradeoff explicit on a case-by-case basis.

If a less-authentic event path is chosen, document:

- why it was chosen
- what application-compatibility risk remains
- whether the compromise is Linux-specific or more general

## Workflow Expectations

Before making changes:

- inspect the current implementation first
- understand the affected JS, TS, native, test, and documentation surfaces
- identify whether the task is local cleanup or public-surface redesign

When touching public API or package shape:

- prefer a coherent redesign over incremental patchwork
- make the intended direction explicit in code, docs, and naming
- avoid preserving poor legacy behavior solely for compatibility

When making changes:

- keep runtime, typings, tests, and docs cohesive
- avoid partial migrations that strand duplicate entrypoints or contradictory interfaces
- actively remove obsolete macOS and Windows code when touching related areas
- do not preserve build logic, abstractions, or native branches that only exist for dropped operating systems
- for mouse and keyboard backend work, weigh changes against the authentic-input goal before optimizing for convenience, speed, or superficial API uniformity

## Validation Expectations

For future implementation work, validation should match the kind of change being made:

- Public API changes must be validated against the affected tests under `test/`.
- Typing work is not complete until the type surface itself has been validated in a meaningful way.
- Native changes must be validated against Linux behavior, Linux display/input paths, and Linux-native runtime expectations.
- Mouse and keyboard injection changes must include live testing against real Linux applications or a focused Linux repro app when feasible.
- Functional tests alone are not sufficient validation for authenticity-sensitive input behavior.
- If an input path was code-reviewed or functionally tested but not validated in a real application context, record that validation gap explicitly.

Do not claim a refactor is complete if validation only covered one layer of the change.

## Native Memory And Concurrency Validation

For native changes touching C, C++, N-API bindings, buffer ownership, allocation/free paths, shared global state, threading assumptions, or timing-sensitive behavior, agents must include focused live testing for memory safety and concurrency issues when feasible.

Linux is the primary supported path for this tooling in this repository.

On Linux, native validation is expected to include:

- `valgrind` for memory leaks, invalid reads or writes, use-after-free, double-free, and similar undefined-behavior risks
- `helgrind` for race conditions, lock misuse, and thread-ordering issues when the changed path plausibly involves concurrency, mutable process-wide state, display handles, global delays, or other timing-sensitive behavior

Focused execution is preferred over blanket instrumentation:

- run the smallest relevant Node/native scenario that exercises the changed path
- reuse an existing test under `test/` when it directly covers the path
- if no existing test is narrow enough, create or describe a small repro harness in the task plan before implementing it

Keep the results actionable:

- prefer targeted runs that minimize unrelated Node or system-library noise
- when noise obscures results, use suppressions or documented filtering so findings can be attributed clearly
- distinguish confirmed addon findings from likely external runtime noise

Completion expectations for native work:

- a native task is not fully validated if it only passes functional tests but skips feasible memory or race checking
- if `valgrind` or `helgrind` cannot be run, say why and explicitly mark the validation gap

This policy is intentionally workflow-first. Agents may use ad hoc commands, targeted test invocations, or temporary repro harnesses as needed. Do not force permanent `package.json` scripts or CI wiring unless the task specifically requires that follow-up work.

## Documentation Policy

If `README.md` is edited, preserve or add a bottom section stating all of the following:

- the code is for the repository owner's personal purposes
- the code is not guaranteed to be stable
- anyone using it does so at their own risk
- the repository may change at any time to suit the owner's evolving needs

This is a hard requirement for README updates in this fork.

## Decision Defaults

Unless the task explicitly says otherwise, use these defaults:

- prefer workflow-first guidance over prematurely locking a final architecture
- prefer thoughtful redesign over legacy API preservation
- prefer reversible decisions while the refactor is still taking shape
- prefer explicit, secure, typed interfaces over permissive legacy behavior
