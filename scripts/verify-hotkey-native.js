#!/usr/bin/env node
'use strict';

const native = require('../build/Release/robotjs.node');

function Assert(condition, message)
{
	if (!condition)
	{
		throw new Error(message);
	}
}

function WaitForEvent(manager_holder, registration_id, trigger)
{
	return new Promise(function(resolve, reject)
	{
		const timeout = setTimeout(function()
		{
			reject(new Error('Timed out waiting for native hotkey event.'));
		}, 3000);
		manager_holder.on_event = function(event)
		{
			if (event.registration_id === registration_id)
			{
				clearTimeout(timeout);
				resolve(event);
			}
		};
		trigger();
	});
}

async function Main()
{
	for (let cycle = 0; cycle < 8; cycle += 1)
	{
		const manager_holder = {
			on_event: function() {}
		};
		const manager = new native.NativeHotkeyManager(function(event)
		{
			manager_holder.on_event(event);
		});
		const registration_id = cycle + 1;
		manager.registerHotkey(registration_id, 'F12', 5);

		let conflict_detected = false;
		try
		{
			manager.registerHotkey(registration_id + 100, 'F12', 5);
		}
		catch (error)
		{
			conflict_detected = error.code === 'HOTKEY_CONFLICT';
		}
		Assert(conflict_detected, 'A duplicate native hotkey was not rejected.');

		const event = await WaitForEvent(manager_holder, registration_id, function()
		{
			native.keyTap('f12', ['control', 'shift']);
		});
		Assert(event.registration_id === registration_id, 'Native hotkey id is incorrect.');
		Assert(Number.isInteger(event.server_timestamp_ms), 'Native hotkey timestamp is invalid.');

		manager.unregisterHotkey(registration_id);
		manager.close();
	}

	const invalid_manager = new native.NativeHotkeyManager(function() {});
	let invalid_key_detected = false;
	try
	{
		invalid_manager.registerHotkey(500, 'Definitely_Not_An_X11_Key', 0);
	}
	catch (error)
	{
		invalid_key_detected = error.code === 'HOTKEY_INVALID_KEY';
	}
	Assert(invalid_key_detected, 'An invalid native hotkey was not rejected.');
	invalid_manager.close();

	if (typeof global.gc === 'function')
	{
		global.gc();
		await new Promise(function(resolve) { setImmediate(resolve); });
		global.gc();
	}

	console.log('native hotkey verification passed');
}

Main().catch(function(error)
{
	console.error(error && error.stack ? error.stack : String(error));
	process.exit(1);
});
