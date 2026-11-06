'use strict';

const hotkey_manager = require('../lib/hotkey_manager.js');

class FakeNativeHotkeyManager
{
	constructor(callback)
	{
		if (FakeNativeHotkeyManager.constructor_error)
		{
			throw FakeNativeHotkeyManager.constructor_error;
		}
		this.callback = callback;
		this.registrations = new Map();
		this.closed = false;
		FakeNativeHotkeyManager.instances.push(this);
	}

	registerHotkey(id, key, modifiers)
	{
		if (FakeNativeHotkeyManager.registration_error)
		{
			throw FakeNativeHotkeyManager.registration_error;
		}
		this.registrations.set(id, {key: key, modifiers: modifiers});
	}

	unregisterHotkey(id)
	{
		if (!this.registrations.delete(id))
		{
			const error = new Error('Registration not found.');
			error.code = 'HOTKEY_NOT_FOUND';
			throw error;
		}
	}

	close()
	{
		this.closed = true;
	}

	fire(id, timestamp)
	{
		this.callback({
			registration_id: id,
			server_timestamp_ms: timestamp
		});
	}

	static reset()
	{
		FakeNativeHotkeyManager.instances = [];
		FakeNativeHotkeyManager.constructor_error = null;
		FakeNativeHotkeyManager.registration_error = null;
	}
}

FakeNativeHotkeyManager.reset();

function CreateService(robot)
{
	return hotkey_manager.CreateHotkeyService({
		NativeHotkeyManager: FakeNativeHotkeyManager,
		get_robot: function()
		{
			return robot;
		}
	});
}

function FlushPromises()
{
	return new Promise(function(resolve)
	{
		setImmediate(resolve);
	});
}

