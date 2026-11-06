'use strict';

const fs = require('node:fs');
const held_key_manager = require('../../lib/held_key_manager.js');

const mode = process.argv[2];
const log_path = process.argv[3];

function Log(value)
{
	fs.appendFileSync(log_path, value + '\n');
}

const service = held_key_manager.CreateHeldKeyService({
	toggle_key: function(key, state)
	{
		Log(key + ':' + state);
	},
	report_cleanup_error: function(error, reason)
	{
		Log('cleanup_error:' + reason + ':' + error.code);
	}
});

service.HoldKeysDown({ keys: 'control+shift' });

if (mode === 'natural')
{
	// Let the event loop finish naturally.
}
else if (mode === 'explicit_exit')
{
	process.exit(7);
}
else if (mode === 'uncaught')
{
	throw new Error('intentional held-key child failure');
}
else if (mode === 'application_signal')
{
	process.on('SIGTERM', function()
	{
		Log('application:SIGTERM');
		process.exit(23);
	});
	setImmediate(function()
	{
		process.kill(process.pid, 'SIGTERM');
	});
}
else if (['SIGHUP', 'SIGINT', 'SIGTERM'].includes(mode))
{
	setTimeout(function()
	{
		process.exit(99);
	}, 2000);
	setImmediate(function()
	{
		process.kill(process.pid, mode);
	});
}
else
{
	throw new Error('Unknown held-key child mode: ' + mode);
}
