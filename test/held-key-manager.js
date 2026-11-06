'use strict';

const child_process = require('node:child_process');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const held_key_manager = require('../lib/held_key_manager.js');
const robot = require('..');

class FakeProcess extends EventEmitter
{
	constructor()
	{
		super();
		this.pid = 4242;
		this.kill_calls = [];
	}

	kill(pid, signal)
	{
		this.kill_calls.push({
			pid: pid,
			signal: signal
		});
	}
}

function CreateService(params)
{
	const settings = params || {};
	const events = settings.events || [];
	const fake_process = settings.process_object || new FakeProcess();
	const cleanup_errors = [];
	const service = held_key_manager.CreateHeldKeyService({
		toggle_key: settings.toggle_key || function(key, state)
		{
			events.push({ key: key, state: state });
		},
		process_object: fake_process,
		report_cleanup_error: function(error, reason)
		{
			cleanup_errors.push({
				error: error,
				reason: reason
			});
		}
	});

	return {
		service: service,
		events: events,
		process: fake_process,
		cleanup_errors: cleanup_errors
	};
}

function RunLifecycleChild(mode)
{
	const temporary_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'robotts-held-key-'));
	const log_path = path.join(temporary_directory, 'events.log');
	const result = child_process.spawnSync(process.execPath, [
		path.join(__dirname, 'fixtures', 'held-key-process.js'),
		mode,
		log_path
	], {
		encoding: 'utf8',
		timeout: 5000
	});
	const events = fs.existsSync(log_path)
		? fs.readFileSync(log_path, 'utf8').trim().split('\n')
		: [];
	fs.rmSync(temporary_directory, {
		recursive: true,
		force: true
	});

	return {
		result: result,
		events: events
	};
}

