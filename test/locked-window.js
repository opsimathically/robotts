'use strict';

var robot = require('..');

function CreateWindow(params)
{
	return {
		windowId: '42',
		title: params && params.title ? params.title : 'Spatial Test Window',
		className: params && params.className ? params.className : 'robotts-test',
		instanceName: params && params.instanceName ? params.instanceName : 'robotts-test',
		pid: params && typeof params.pid !== 'undefined' ? params.pid : 1200,
		workspaceId: params && typeof params.workspaceId !== 'undefined' ? params.workspaceId : 1,
		geometry: params && params.geometry ? params.geometry : {
			x: 640,
			y: -240,
			width: 320,
			height: 200
		},
		isActive: !params || params.isActive !== false,
		isVisible: true
	};
}

function CreateDesktopState(window_item, active_window)
{
	return {
		session: {
			sessionType: 'x11',
			xDisplayName: ':0',
			waylandDisplayName: null
		},
		capabilities: {
			backend: 'x11',
			supportsGlobalInputInjection: true,
			supportsWindowDiscovery: true,
			supportsMonitorGeometry: true,
			supportsScreenCapture: true,
			supportsWorkspaceIdentity: true,
			supportsFocusChanges: true,
			supportsStrictTargetVerification: true
		},
		desktopBounds: {
			x: -1280,
			y: -240,
			width: 3200,
			height: 1320
		},
		displays: [{
			id: 2,
			name: 'left',
			isPrimary: false,
			x: -1280,
			y: -240,
			width: 2240,
			height: 1080
		}],
		workspaces: [{
			id: 1,
			name: 'workspace',
			isCurrent: true
		}],
		currentWorkspaceId: 1,
		activeWindow: typeof active_window === 'undefined' ? window_item : active_window,
		windows: window_item ? [window_item] : []
	};
}

