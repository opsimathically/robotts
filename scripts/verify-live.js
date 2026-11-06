#!/usr/bin/env node
'use strict';

const child_process = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const zlib = require('node:zlib');

const repo_root = path.resolve(__dirname, '..');
const harness_path = path.join(__dirname, 'live_verification_harness.py');
const expected_text = 'robotts-live-check';
const harness_title = 'RobotTS Verification Harness';
const results = [];
const wait_poll_ms = 100;

function Crc32(buffer)
{
	let crc = 0xFFFFFFFF;
	for (let index = 0; index < buffer.length; index += 1)
	{
		crc ^= buffer[index];
		for (let bit = 0; bit < 8; bit += 1)
		{
			crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
		}
	}
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

function PngChunk(type, data)
{
	const type_buffer = Buffer.from(type, 'ascii');
	const length = Buffer.alloc(4);
	const crc = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	crc.writeUInt32BE(Crc32(Buffer.concat([type_buffer, data])), 0);
	return Buffer.concat([length, type_buffer, data, crc]);
}

function WriteSolidPng(output_path, hex_color)
{
	const width = 2;
	const height = 2;
	const red = Number.parseInt(hex_color.slice(0, 2), 16);
	const green = Number.parseInt(hex_color.slice(2, 4), 16);
	const blue = Number.parseInt(hex_color.slice(4, 6), 16);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const rows = [];
	for (let y = 0; y < height; y += 1)
	{
		rows.push(Buffer.from([0, red, green, blue, red, green, blue]));
	}
	fs.writeFileSync(output_path, Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		PngChunk('IHDR', ihdr),
		PngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
		PngChunk('IEND', Buffer.alloc(0))
	]));
}

function LogResult(result)
{
	const prefix = '[' + result.status.toUpperCase() + ']';
	const detail = result.detail ? ': ' + result.detail : '';
	console.log(prefix + ' ' + result.name + detail);
	results.push(result);
}

function Pass(name, detail)
{
	LogResult({
		status: 'pass',
		name: name,
		detail: detail || ''
	});
}

function Fail(name, detail)
{
	LogResult({
		status: 'fail',
		name: name,
		detail: detail || ''
	});
}

function Finish()
{
	const summary = {
		pass: 0,
		fail: 0
	};

	results.forEach(function(result)
	{
		summary[result.status] += 1;
	});

	console.log('');
	console.log('Live verification summary: pass=' + summary.pass + ' fail=' + summary.fail);

	process.exit(summary.fail > 0 ? 1 : 0);
}

function Delay(ms)
{
	return new Promise(function(resolve)
	{
		setTimeout(resolve, ms);
	});
}

async function MoveMouseAndVerify(robot, point)
{
	let mouse_position = null;
	for (let attempt = 0; attempt < 3; attempt += 1)
	{
		robot.moveMouse(point.x, point.y);
		await Delay(150);
		mouse_position = robot.getMousePos();
		if (Math.abs(mouse_position.x - point.x) <= 2 &&
			Math.abs(mouse_position.y - point.y) <= 2)
		{
			return mouse_position;
		}
	}

	throw new Error('Mouse position did not reach the expected harness coordinates (expected=' +
		point.x + ',' + point.y + '; actual=' +
		mouse_position.x + ',' + mouse_position.y + ').');
}

function Assert(condition, message)
{
	if (!condition)
	{
		throw new Error(message);
	}
}

function IsNumber(value)
{
	return typeof value === 'number' && Number.isFinite(value);
}

function HasPoint(point)
{
	return !!point && IsNumber(point.x) && IsNumber(point.y);
}

function HasBounds(bounds)
{
	return !!bounds
		&& IsNumber(bounds.x)
		&& IsNumber(bounds.y)
		&& IsNumber(bounds.width)
		&& IsNumber(bounds.height)
		&& HasPoint(bounds.center);
}