describe('Hotkey Manager', function()
{
	beforeEach(function()
	{
		FakeNativeHotkeyManager.reset();
	});

	it('normalizes aliases and modifier ordering.', function()
	{
		expect(hotkey_manager.ParseHotkey(' Shift + CONTROL + J ')).toEqual(
			jasmine.objectContaining({
				hotkey: 'ctrl+shift+j',
				native_key: 'j',
				logical_modifiers: 5
			})
		);
		expect(hotkey_manager.ParseHotkey('win+esc')).toEqual(
			jasmine.objectContaining({
				hotkey: 'super+escape',
				native_key: 'Escape',
				logical_modifiers: 8
			})
		);
		expect(hotkey_manager.ParseHotkey('alt+f12').native_key).toEqual('F12');
	});

	it('rejects malformed or unsupported hotkeys.', function()
	{
		expect(function()
		{
			hotkey_manager.ParseHotkey('ctrl+alt');
		}).toThrowError(TypeError, /non-modifier key/);
		expect(function()
		{
			hotkey_manager.ParseHotkey('ctrl+ctrl+j');
		}).toThrowError(TypeError, /duplicate ctrl/);
		expect(function()
		{
			hotkey_manager.ParseHotkey('ctrl+j+k');
		}).toThrowError(TypeError, /exactly one/);
		expect(function()
		{
			hotkey_manager.ParseHotkey('ctrl+not_a_key');
		}).toThrowError(TypeError, /unsupported key/);
	});

	it('registers a canonical chord and dispatches typed callback data.', async function()
	{
		const robot = {marker: 'robot'};
		const service = CreateService(robot);
		const extra = {workflow_id: 'checkout'};
		const calls = [];
		const registration = await service.RegisterHotkey({
			name: 'checkout.confirm',
			hotkey: 'SHIFT+ctrl+j',
			extra: extra,
			on_pressed: async function(event, robot_instance, callback_extra)
			{
				calls.push({event: event, robot: robot_instance, extra: callback_extra});
			}
		});
		const native_manager = FakeNativeHotkeyManager.instances[0];
		const native_registration = Array.from(native_manager.registrations.entries())[0];

		expect(registration.hotkey).toEqual('ctrl+shift+j');
		expect(native_registration[1]).toEqual({key: 'j', modifiers: 5});

		native_manager.fire(native_registration[0], 12_345);
		await FlushPromises();

		expect(calls.length).toEqual(1);
		expect(calls[0].event).toEqual(jasmine.objectContaining({
			type: 'hotkey_pressed',
			name: 'checkout.confirm',
			hotkey: 'ctrl+shift+j',
			sequence: 1,
			server_timestamp_ms: 12_345
		}));
		expect(calls[0].robot).toBe(robot);
		expect(calls[0].extra).toBe(extra);
	});

	it('rejects duplicate names and canonical chords.', async function()
	{
		const service = CreateService({});
		await service.RegisterHotkey({
			name: 'first',
			hotkey: 'control+j',
			on_pressed: function() {}
		});

		await expectAsync(service.RegisterHotkey({
			name: 'first',
			hotkey: 'ctrl+k',
			on_pressed: function() {}
		})).toBeRejectedWith(jasmine.objectContaining({code: 'HOTKEY_CONFLICT'}));
		await expectAsync(service.RegisterHotkey({
			name: 'second',
			hotkey: 'ctrl+j',
			on_pressed: function() {}
		})).toBeRejectedWith(jasmine.objectContaining({code: 'HOTKEY_CONFLICT'}));
	});

	it('unregisters idempotently and closes an unused native manager.', async function()
	{
		const service = CreateService({});
		const registration = await service.RegisterHotkey({
			name: 'temporary',
			hotkey: 'alt+f8',
			on_pressed: function() {}
		});
		const native_manager = FakeNativeHotkeyManager.instances[0];

		const completion = await registration.unregister();
		expect(completion).toEqual(jasmine.objectContaining({
			reason: 'unregistered',
			name: 'temporary',
			hotkey: 'alt+f8',
			error: null
		}));
		expect(registration.active).toBeFalse();
		expect(native_manager.registrations.size).toEqual(0);
		expect(native_manager.closed).toBeTrue();
		expect(await registration.unregister()).toBe(completion);
	});

	it('unregisters when its AbortSignal is cancelled.', async function()
	{
		const service = CreateService({});
		const controller = new AbortController();
		const reason = new Error('stop hotkey');
		const registration = await service.RegisterHotkey({
			name: 'abortable',
			hotkey: 'super+f9',
			signal: controller.signal,
			on_pressed: function() {}
		});

		controller.abort(reason);
		const completion = await registration.completion;
		expect(completion.reason).toEqual('aborted');
		expect(completion.error).toBe(reason);
		expect(registration.active).toBeFalse();
	});

	it('unregisters by default after reporting a callback failure.', async function()
	{
		const service = CreateService({});
		const reported_errors = [];
		const registration = await service.RegisterHotkey({
			name: 'failing',
			hotkey: 'ctrl+f10',
			on_pressed: function()
			{
				throw new Error('callback exploded');
			},
			on_error: function(event)
			{
				reported_errors.push(event.error);
			}
		});
		const native_manager = FakeNativeHotkeyManager.instances[0];
		const registration_id = Array.from(native_manager.registrations.keys())[0];

		native_manager.fire(registration_id, 100);
		const completion = await registration.completion;

		expect(completion.reason).toEqual('callback_error');
		expect(completion.error).toEqual(jasmine.objectContaining({
			code: 'HOTKEY_CALLBACK_FAILED'
		}));
		expect(reported_errors).toEqual([
			jasmine.objectContaining({code: 'HOTKEY_CALLBACK_FAILED'})
		]);
		expect(registration.active).toBeFalse();
	});

	it('can continue after callback failures without unhandled rejections.', async function()
	{
		const service = CreateService({});
		let invocation_count = 0;
		const registration = await service.RegisterHotkey({
			name: 'resilient',
			hotkey: 'ctrl+f11',
			callback_error_policy: 'continue',
			on_pressed: function()
			{
				invocation_count += 1;
				throw new Error('expected failure');
			}
		});
		const native_manager = FakeNativeHotkeyManager.instances[0];
		const registration_id = Array.from(native_manager.registrations.keys())[0];

		native_manager.fire(registration_id, 100);
		await FlushPromises();
		native_manager.fire(registration_id, 200);
		await FlushPromises();

		expect(invocation_count).toEqual(2);
		expect(registration.active).toBeTrue();
		expect(registration.lastError).toEqual(jasmine.objectContaining({
			code: 'HOTKEY_CALLBACK_FAILED'
		}));
		await registration.unregister();
	});

	it('bounds pending callbacks and reports overflow.', async function()
	{
		const service = CreateService({});
		let release_callback;
		const callback_blocker = new Promise(function(resolve)
		{
			release_callback = resolve;
		});
		const errors = [];
		const registration = await service.RegisterHotkey({
			name: 'bounded',
			hotkey: 'ctrl+f12',
			max_pending_callbacks: 1,
			on_pressed: function()
			{
				return callback_blocker;
			},
			on_error: function(event)
			{
				errors.push(event.error);
			}
		});
		const native_manager = FakeNativeHotkeyManager.instances[0];
		const registration_id = Array.from(native_manager.registrations.keys())[0];

		native_manager.fire(registration_id, 100);
		native_manager.fire(registration_id, 200);
		await FlushPromises();

		expect(registration.pendingCallbacks).toEqual(1);
		expect(errors).toEqual([
			jasmine.objectContaining({code: 'HOTKEY_CALLBACK_QUEUE_FULL'})
		]);

		release_callback();
		await FlushPromises();
		await registration.unregister();
	});

	it('maps native conflicts and unavailable backends to HotkeyError.', async function()
	{
		const conflict = new Error('already grabbed');
		conflict.code = 'HOTKEY_CONFLICT';
		FakeNativeHotkeyManager.registration_error = conflict;
		const service = CreateService({});

		await expectAsync(service.RegisterHotkey({
			name: 'conflict',
			hotkey: 'ctrl+j',
			on_pressed: function() {}
		})).toBeRejectedWith(jasmine.objectContaining({
			name: 'HotkeyError',
			code: 'HOTKEY_CONFLICT'
		}));

		FakeNativeHotkeyManager.registration_error = null;
		const unavailable = new Error('no display');
		unavailable.code = 'HOTKEY_BACKEND_UNAVAILABLE';
		FakeNativeHotkeyManager.constructor_error = unavailable;
		const unavailable_service = CreateService({});
		await expectAsync(unavailable_service.RegisterHotkey({
			name: 'unavailable',
			hotkey: 'ctrl+k',
			on_pressed: function() {}
		})).toBeRejectedWith(jasmine.objectContaining({
			name: 'HotkeyError',
			code: 'HOTKEY_BACKEND_UNAVAILABLE'
		}));
	});
});