describe('Locked Window Spatial Utilities', function()
{
	var original_get_desktop_state;
	var original_get_mouse_pos;
	var original_get_pixel_color;
	var original_move_mouse;
	var original_mouse_click;
	var original_key_toggle;
	var original_focus_window;
	var current_window;
	var active_window;
	var pixel_calls;
	var move_calls;
	var click_calls;
	var key_calls;
	var focus_calls;

	beforeEach(function()
	{
		original_get_desktop_state = robot.getDesktopState;
		original_get_mouse_pos = robot.getMousePos;
		original_get_pixel_color = robot.getPixelColor;
		original_move_mouse = robot.moveMouse;
		original_mouse_click = robot.mouseClick;
		original_key_toggle = robot.keyToggle;
		original_focus_window = robot.focusWindow;
		current_window = CreateWindow();
		active_window = current_window;
		pixel_calls = [];
		move_calls = [];
		click_calls = [];
		key_calls = [];
		focus_calls = [];

		robot.getDesktopState = function()
		{
			return CreateDesktopState(current_window, active_window);
		};
		robot.getMousePos = function()
		{
			return {
				x: 700,
				y: -200
			};
		};
		robot.getPixelColor = function(x, y)
		{
			pixel_calls.push({ x: x, y: y });
			return 'a1b2c3';
		};
		robot.moveMouse = function(x, y)
		{
			move_calls.push({ x: x, y: y });
		};
		robot.mouseClick = function(button, double)
		{
			click_calls.push({ button: button, double: double });
		};
		robot.keyToggle = function(key, state)
		{
			key_calls.push({ key: key, state: state });
		};
		robot.focusWindow = function(window_id)
		{
			focus_calls.push(window_id);
			active_window = current_window;
		};
	});

	afterEach(function()
	{
		robot.desktop.releaseAllHeldKeys();
		robot.getDesktopState = original_get_desktop_state;
		robot.getMousePos = original_get_mouse_pos;
		robot.getPixelColor = original_get_pixel_color;
		robot.moveMouse = original_move_mouse;
		robot.mouseClick = original_mouse_click;
		robot.keyToggle = original_key_toggle;
		robot.focusWindow = original_focus_window;
	});

	function LockWindow()
	{
		return robot.desktop.lockWindow({
			window_id: '42'
		});
	}

	it('returns verified global geometry and zero-origin window bounds.', function()
	{
		var locked_window = LockWindow();
		var result = locked_window.getGeometry();

		expect(result.target.windowId).toEqual('42');
		expect(result.window.windowId).toEqual('42');
		expect(result.geometry).toEqual({
			x: 640,
			y: -240,
			width: 320,
			height: 200
		});
		expect(result.window_bounds).toEqual({
			x: 0,
			y: 0,
			width: 320,
			height: 200
		});
	});

	it('returns inside and outside mouse positions in both coordinate spaces.', function()
	{
		var locked_window = LockWindow();
		var inside_result = locked_window.getMousePos();

		expect(inside_result.window_position).toEqual({ x: 60, y: 40 });
		expect(inside_result.global_position).toEqual({ x: 700, y: -200 });
		expect(inside_result.inside_window).toBeTruthy();

		robot.getMousePos = function()
		{
			return {
				x: 639,
				y: -241
			};
		};
		var outside_result = locked_window.getMousePos();

		expect(outside_result.window_position).toEqual({ x: -1, y: -1 });
		expect(outside_result.inside_window).toBeFalsy();
	});

	it('converts points in both directions without restricting outside points.', function()
	{
		current_window.geometry = {
			x: -900,
			y: -120,
			width: 400,
			height: 300
		};
		var locked_window = LockWindow();
		var global_result = locked_window.toGlobalPoint({ x: 25, y: 30 });
		var window_result = locked_window.toWindowPoint({ x: -910, y: -125 });

		expect(global_result.global_position).toEqual({ x: -875, y: -90 });
		expect(global_result.window_position).toEqual({ x: 25, y: 30 });
		expect(global_result.inside_window).toBeTruthy();
		expect(window_result.window_position).toEqual({ x: -10, y: -5 });
		expect(window_result.global_position).toEqual({ x: -910, y: -125 });
		expect(window_result.inside_window).toBeFalsy();
		expect(function()
		{
			locked_window.toGlobalPoint({ x: Number.POSITIVE_INFINITY, y: 0 });
		}).toThrowError(TypeError, /finite numeric x and y/);
	});

	it('uses refreshed geometry after the locked window moves and resizes.', function()
	{
		var locked_window = LockWindow();
		expect(locked_window.toGlobalPoint({ x: 10, y: 15 }).global_position)
			.toEqual({ x: 650, y: -225 });

		current_window.geometry = {
			x: -300,
			y: 500,
			width: 800,
			height: 600
		};
		current_window.title = 'Updated Spatial Test Window';
		current_window.workspaceId = 2;
		var result = locked_window.toGlobalPoint({ x: 10, y: 15 });

		expect(result.global_position).toEqual({ x: -290, y: 515 });
		expect(result.geometry).toEqual({
			x: -300,
			y: 500,
			width: 800,
			height: 600
		});
		expect(result.target.title).toEqual('Updated Spatial Test Window');
		expect(result.target.workspaceId).toEqual(2);
		expect(locked_window.getTarget()).toEqual(result.target);
	});

	it('reads pixels with window-relative coordinates and returns both positions.', function()
	{
		var locked_window = LockWindow();
		var result = locked_window.getPixelColor({ x: 12, y: 34 });

		expect(result.color).toEqual('a1b2c3');
		expect(result.window_position).toEqual({ x: 12, y: 34 });
		expect(result.global_position).toEqual({ x: 652, y: -206 });
		expect(result.inside_window).toBeTruthy();
		expect(pixel_calls).toEqual([{ x: 652, y: -206 }]);
	});

	it('uses the public left single-click defaults for locked-window clicks.', function()
	{
		var locked_window = LockWindow();

		locked_window.mouseClick({ x: 12, y: 34 });

		expect(move_calls).toEqual([{ x: 652, y: -206 }]);
		expect(click_calls).toEqual([{ button: 'left', double: false }]);
	});

	it('rejects invalid pixel coordinates before native pixel access.', function()
	{
		var locked_window = LockWindow();

		expect(function()
		{
			locked_window.getPixelColor({ x: Number.NaN, y: 2 });
		}).toThrowError(TypeError, /finite numeric x and y/);
		expect(function()
		{
			locked_window.getPixelColor({ x: 1.5, y: 2 });
		}).toThrowError(TypeError, /integer x and y/);
		expect(function()
		{
			locked_window.getPixelColor({ x: 320, y: 2 });
		}).toThrowError(RangeError, /outside the locked window bounds/);
		expect(function()
		{
			locked_window.getPixelColor({ x: -1, y: 2 });
		}).toThrowError(RangeError, /outside the locked window bounds/);
		expect(pixel_calls).toEqual([]);
	});

	it('reports unusable refreshed window geometry as a scoped error.', function()
	{
		var locked_window = LockWindow();
		current_window.geometry = null;

		try
		{
			locked_window.getGeometry();
			fail('Expected unusable locked-window geometry to fail.');
		}
		catch (error)
		{
			expect(error).toEqual(jasmine.any(robot.ScopedWindowError));
			expect(error.code).toEqual('WINDOW_GEOMETRY_UNAVAILABLE');
		}
	});

	it('supports explicit active-window enforcement for observation methods.', function()
	{
		var locked_window = LockWindow();
		active_window = null;

		expect(locked_window.getGeometry().target.windowId).toEqual('42');
		expect(function()
		{
			locked_window.getMousePos({ require_active: true });
		}).toThrowError(robot.ScopedWindowError, /not active/);

		try
		{
			locked_window.toGlobalPoint({ x: 0, y: 0, require_active: true });
		}
		catch (error)
		{
			expect(error.code).toEqual('WINDOW_NOT_ACTIVE');
		}
	});

	it('fails closed if the locked window disappears.', function()
	{
		var locked_window = LockWindow();
		current_window = null;
		active_window = null;

		try
		{
			locked_window.getMousePos();
			fail('Expected the disappeared locked window to fail.');
		}
		catch (error)
		{
			expect(error).toEqual(jasmine.any(robot.ScopedWindowError));
			expect(error.code).toEqual('WINDOW_NOT_FOUND');
		}
	});

	it('rejects a different identity reusing the locked X11 window ID.', function()
	{
		var locked_window = LockWindow();
		current_window = CreateWindow({
			pid: 9999,
			className: 'replacement',
			instanceName: 'replacement'
		});
		active_window = current_window;

		try
		{
			locked_window.getGeometry();
			fail('Expected the reused window ID to fail identity verification.');
		}
		catch (error)
		{
			expect(error).toEqual(jasmine.any(robot.ScopedWindowError));
			expect(error.code).toEqual('WINDOW_IDENTITY_MISMATCH');
			expect(error.details.target.pid).toEqual(1200);
			expect(error.details.window.pid).toEqual(9999);
		}

		expect(function()
		{
			locked_window.moveMouse({ x: 10, y: 10 });
		}).toThrowError(robot.ScopedWindowError, /different window identity/);
		expect(function()
		{
			locked_window.holdKeysDown({ keys: 'control' });
		}).toThrowError(robot.ScopedWindowError, /different window identity/);
		expect(move_calls).toEqual([]);
		expect(key_calls).toEqual([]);
	});

	it('focuses and verifies before holding keys for a locked window.', function()
	{
		var locked_window = LockWindow();
		active_window = null;
		var handle = locked_window.holdKeysDown({
			keys: 'ctrl+shift'
		});

		expect(focus_calls).toEqual(['42']);
		expect(handle.target.windowId).toEqual('42');
		expect(handle.keys).toEqual(['control', 'shift']);
		expect(key_calls).toEqual([
			{ key: 'control', state: 'down' },
			{ key: 'shift', state: 'down' }
		]);

		current_window = null;
		active_window = null;
		expect(function()
		{
			handle.releaseKeys();
		}).not.toThrow();
		expect(key_calls.slice(2)).toEqual([
			{ key: 'shift', state: 'up' },
			{ key: 'control', state: 'up' }
		]);
	});

	it('can require a locked window to already be active before holding keys.', function()
	{
		var locked_window = LockWindow();
		active_window = null;

		try
		{
			locked_window.holdKeysDown({
				keys: 'control',
				require_active: true
			});
			fail('Expected inactive locked-window acquisition to fail.');
		}
		catch (error)
		{
			expect(error).toEqual(jasmine.any(robot.ScopedWindowError));
			expect(error.code).toEqual('WINDOW_NOT_ACTIVE');
		}
		expect(focus_calls).toEqual([]);
		expect(key_calls).toEqual([]);
	});
});