function WaitFor(predicate, timeout_ms, description)
{
	const start_time = Date.now();

	return new Promise(function(resolve, reject)
	{
		function Poll()
		{
			let result;

			try
			{
				result = predicate();
			}
			catch (error)
			{
				reject(error);
				return;
			}

			if (result)
			{
				resolve(result);
				return;
			}

			if ((Date.now() - start_time) >= timeout_ms)
			{
				reject(new Error('Timed out waiting for ' + description + '.'));
				return;
			}

			setTimeout(Poll, wait_poll_ms);
		}

		Poll();
	});
}

function WaitForQueueEvent(queue, predicate, timeout_ms, description)
{
	return WaitFor(function()
	{
		for (let index = 0; index < queue.length; index += 1)
		{
			if (predicate(queue[index]))
			{
				return queue.splice(index, 1)[0];
			}
		}

		return null;
	}, timeout_ms, description);
}

function EnsurePythonTk()
{
	const result = child_process.spawnSync('python3', ['-c', 'import tkinter'], {
		cwd: repo_root,
		encoding: 'utf8'
	});

	if (result.error)
	{
		throw new Error('python3 is required for live verification: ' + result.error.message);
	}

	if (result.status !== 0)
	{
		throw new Error('python3-tk is required for live verification. Install it before rerunning verify:live.');
	}
}

