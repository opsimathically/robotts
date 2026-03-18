#!/usr/bin/env node
'use strict';

const child_process = require('node:child_process');
const path = require('node:path');

const repo_root = path.resolve(__dirname, '..');
const node_binary = process.execPath;
const probe_timeout_ms = 10000;
const results = [];

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

function Skip(name, detail)
{
	LogResult({
		status: 'skip',
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
		skip: 0,
		fail: 0
	};

	results.forEach(function(result)
	{
		summary[result.status] += 1;
	});

	console.log('');
	console.log('Verification summary: pass=' + summary.pass + ' skip=' + summary.skip + ' fail=' + summary.fail);

	process.exit(summary.fail > 0 ? 1 : 0);
}

function IsObject(value)
{
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function IsNumber(value)
{
	return typeof value === 'number' && Number.isFinite(value);
}

function IsBoolean(value)
{
	return typeof value === 'boolean';
}

function IsNullableString(value)
{
	return value === null || typeof value === 'string';
}

function ValidateRect(rect)
{
	return IsObject(rect)
		&& IsNumber(rect.x)
		&& IsNumber(rect.y)
		&& IsNumber(rect.width)
		&& IsNumber(rect.height);
}

function ValidateDisplay(display_item)
{
	return IsObject(display_item)
		&& IsNumber(display_item.id)
		&& IsNullableString(display_item.name)
		&& IsBoolean(display_item.isPrimary)
		&& ValidateRect(display_item);
}

function ValidateWorkspace(workspace_item)
{
	return IsObject(workspace_item)
		&& IsNumber(workspace_item.id)
		&& IsNullableString(workspace_item.name)
		&& IsBoolean(workspace_item.isCurrent);
}

function ValidateWindow(window_item)
{
	return IsObject(window_item)
		&& typeof window_item.windowId === 'string'
		&& IsNullableString(window_item.title)
		&& IsNullableString(window_item.className)
		&& IsNullableString(window_item.instanceName)
		&& (window_item.pid === null || IsNumber(window_item.pid))
		&& (window_item.workspaceId === null || IsNumber(window_item.workspaceId))
		&& ValidateRect(window_item.geometry)
		&& IsBoolean(window_item.isActive)
		&& IsBoolean(window_item.isVisible);
}

function RunProbe(params)
{
	const child = child_process.spawnSync(node_binary, ['-e', params.script], {
		cwd: repo_root,
		encoding: 'utf8',
		timeout: probe_timeout_ms,
		maxBuffer: 1024 * 1024
	});

	if (child.error)
	{
		return {
			ok: false,
			error: child.error.message
		};
	}

	if (child.signal)
	{
		return {
			ok: false,
			error: 'probe terminated by signal ' + child.signal + FormatStderr(child.stderr)
		};
	}

	if (child.status !== 0)
	{
		return {
			ok: false,
			error: 'probe exited with status ' + child.status + FormatStderr(child.stderr)
		};
	}

	try
	{
		return {
			ok: true,
			value: JSON.parse(child.stdout || 'null'),
			stderr: child.stderr || ''
		};
	}
	catch (error)
	{
		return {
			ok: false,
			error: 'probe returned invalid JSON: ' + error.message + '. stdout=' + JSON.stringify((child.stdout || '').trim())
		};
	}
}

function FormatStderr(stderr)
{
	if (!stderr || !stderr.trim())
	{
		return '';
	}

	return ' (' + stderr.trim().replace(/\s+/g, ' ') + ')';
}

function ProbeExpression(expression)
{
	return RunProbe({
		script:
			'try {' +
				'const robot = require("./");' +
				'const value = (' + expression + ');' +
				'process.stdout.write(JSON.stringify(value));' +
			'} catch (error) {' +
				'process.stderr.write(error && error.stack ? error.stack : String(error));' +
				'process.exit(2);' +
			'}'
	});
}

function ValidateCapabilities(capabilities)
{
	return IsObject(capabilities)
		&& typeof capabilities.backend === 'string'
		&& IsBoolean(capabilities.supportsGlobalInputInjection)
		&& IsBoolean(capabilities.supportsWindowDiscovery)
		&& IsBoolean(capabilities.supportsMonitorGeometry)
		&& IsBoolean(capabilities.supportsWorkspaceIdentity)
		&& IsBoolean(capabilities.supportsFocusChanges)
		&& IsBoolean(capabilities.supportsStrictTargetVerification);
}

function ValidateDesktopState(state)
{
	return IsObject(state)
		&& IsObject(state.session)
		&& typeof state.session.sessionType === 'string'
		&& typeof state.session.xDisplayName === 'string'
		&& IsNullableString(state.session.waylandDisplayName)
		&& ValidateCapabilities(state.capabilities)
		&& ValidateRect(state.desktopBounds)
		&& Array.isArray(state.displays)
		&& state.displays.every(ValidateDisplay)
		&& Array.isArray(state.workspaces)
		&& state.workspaces.every(ValidateWorkspace)
		&& (state.currentWorkspaceId === null || IsNumber(state.currentWorkspaceId))
		&& (state.activeWindow === null || ValidateWindow(state.activeWindow))
		&& Array.isArray(state.windows)
		&& state.windows.every(ValidateWindow);
}

function ValidateBitmapSummary(bitmap_summary)
{
	return IsObject(bitmap_summary)
		&& IsNumber(bitmap_summary.width)
		&& IsNumber(bitmap_summary.height)
		&& bitmap_summary.width > 0
		&& bitmap_summary.height > 0
		&& (typeof bitmap_summary.color === 'undefined' || /^[0-9A-Fa-f]{6}$/.test(bitmap_summary.color));
}

function Run()
{
	const require_probe = ProbeExpression('true');
	if (!require_probe.ok)
	{
		Fail('addon load', require_probe.error);
		Finish();
		return;
	}
	Pass('addon load', 'require(\'./\') succeeded');

	const capabilities_probe = ProbeExpression('robot.desktop.getCapabilities()');
	if (!capabilities_probe.ok)
	{
		Fail('desktop capabilities', capabilities_probe.error);
		Finish();
		return;
	}

	if (!ValidateCapabilities(capabilities_probe.value))
	{
		Fail('desktop capabilities', 'returned value has an invalid shape');
		Finish();
		return;
	}
	Pass('desktop capabilities', 'backend=' + capabilities_probe.value.backend);

	const state_probe = ProbeExpression('robot.desktop.getState()');
	if (!state_probe.ok)
	{
		Fail('desktop state', state_probe.error);
		Finish();
		return;
	}

	if (!ValidateDesktopState(state_probe.value))
	{
		Fail('desktop state', 'returned value has an invalid shape');
		Finish();
		return;
	}

	if (state_probe.value.capabilities.backend !== capabilities_probe.value.backend)
	{
		Fail('desktop state', 'state.capabilities.backend does not match desktop.getCapabilities()');
		Finish();
		return;
	}

	if (state_probe.value.currentWorkspaceId !== null)
	{
		const has_workspace = state_probe.value.workspaces.some(function(workspace_item)
		{
			return workspace_item.id === state_probe.value.currentWorkspaceId;
		});

		if (!has_workspace)
		{
			Fail('desktop state', 'currentWorkspaceId does not exist in workspaces');
			Finish();
			return;
		}
	}

	if (state_probe.value.activeWindow)
	{
		const has_active_window = state_probe.value.windows.some(function(window_item)
		{
			return window_item.windowId === state_probe.value.activeWindow.windowId;
		});

		if (!has_active_window)
		{
			Fail('desktop state', 'activeWindow does not exist in windows');
			Finish();
			return;
		}
	}

	Pass('desktop state', 'session=' + state_probe.value.session.sessionType);

	const display_probe = ProbeExpression('robot.desktop.listDisplays()');
	if (!display_probe.ok || !Array.isArray(display_probe.value) || !display_probe.value.every(ValidateDisplay))
	{
		Fail('display enumeration', display_probe.ok ? 'listDisplays() returned an invalid shape' : display_probe.error);
		Finish();
		return;
	}
	Pass('display enumeration', 'count=' + display_probe.value.length);

	const workspace_probe = ProbeExpression('robot.desktop.listWorkspaces()');
	if (!workspace_probe.ok || !Array.isArray(workspace_probe.value) || !workspace_probe.value.every(ValidateWorkspace))
	{
		Fail('workspace enumeration', workspace_probe.ok ? 'listWorkspaces() returned an invalid shape' : workspace_probe.error);
		Finish();
		return;
	}
	Pass('workspace enumeration', 'count=' + workspace_probe.value.length);

	const window_probe = ProbeExpression('robot.desktop.listWindows()');
	if (!window_probe.ok || !Array.isArray(window_probe.value) || !window_probe.value.every(ValidateWindow))
	{
		Fail('window enumeration', window_probe.ok ? 'listWindows() returned an invalid shape' : window_probe.error);
		Finish();
		return;
	}
	Pass('window enumeration', 'count=' + window_probe.value.length);

	if (capabilities_probe.value.backend === 'unavailable')
	{
		Skip('screen size', 'desktop backend is unavailable in this session');
		Skip('mouse position', 'desktop backend is unavailable in this session');
		Skip('pixel color', 'desktop backend is unavailable in this session');
		Skip('screen capture', 'desktop backend is unavailable in this session');
		Finish();
		return;
	}

	const screen_size_probe = ProbeExpression('robot.getScreenSize()');
	if (!screen_size_probe.ok || !IsObject(screen_size_probe.value) || !IsNumber(screen_size_probe.value.width) || !IsNumber(screen_size_probe.value.height) || screen_size_probe.value.width <= 0 || screen_size_probe.value.height <= 0)
	{
		Fail('screen size', screen_size_probe.ok ? 'getScreenSize() returned an invalid shape' : screen_size_probe.error);
		Finish();
		return;
	}
	Pass('screen size', screen_size_probe.value.width + 'x' + screen_size_probe.value.height);

	const mouse_probe = ProbeExpression('robot.getMousePos()');
	if (!mouse_probe.ok || !IsObject(mouse_probe.value) || !IsNumber(mouse_probe.value.x) || !IsNumber(mouse_probe.value.y))
	{
		Fail('mouse position', mouse_probe.ok ? 'getMousePos() returned an invalid shape' : mouse_probe.error);
		Finish();
		return;
	}
	Pass('mouse position', 'x=' + mouse_probe.value.x + ' y=' + mouse_probe.value.y);

	const pixel_probe = ProbeExpression('(function(){ const point = robot.getMousePos(); return { point: point, color: robot.getPixelColor(point.x, point.y) }; }())');
	if (!pixel_probe.ok || !IsObject(pixel_probe.value) || !IsObject(pixel_probe.value.point) || !IsNumber(pixel_probe.value.point.x) || !IsNumber(pixel_probe.value.point.y) || typeof pixel_probe.value.color !== 'string' || !/^[0-9A-Fa-f]{6}$/.test(pixel_probe.value.color))
	{
		Fail('pixel color', pixel_probe.ok ? 'getPixelColor() returned an invalid shape' : pixel_probe.error);
		Finish();
		return;
	}
	Pass('pixel color', '#' + pixel_probe.value.color.toLowerCase());

	const capture_probe = ProbeExpression('(function(){ const point = robot.getMousePos(); const bitmap = robot.screen.capture(point.x, point.y, 1, 1); return { width: bitmap.width, height: bitmap.height, color: bitmap.colorAt(0, 0) }; }())');
	if (!capture_probe.ok || !ValidateBitmapSummary(capture_probe.value))
	{
		Fail('screen capture', capture_probe.ok ? 'screen.capture() returned an invalid bitmap summary' : capture_probe.error);
		Finish();
		return;
	}
	Pass('screen capture', capture_probe.value.width + 'x' + capture_probe.value.height + ' sample=#' + capture_probe.value.color.toLowerCase());

	if (capabilities_probe.value.supportsMonitorGeometry && display_probe.value.length > 0)
	{
		const capture_display_probe = ProbeExpression('(function(){ const bitmap = robot.screen.captureDisplay({ display_id: ' + JSON.stringify(display_probe.value[0].id) + ' }); return { width: bitmap.width, height: bitmap.height }; }())');
		if (!capture_display_probe.ok || !ValidateBitmapSummary(capture_display_probe.value))
		{
			Fail('display capture', capture_display_probe.ok ? 'screen.captureDisplay() returned an invalid bitmap summary' : capture_display_probe.error);
			Finish();
			return;
		}
		Pass('display capture', capture_display_probe.value.width + 'x' + capture_display_probe.value.height);
	}
	else
	{
		Skip('display capture', 'monitor geometry is unavailable or no displays were reported');
	}

	Finish();
}

Run();
