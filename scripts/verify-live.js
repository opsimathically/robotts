#!/usr/bin/env node
'use strict';

const child_process = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const repo_root = path.resolve(__dirname, '..');
const harness_path = path.join(__dirname, 'live_verification_harness.py');
const expected_text = 'robotts-live-check';
const harness_title = 'RobotTS Verification Harness';
const results = [];
const wait_poll_ms = 100;

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
		robot.moveMouse(ready_payload.button.center.x, ready_payload.button.center.y);
		await Delay(150);

		const mouse_position = robot.getMousePos();
		Assert(Math.abs(mouse_position.x - ready_payload.button.center.x) <= 2 && Math.abs(mouse_position.y - ready_payload.button.center.y) <= 2, 'Mouse position did not reach the expected harness coordinates.');
		Pass('mouse movement', 'x=' + mouse_position.x + ' y=' + mouse_position.y);

		robot.mouseClick('left', false);
		await WaitForQueueEvent(harness.events, function(event)
		{
			return event.event === 'button_clicked';
		}, 3000, 'button click event');
		Pass('mouse click', 'button click event observed');

		robot.moveMouse(ready_payload.input.center.x, ready_payload.input.center.y);
		await Delay(100);
		robot.mouseClick('left', false);
		await Delay(250);
		robot.typeString(expected_text);
		await WaitForQueueEvent(harness.events, function(event)
		{
			return event.event === 'input_changed' && event.text === expected_text;
		}, 5000, 'typed text event');
		Pass('keyboard typing', 'text=' + expected_text);

		const swatch_color = robot.getPixelColor(ready_payload.color_swatch.center.x, ready_payload.color_swatch.center.y).toLowerCase();
		Assert(swatch_color === ready_payload.color_swatch.hex.toLowerCase(), 'Pixel color did not match the harness swatch.');
		Pass('pixel color', '#' + swatch_color);

		const capture_bitmap = robot.screen.capture(ready_payload.color_swatch.center.x, ready_payload.color_swatch.center.y, 1, 1);
		const capture_color = capture_bitmap.colorAt(0, 0).toLowerCase();
		Assert(capture_color === ready_payload.color_swatch.hex.toLowerCase(), 'Screen capture did not match the harness swatch color.');
		Pass('screen capture', '#' + capture_color);
	}
	catch (error)
	{
		Fail('live verification', error && error.message ? error.message : String(error));
	}
	finally
	{
		await StopHarness(harness);
		Finish();
	}
}

main();