function StartHarness()
{
	const child = child_process.spawn('python3', [harness_path, '--title', harness_title], {
		cwd: repo_root,
		env: Object.assign({}, process.env, {
			PYTHONUNBUFFERED: '1'
		}),
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const events = [];
	const stderr_lines = [];
	let ready_payload = null;
	let startup_error = null;
	let exit_detail = null;

	readline.createInterface({
		input: child.stdout
	}).on('line', function(line)
	{
		if (!line.trim())
		{
			return;
		}

		try
		{
			const event = JSON.parse(line);
			events.push(event);

			if (event.event === 'ready')
			{
				ready_payload = event;
			}

			if (event.event === 'startup_error')
			{
				startup_error = event.message || 'live verification harness failed to start';
			}
		}
		catch (error)
		{
			stderr_lines.push('invalid harness stdout: ' + line);
		}
	});

	readline.createInterface({
		input: child.stderr
	}).on('line', function(line)
	{
		if (line.trim())
		{
			stderr_lines.push(line.trim());
		}
	});

	child.on('exit', function(code, signal)
	{
		exit_detail = {
			code: code,
			signal: signal
		};
	});

	return {
		child: child,
		events: events,
		stderr_lines: stderr_lines,
		getReadyPayload: function()
		{
			return ready_payload;
		},
		getStartupError: function()
		{
			return startup_error;
		},
		getExitDetail: function()
		{
			return exit_detail;
		}
	};
}

async function StopHarness(harness)
{
	if (!harness || !harness.child || harness.child.exitCode !== null || harness.child.signalCode !== null)
	{
		return;
	}

	harness.child.kill('SIGTERM');

	try
	{
		await WaitFor(function()
		{
			return harness.child.exitCode !== null || harness.child.signalCode !== null;
		}, 3000, 'harness shutdown');
	}
	catch (error)
	{
		harness.child.kill('SIGKILL');
	}
}

async function main()
{
	let robot;
	let harness = null;
	let catalog_dir = null;
	let hotkey_registration = null;

	try
	{
		EnsurePythonTk();
		Pass('python tkinter', 'python3-tk is available');

		robot = require('../');
		Pass('addon load', 'require(\'../\') succeeded');

		const capabilities = robot.desktop.getCapabilities();
		Assert(capabilities && typeof capabilities.backend === 'string', 'desktop capabilities are unavailable');
		Pass('desktop capabilities', 'backend=' + capabilities.backend);

		Assert(capabilities.backend !== 'unavailable', 'A usable desktop backend is required for live verification.');
		Assert(capabilities.supportsGlobalInputInjection === true, 'Global input injection is unavailable for this desktop backend.');
		Assert(capabilities.supportsWindowDiscovery === true, 'Window discovery is unavailable for this desktop backend.');

		harness = StartHarness();

		const ready_payload = await WaitFor(function()
		{
			if (harness.getStartupError())
			{
				throw new Error(harness.getStartupError());
			}

			if (harness.getExitDetail() && !harness.getReadyPayload())
			{
				const exit_detail = harness.getExitDetail();
				throw new Error('live verification harness exited early (code=' + exit_detail.code + ', signal=' + exit_detail.signal + ')' + (harness.stderr_lines.length > 0 ? ': ' + harness.stderr_lines.join(' | ') : ''));
			}

			return harness.getReadyPayload();
		}, 10000, 'harness readiness');

		Assert(ready_payload.title === harness_title, 'harness reported an unexpected window title');
		Assert(HasBounds(ready_payload.button), 'harness button bounds are invalid');
		Assert(HasBounds(ready_payload.input), 'harness input bounds are invalid');
		Assert(HasBounds(ready_payload.color_swatch), 'harness color swatch bounds are invalid');
		Assert(HasBounds(ready_payload.outside_color_swatch), 'harness outside color swatch bounds are invalid');
		Pass('harness startup', 'window title=' + ready_payload.title);

		await Delay(500);

		const windows = robot.desktop.listWindows();
		Assert(Array.isArray(windows), 'listWindows() did not return an array');
		Assert(windows.some(function(window_item)
		{
			return window_item && typeof window_item.title === 'string' && window_item.title.indexOf(harness_title) >= 0;
		}), 'The live verification harness window was not found in the window list.');
		Pass('window enumeration', 'harness window is discoverable');

		const displays = robot.desktop.listDisplays();
		Assert(Array.isArray(displays) && displays.length > 0, 'No displays were reported during live verification.');
		Pass('display enumeration', 'count=' + displays.length);

		robot.setMouseDelay(25);
		const mouse_position = await MoveMouseAndVerify(robot, ready_payload.button.center);
		Pass('mouse movement', 'x=' + mouse_position.x + ' y=' + mouse_position.y);

		robot.mouseClick('left', false);
		await WaitForQueueEvent(harness.events, function(event)
		{
			return event.event === 'button_clicked';
		}, 3000, 'button click event');
		Pass('mouse click', 'button click event observed');

		await MoveMouseAndVerify(robot, ready_payload.input.center);
		robot.mouseClick('left', false);
		await Delay(250);
		robot.typeString(expected_text);
		await WaitForQueueEvent(harness.events, function(event)
		{
			return event.event === 'input_changed' && event.text === expected_text;
		}, 5000, 'typed text event');
		Pass('keyboard typing', 'text=' + expected_text);

		const hotkey_events = [];
		hotkey_registration = await robot.registerHotkey({
			name: 'live-verification',
			hotkey: 'ctrl+shift+f12',
			on_pressed: function(event)
			{
				hotkey_events.push(event);
			}
		});
		robot.keyToggle('control', 'down');
		robot.keyToggle('shift', 'down');
		robot.keyToggle('f12', 'down');
		robot.keyToggle('f12', 'down');
		robot.keyToggle('f12', 'up');
		robot.keyToggle('shift', 'up');
		robot.keyToggle('control', 'up');
		await WaitFor(function()
		{
			return hotkey_events.length === 1;
		}, 3000, 'global hotkey event');
		await Delay(100);
		Assert(hotkey_events.length === 1, 'Global hotkey auto-repeat was not suppressed.');
		Assert(hotkey_events[0].hotkey === 'ctrl+shift+f12', 'Global hotkey was not normalized.');
		const hotkey_completion = await hotkey_registration.unregister();
		hotkey_registration = null;
		Assert(hotkey_completion.reason === 'unregistered', 'Global hotkey did not unregister cleanly.');
		Pass('global hotkey', 'hotkey=' + hotkey_events[0].hotkey + ' repeat_suppressed=true');

		const swatch_color = robot.getPixelColor(ready_payload.color_swatch.center.x, ready_payload.color_swatch.center.y).toLowerCase();
		Assert(swatch_color === ready_payload.color_swatch.hex.toLowerCase(), 'Pixel color did not match the harness swatch.');
		Pass('pixel color', '#' + swatch_color);

		const capture_bitmap = robot.screen.capture(ready_payload.color_swatch.center.x, ready_payload.color_swatch.center.y, 1, 1);
		const capture_color = capture_bitmap.colorAt(0, 0).toLowerCase();
		Assert(capture_color === ready_payload.color_swatch.hex.toLowerCase(), 'Screen capture did not match the harness swatch color.');
		Pass('screen capture', '#' + capture_color);

		const swatch_display = displays.find(function(display)
		{
			return ready_payload.color_swatch.center.x >= display.x &&
				ready_payload.color_swatch.center.x < display.x + display.width &&
				ready_payload.color_swatch.center.y >= display.y &&
				ready_payload.color_swatch.center.y < display.y + display.height;
		});
		Assert(!!swatch_display, 'Could not resolve the harness swatch to a display.');
		catalog_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robotts-live-catalog-'));
		const swatch_png_path = path.join(catalog_dir, 'swatch.png');
		WriteSolidPng(swatch_png_path, ready_payload.color_swatch.hex);
		const display_fuzzy_result = robot.image_search.findFuzzy({
			source: {
				type: 'display',
				display_id: swatch_display.id,
				x: ready_payload.color_swatch.x - swatch_display.x,
				y: ready_payload.color_swatch.y - swatch_display.y,
				width: ready_payload.color_swatch.width,
				height: ready_payload.color_swatch.height
			},
			reference: {
				png_path: swatch_png_path
			},
			threshold: 0.99,
			tolerance: 0.01,
			thread_count: 4
		});
		Assert(display_fuzzy_result.found &&
			display_fuzzy_result.global_location.x >= ready_payload.color_swatch.x &&
			display_fuzzy_result.global_location.x < ready_payload.color_swatch.x + ready_payload.color_swatch.width &&
			display_fuzzy_result.global_location.y >= ready_payload.color_swatch.y &&
			display_fuzzy_result.global_location.y < ready_payload.color_swatch.y + ready_payload.color_swatch.height,
		'Direct fuzzy display search did not find the live swatch.');
		Pass('direct fuzzy display search',
			'threads=' + display_fuzzy_result.metrics.effective_thread_count +
			' score=' + display_fuzzy_result.score.toFixed(3));
		let catalog_match = null;
		const catalog_session = await robot.desktop.watchImageCatalog({
			image_dir: catalog_dir,
			display_ids: [swatch_display.id],
			check_period_ms: 50,
			matching: {
				mode: 'fuzzy',
				threshold: 0.99,
				tolerance: 0.01,
				thread_count: 4,
				max_results_per_image: 15000
			},
			on_matches_found: function(event)
			{
				catalog_match = event.matches[0];
				return 'EXIT';
			}
		});
		const catalog_timeout = setTimeout(function() { void catalog_session.stop(); }, 10000);
		const catalog_summary = await catalog_session.completion;
		clearTimeout(catalog_timeout);
		Assert(catalog_summary.reason === 'callback_exit', 'Image catalog watcher did not find the live swatch before timeout.');
		Assert(catalog_match && catalog_match.occurrences.some(function(occurrence)
		{
			return occurrence.global_position.x >= ready_payload.color_swatch.x &&
				occurrence.global_position.x < ready_payload.color_swatch.x + ready_payload.color_swatch.width &&
				occurrence.global_position.y >= ready_payload.color_swatch.y &&
				occurrence.global_position.y < ready_payload.color_swatch.y + ready_payload.color_swatch.height;
		}), 'Image catalog watcher did not report a swatch occurrence in global coordinates.');
		Pass('fuzzy image catalog watcher',
			'threads=' + catalog_summary.statistics.native.effective_thread_count +
			' matches=' + catalog_match.occurrences.length);

		const target_window = robot.desktop.listWindows().find(function(window_item)
		{
			const geometry = window_item && window_item.geometry;
			return window_item && window_item.title === harness_title && geometry &&
				ready_payload.color_swatch.center.x >= geometry.x &&
				ready_payload.color_swatch.center.x < geometry.x + geometry.width &&
				ready_payload.color_swatch.center.y >= geometry.y &&
				ready_payload.color_swatch.center.y < geometry.y + geometry.height;
		});
		Assert(!!target_window, 'Could not identify the primary harness window by its swatch coordinates.');
		const locked_window = robot.desktop.lockWindow({ window_id: target_window.windowId });
		const locked_geometry = locked_window.getGeometry();
		Assert(locked_geometry.target.windowId === target_window.windowId,
			'Locked geometry returned the wrong target.');
		Assert(locked_geometry.geometry.x === target_window.geometry.x &&
			locked_geometry.geometry.y === target_window.geometry.y &&
			locked_geometry.geometry.width === target_window.geometry.width &&
			locked_geometry.geometry.height === target_window.geometry.height,
		'Locked geometry did not match the verified live window.');
		Assert(locked_geometry.window_bounds.x === 0 &&
			locked_geometry.window_bounds.y === 0 &&
			locked_geometry.window_bounds.width === target_window.geometry.width &&
			locked_geometry.window_bounds.height === target_window.geometry.height,
		'Locked local bounds were not zero-origin window coordinates.');

		robot.moveMouse(ready_payload.color_swatch.center.x, ready_payload.color_swatch.center.y);
		const locked_mouse_position = locked_window.getMousePos();
		Assert(locked_mouse_position.global_position.x === ready_payload.color_swatch.center.x &&
			locked_mouse_position.global_position.y === ready_payload.color_swatch.center.y,
		'Locked mouse position did not retain the global pointer position.');
		Assert(locked_mouse_position.window_position.x ===
			ready_payload.color_swatch.center.x - locked_geometry.geometry.x &&
			locked_mouse_position.window_position.y ===
			ready_payload.color_swatch.center.y - locked_geometry.geometry.y &&
			locked_mouse_position.inside_window,
		'Locked mouse position was not translated into the live window coordinate space.');

		const locked_round_trip = locked_window.toGlobalPoint({
			x: locked_mouse_position.window_position.x,
			y: locked_mouse_position.window_position.y
		});
		Assert(locked_round_trip.global_position.x === ready_payload.color_swatch.center.x &&
			locked_round_trip.global_position.y === ready_payload.color_swatch.center.y,
		'Locked point conversion did not round-trip to the global swatch position.');
		const locked_outside_point = locked_window.toWindowPoint({
			x: locked_geometry.geometry.x - 1,
			y: locked_geometry.geometry.y - 1
		});
		Assert(locked_outside_point.window_position.x === -1 &&
			locked_outside_point.window_position.y === -1 &&
			!locked_outside_point.inside_window,
		'Locked point conversion did not preserve an outside position.');

		const locked_pixel = locked_window.getPixelColor({
			x: locked_mouse_position.window_position.x,
			y: locked_mouse_position.window_position.y
		});
		Assert(locked_pixel.color.toLowerCase() === ready_payload.color_swatch.hex.toLowerCase() &&
			locked_pixel.global_position.x === ready_payload.color_swatch.center.x &&
			locked_pixel.global_position.y === ready_payload.color_swatch.center.y,
		'Locked window-relative pixel lookup did not read the live swatch.');
		Pass('locked window spatial utilities',
			'window_position=' + locked_mouse_position.window_position.x + ',' +
			locked_mouse_position.window_position.y + ' global_position=' +
			locked_mouse_position.global_position.x + ',' +
			locked_mouse_position.global_position.y);

		const locked_fuzzy_result = locked_window.findImageFuzzy({
			reference: {
				png_path: swatch_png_path
			},
			threshold: 0.99,
			tolerance: 0.01,
			thread_count: 4
		});
		Assert(locked_fuzzy_result.found &&
			locked_fuzzy_result.global_location.x >= ready_payload.color_swatch.x &&
			locked_fuzzy_result.global_location.x < ready_payload.color_swatch.x + ready_payload.color_swatch.width &&
			locked_fuzzy_result.global_location.y >= ready_payload.color_swatch.y &&
			locked_fuzzy_result.global_location.y < ready_payload.color_swatch.y + ready_payload.color_swatch.height,
		'Direct fuzzy locked-window search did not find the live swatch.');
		Assert(locked_fuzzy_result.metrics.requested_thread_count === 4 &&
			locked_fuzzy_result.metrics.effective_thread_count === 4,
		'Locked-window fuzzy search did not retain its requested thread count.');
		Pass('direct fuzzy locked-window search',
			'threads=' + locked_fuzzy_result.metrics.effective_thread_count +
			' score=' + locked_fuzzy_result.score.toFixed(3));

		await MoveMouseAndVerify(robot, ready_payload.input.center);
		robot.mouseClick('left', false);
		robot.keyTap('end');
		let desktop_hold = robot.desktop.holdKeysDown({ keys: 'shift' });
		try
		{
			robot.keyTap('a');
		}
		finally
		{
			desktop_hold.releaseKeys();
			desktop_hold = null;
		}
		robot.keyTap('a');
		await WaitForQueueEvent(harness.events, function(event)
		{
			return event.event === 'input_changed' && event.text === expected_text + 'Aa';
		}, 3000, 'desktop held-key input');

		locked_window.focus();
		locked_window.mouseClick({
			x: ready_payload.input.center.x - locked_geometry.geometry.x,
			y: ready_payload.input.center.y - locked_geometry.geometry.y,
			require_active: true
		});
		robot.keyTap('end');
		let locked_hold = locked_window.holdKeysDown({
			keys: ['shift'],
			require_active: true
		});
		try
		{
			robot.keyTap('b');
		}
		finally
		{
			locked_hold.releaseKeys();
			locked_hold = null;
		}
		robot.keyTap('b');
		await WaitForQueueEvent(harness.events, function(event)
		{
			return event.event === 'input_changed' && event.text === expected_text + 'AaBb';
		}, 3000, 'locked held-key input');
		Pass('held keys', 'desktop=shift+A/a locked_window=shift+B/b released=true');

		let locked_match_event = null;
		let locked_error_event = null;
		let replacement_event = null;
		const locked_session = await robot.desktop.watchImageCatalog({
			image_dir: catalog_dir,
			source: {
				type: 'locked_window',
				locked_window: locked_window
			},
			check_period_ms: 50,
			matching: {
				mode: 'fuzzy',
				threshold: 0.99,
				tolerance: 0.01,
				thread_count: 4,
				max_results_per_image: 8000
			},
			on_matches_found: async function(event)
			{
				if (locked_match_event) return;
				locked_match_event = event;
				Assert(event.source.type === 'locked_window', 'Locked watcher callback source is not discriminated.');
				Assert(event.source.locked_window === locked_window, 'Locked watcher callback did not retain handle identity.');
				Assert(locked_window.assert().windowId === target_window.windowId, 'Locked watcher handle was not usable in its callback.');

				const replacement_ready = WaitForQueueEvent(harness.events, function(item)
				{
					return item.event === 'window_replaced';
				}, 3000, 'replacement harness window');
				harness.child.kill('SIGUSR1');
				replacement_event = await replacement_ready;
			},
			on_error: function(event)
			{
				locked_error_event = event;
			}
		});
		const locked_timeout = setTimeout(function() { void locked_session.stop(); }, 10000);
		let locked_completion_error = null;
		try
		{
			await locked_session.completion;
		}
		catch (error)
		{
			locked_completion_error = error;
		}
		clearTimeout(locked_timeout);

		Assert(!!locked_match_event, 'Locked watcher did not report the swatch inside the target window.');
		const locked_source = locked_match_event.source;
		const locked_occurrences = locked_match_event.matches[0].occurrences;
		Assert(locked_occurrences.length > 0, 'Locked watcher returned an empty match occurrence list.');
		Assert(locked_occurrences.every(function(occurrence)
		{
			return occurrence.source_type === 'locked_window' &&
				occurrence.global_position.x >= locked_source.geometry.x &&
				occurrence.global_position.x < locked_source.geometry.x + locked_source.geometry.width &&
				occurrence.global_position.y >= locked_source.geometry.y &&
				occurrence.global_position.y < locked_source.geometry.y + locked_source.geometry.height;
		}), 'Locked watcher reported an occurrence outside its verified capture geometry.');
		Assert(!locked_occurrences.some(function(occurrence)
		{
			return occurrence.global_position.x >= ready_payload.outside_color_swatch.x &&
				occurrence.global_position.x < ready_payload.outside_color_swatch.x + ready_payload.outside_color_swatch.width &&
				occurrence.global_position.y >= ready_payload.outside_color_swatch.y &&
				occurrence.global_position.y < ready_payload.outside_color_swatch.y + ready_payload.outside_color_swatch.height;
		}), 'Locked watcher included a matching occurrence from the outside decoy window.');
		const inside_occurrence = locked_occurrences.find(function(occurrence)
		{
			return occurrence.global_position.x >= ready_payload.color_swatch.x &&
				occurrence.global_position.x < ready_payload.color_swatch.x + ready_payload.color_swatch.width &&
				occurrence.global_position.y >= ready_payload.color_swatch.y &&
				occurrence.global_position.y < ready_payload.color_swatch.y + ready_payload.color_swatch.height;
		});
		Assert(!!inside_occurrence, 'Locked watcher did not report an occurrence in the target swatch.');
		Assert(inside_occurrence.window_position.x === inside_occurrence.global_position.x - locked_source.geometry.x &&
			inside_occurrence.window_position.y === inside_occurrence.global_position.y - locked_source.geometry.y,
		'Locked watcher window-relative and global coordinates disagree.');
		Assert(!!replacement_event, 'The similar replacement window was not created.');
		Assert(!!locked_completion_error, 'Locked watcher did not reject after the original window disappeared.');
		Assert(locked_error_event && locked_error_event.error.code === 'LOCKED_WINDOW_UNAVAILABLE',
			'Locked watcher did not report terminal locked-window loss.');
		Assert(locked_error_event.source.locked_window === locked_window,
			'Locked watcher error callback did not retain the original handle.');
		await Delay(200);
		Assert(robot.desktop.listWindows().some(function(window_item)
		{
			return window_item.title === harness_title && window_item.windowId !== target_window.windowId;
		}), 'A discoverable same-title replacement window was not present.');
		Pass('fuzzy locked image catalog watcher',
			'inside_matches=' + locked_occurrences.length + ' outside_ignored=true replacement_retargeted=false');
	}
	catch (error)
	{
		Fail('live verification', error && error.message ? error.message : String(error));
	}
	finally
	{
		if (robot)
		{
			try
			{
				robot.desktop.releaseAllHeldKeys();
			}
			catch (error)
			{
				Fail('held-key cleanup', error && error.message ? error.message : String(error));
			}
		}
		if (hotkey_registration && hotkey_registration.active)
		{
			try
			{
				await hotkey_registration.unregister();
			}
			catch (error)
			{
				Fail('global hotkey cleanup', error && error.message ? error.message : String(error));
			}
		}
		if (catalog_dir) fs.rmSync(catalog_dir, { recursive: true, force: true });
		await StopHarness(harness);
		Finish();
	}
}

main();