describe('Held Key Manager', function()
{
	it('normalizes aliases, deduplicates keys, and orders modifiers first.', function()
	{
		expect(held_key_manager.ParseHeldKeys(' Shift + CTRL + control + b + a ')).toEqual(
			jasmine.objectContaining({
				chord: 'control+shift+a+b',
				keys: ['control', 'shift', 'a', 'b']
			})
		);
		expect(held_key_manager.ParseHeldKeys(['cmd', 'option', 'right_shift']).keys)
			.toEqual(['alt', 'right_shift', 'super']);
		expect(held_key_manager.ParseHeldKeys('ctrl+shift').chord)
			.toEqual('control+shift');
		expect(held_key_manager.ParseHeldKeys('return+esc').keys)
			.toEqual(['enter', 'escape']);
	});

	it('rejects empty, malformed, oversized, and unsupported key input.', function()
	{
		expect(function()
		{
			held_key_manager.ParseHeldKeys('');
		}).toThrowError(TypeError, /empty/);
		expect(function()
		{
			held_key_manager.ParseHeldKeys('control++shift');
		}).toThrowError(TypeError, /empty/);
		expect(function()
		{
			held_key_manager.ParseHeldKeys(['control', 12]);
		}).toThrowError(TypeError, /non-string/);
		expect(function()
		{
			held_key_manager.ParseHeldKeys('control+not_a_key');
		}).toThrowError(TypeError, /unsupported key/);
		expect(function()
		{
			held_key_manager.ParseHeldKeys(new Array(33).fill('a'));
		}).toThrowError(RangeError, /no more than 32/);
	});

	it('presses in canonical order and releases in reverse order.', function()
	{
		const context = CreateService();
		const handle = context.service.HoldKeysDown({
			keys: 'b+shift+control+a',
			target: { windowId: '42' }
		});

		expect(handle.chord).toEqual('control+shift+a+b');
		expect(handle.keys).toEqual(['control', 'shift', 'a', 'b']);
		expect(handle.target).toEqual({ windowId: '42' });
		expect(handle.active).toBeTrue();
		expect(handle.pendingKeys).toEqual(['control', 'shift', 'a', 'b']);
		expect(context.events).toEqual([
			{ key: 'control', state: 'down' },
			{ key: 'shift', state: 'down' },
			{ key: 'a', state: 'down' },
			{ key: 'b', state: 'down' }
		]);

		const result = handle.releaseKeys();
		expect(result).toEqual({
			chord: 'control+shift+a+b',
			released_keys: ['b', 'a', 'shift', 'control'],
			shared_keys: []
		});
		expect(handle.active).toBeFalse();
		expect(handle.pendingKeys).toEqual([]);
		expect(context.events.slice(4)).toEqual([
			{ key: 'b', state: 'up' },
			{ key: 'a', state: 'up' },
			{ key: 'shift', state: 'up' },
			{ key: 'control', state: 'up' }
		]);
		expect(handle.releaseKeys()).toBe(result);
	});

	it('reference-counts keys shared by overlapping handles.', function()
	{
		const context = CreateService();
		const first = context.service.HoldKeysDown({ keys: 'control+shift' });
		const second = context.service.HoldKeysDown({ keys: 'ctrl+alt' });

		expect(context.events).toEqual([
			{ key: 'control', state: 'down' },
			{ key: 'shift', state: 'down' },
			{ key: 'alt', state: 'down' }
		]);
		expect(first.releaseKeys()).toEqual({
			chord: 'control+shift',
			released_keys: ['shift'],
			shared_keys: ['control']
		});
		expect(context.events.slice(3)).toEqual([
			{ key: 'shift', state: 'up' }
		]);

		second.releaseKeys();
		expect(context.events.slice(4)).toEqual([
			{ key: 'alt', state: 'up' },
			{ key: 'control', state: 'up' }
		]);
	});

	it('rolls back acquired keys when a later key-down fails.', function()
	{
		const events = [];
		const context = CreateService({
			events: events,
			toggle_key: function(key, state)
			{
				events.push({ key: key, state: state });
				if (key === 'shift' && state === 'down')
				{
					throw new Error('shift down failed');
				}
			}
		});

		try
		{
			context.service.HoldKeysDown({ keys: 'control+shift+a' });
			fail('Expected acquisition to fail.');
		}
		catch (error)
		{
			expect(error).toEqual(jasmine.any(held_key_manager.HeldKeyError));
			expect(error.code).toEqual('HELD_KEYS_ACQUIRE_FAILED');
			expect(error.details.acquired_keys).toEqual(['control']);
			expect(error.details.rollback_released_keys).toEqual(['control']);
			expect(error.details.unreleased_keys).toEqual([]);
		}
		expect(events).toEqual([
			{ key: 'control', state: 'down' },
			{ key: 'shift', state: 'down' },
			{ key: 'control', state: 'up' }
		]);
		expect(context.process.eventNames()).toEqual([]);
	});

	it('retains rollback failures for explicit cleanup retries.', function()
	{
		let fail_control_release = true;
		const context = CreateService({
			toggle_key: function(key, state)
			{
				if (key === 'shift' && state === 'down')
				{
					throw new Error('shift down failed');
				}
				if (key === 'control' && state === 'up' && fail_control_release)
				{
					throw new Error('control up failed');
				}
			}
		});

		try
		{
			context.service.HoldKeysDown({ keys: 'control+shift' });
			fail('Expected acquisition to fail.');
		}
		catch (error)
		{
			expect(error.code).toEqual('HELD_KEYS_ACQUIRE_FAILED');
			expect(error.details.unreleased_keys).toEqual(['control']);
			expect(error.details.release_failures[0].key).toEqual('control');
		}
		expect(context.process.listenerCount('exit')).toEqual(1);

		fail_control_release = false;
		expect(context.service.ReleaseAllHeldKeys()).toEqual({
			released_keys: ['control'],
			unreleased_keys: []
		});
		expect(context.process.listenerCount('exit')).toEqual(0);
	});

	it('attempts every key-up after a release failure and supports retry.', function()
	{
		const events = [];
		let fail_shift_release = true;
		const context = CreateService({
			events: events,
			toggle_key: function(key, state)
			{
				events.push({ key: key, state: state });
				if (key === 'shift' && state === 'up' && fail_shift_release)
				{
					throw new Error('shift up failed');
				}
			}
		});
		const handle = context.service.HoldKeysDown({ keys: 'control+shift+a' });

		try
		{
			handle.releaseKeys();
			fail('Expected release to fail.');
		}
		catch (error)
		{
			expect(error.code).toEqual('HELD_KEYS_RELEASE_FAILED');
			expect(error.details.released_keys).toEqual(['a', 'control']);
			expect(error.details.unreleased_keys).toEqual(['shift']);
		}
		expect(handle.active).toBeTrue();
		expect(handle.pendingKeys).toEqual(['shift']);
		expect(handle.lastError.code).toEqual('HELD_KEYS_RELEASE_FAILED');

		fail_shift_release = false;
		const retry_result = handle.releaseKeys();
		expect(retry_result.released_keys).toEqual(['shift']);
		expect(handle.active).toBeFalse();
		expect(handle.lastError).toBeNull();
		expect(handle.releaseKeys()).toBe(retry_result);
	});

	it('emergency cleanup releases each physical key once in reverse acquisition order.', function()
	{
		const context = CreateService();
		const first = context.service.HoldKeysDown({ keys: 'control+shift' });
		const second = context.service.HoldKeysDown({ keys: 'control+alt+a' });
		const result = context.service.ReleaseAllHeldKeys();

		expect(result).toEqual({
			released_keys: ['a', 'alt', 'shift', 'control'],
			unreleased_keys: []
		});
		expect(context.events.slice(4)).toEqual([
			{ key: 'a', state: 'up' },
			{ key: 'alt', state: 'up' },
			{ key: 'shift', state: 'up' },
			{ key: 'control', state: 'up' }
		]);
		expect(first.active).toBeFalse();
		expect(second.active).toBeFalse();
		expect(context.service.ReleaseAllHeldKeys()).toEqual({
			released_keys: [],
			unreleased_keys: []
		});
	});

	it('installs one cleanup hook set and removes it after the final release.', function()
	{
		const context = CreateService();
		const first = context.service.HoldKeysDown({ keys: 'control' });
		const second = context.service.HoldKeysDown({ keys: 'shift' });

		for (const event_name of [
			'beforeExit',
			'exit',
			'uncaughtExceptionMonitor',
			'SIGHUP',
			'SIGINT',
			'SIGTERM'
		])
		{
			expect(context.process.listenerCount(event_name)).toEqual(1);
		}
		first.releaseKeys();
		expect(context.process.listenerCount('exit')).toEqual(1);
		second.releaseKeys();
		expect(context.process.eventNames()).toEqual([]);
	});

	for (const exit_event of ['beforeExit', 'exit', 'uncaughtExceptionMonitor'])
	{
		it('releases held keys during ' + exit_event + ' cleanup.', function()
		{
			const context = CreateService();
			const handle = context.service.HoldKeysDown({ keys: 'control+shift' });

			context.process.emit(exit_event, new Error('simulated'));

			expect(context.events.slice(2)).toEqual([
				{ key: 'shift', state: 'up' },
				{ key: 'control', state: 'up' }
			]);
			expect(handle.active).toBeFalse();
			expect(context.process.eventNames()).toEqual([]);
		});
	}

	for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'])
	{
		it('cleans up and re-raises ' + signal + ' when RobotTS is the only listener.', function()
		{
			const context = CreateService();
			const handle = context.service.HoldKeysDown({ keys: 'control' });

			context.process.emit(signal);

			expect(handle.active).toBeFalse();
			expect(context.process.kill_calls).toEqual([{
				pid: 4242,
				signal: signal
			}]);
			expect(context.process.eventNames()).toEqual([]);
		});
	}

	it('does not re-raise a signal when an application listener is present.', function()
	{
		const fake_process = new FakeProcess();
		const events = [];
		fake_process.on('SIGTERM', function()
		{
			events.push('application');
		});
		const context = CreateService({
			events: events,
			process_object: fake_process,
			toggle_key: function(key, state)
			{
				events.push(key + ':' + state);
			}
		});
		const handle = context.service.HoldKeysDown({ keys: 'control' });

		fake_process.emit('SIGTERM');

		expect(events).toEqual([
			'control:down',
			'control:up',
			'application'
		]);
		expect(handle.active).toBeFalse();
		expect(fake_process.kill_calls).toEqual([]);
		expect(fake_process.listenerCount('SIGTERM')).toEqual(1);
	});

	it('reports cleanup failures without skipping remaining key releases.', function()
	{
		const events = [];
		const context = CreateService({
			events: events,
			toggle_key: function(key, state)
			{
				events.push({ key: key, state: state });
				if (key === 'shift' && state === 'up')
				{
					throw new Error('shift release failed');
				}
			}
		});
		const handle = context.service.HoldKeysDown({ keys: 'control+shift+a' });

		context.process.emit('beforeExit');

		expect(context.cleanup_errors.length).toEqual(1);
		expect(context.cleanup_errors[0].reason).toEqual('beforeExit');
		expect(context.cleanup_errors[0].error.code).toEqual('HELD_KEYS_CLEANUP_FAILED');
		expect(context.cleanup_errors[0].error.details.released_keys).toEqual(['a', 'control']);
		expect(handle.pendingKeys).toEqual(['shift']);
		expect(events.slice(3)).toEqual([
			{ key: 'a', state: 'up' },
			{ key: 'shift', state: 'up' },
			{ key: 'control', state: 'up' }
		]);
	});

	it('releases keys in real child processes during natural and explicit exit.', function()
	{
		const natural = RunLifecycleChild('natural');
		expect(natural.result.status).toEqual(0);
		expect(natural.events).toEqual([
			'control:down',
			'shift:down',
			'shift:up',
			'control:up'
		]);

		const explicit = RunLifecycleChild('explicit_exit');
		expect(explicit.result.status).toEqual(7);
		expect(explicit.events).toEqual(natural.events);
	});

	it('releases keys without changing default uncaught-exception behavior.', function()
	{
		const child = RunLifecycleChild('uncaught');

		expect(child.result.status).not.toEqual(0);
		expect(child.result.stderr).toContain('intentional held-key child failure');
		expect(child.events).toEqual([
			'control:down',
			'shift:down',
			'shift:up',
			'control:up'
		]);
	});

	for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'])
	{
		it('releases keys and preserves default ' + signal + ' termination in a child process.', function()
		{
			const child = RunLifecycleChild(signal);

			expect(child.result.signal).toEqual(signal);
			expect(child.events).toEqual([
				'control:down',
				'shift:down',
				'shift:up',
				'control:up'
			]);
		});
	}

	it('runs an application signal listener after cleanup without re-raising the signal.', function()
	{
		const child = RunLifecycleChild('application_signal');

		expect(child.result.status).toEqual(23);
		expect(child.result.signal).toBeNull();
		expect(child.events).toEqual([
			'control:down',
			'shift:down',
			'shift:up',
			'control:up',
			'application:SIGTERM'
		]);
	});
});

describe('Held Key Public API', function()
{
	let original_key_toggle;
	let key_events;

	beforeEach(function()
	{
		original_key_toggle = robot.keyToggle;
		key_events = [];
		robot.keyToggle = function(key, state)
		{
			key_events.push({ key: key, state: state });
		};
		robot.desktop.releaseAllHeldKeys();
	});

	afterEach(function()
	{
		robot.desktop.releaseAllHeldKeys();
		robot.keyToggle = original_key_toggle;
	});

	it('acquires and releases desktop-wide held keys.', function()
	{
		const handle = robot.desktop.holdKeysDown({
			keys: ['shift', 'ctrl', 'control']
		});

		expect(handle).toEqual(jasmine.objectContaining({
			chord: 'control+shift',
			keys: ['control', 'shift'],
			target: null
		}));
		expect(handle.active).toBeTrue();
		expect(key_events).toEqual([
			{ key: 'control', state: 'down' },
			{ key: 'shift', state: 'down' }
		]);

		handle.releaseKeys();
		expect(key_events.slice(2)).toEqual([
			{ key: 'shift', state: 'up' },
			{ key: 'control', state: 'up' }
		]);
	});

	it('validates desktop hold options and exposes emergency release.', function()
	{
		expect(function()
		{
			robot.desktop.holdKeysDown({
				keys: 'control',
				require_active: true
			});
		}).toThrowError(TypeError, /require_active is not a supported option/);

		const first = robot.desktop.holdKeysDown({ keys: 'control' });
		const second = robot.desktop.holdKeysDown({ keys: 'control+alt' });
		const result = robot.desktop.releaseAllHeldKeys();

		expect(result.released_keys).toEqual(['alt', 'control']);
		expect(first.active).toBeFalse();
		expect(second.active).toBeFalse();
		expect(robot.HeldKeyError).toBe(held_key_manager.HeldKeyError);
	});
});
