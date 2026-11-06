#!/usr/bin/env node
'use strict';

const robot = require('..');

function Assert(condition, message)
{
	if (!condition) throw new Error(message);
}

function AssertCaptureRejected(args)
{
	let rejected = false;
	try
	{
		robot.screen.capture(...args);
	}
	catch (error)
	{
		rejected = true;
	}
	Assert(rejected, 'Invalid capture region was accepted: ' + JSON.stringify(args));
}

async function Main()
{
	for (let index = 0; index < 25; index += 1)
	{
		const bitmap = robot.screen.capture(index, index, 1, 1);
		Assert(bitmap.width === 1 && bitmap.height === 1, 'Capture dimensions are invalid.');
		Assert(bitmap.image.length >= bitmap.byteWidth, 'Capture buffer is shorter than its row stride.');
	}

	AssertCaptureRejected([-1, 0, 1, 1]);
	AssertCaptureRejected([0, 0, 0, 1]);
	AssertCaptureRejected([robot.getScreenSize().width, 0, 1, 1]);

	if (typeof global.gc === 'function')
	{
		global.gc();
		await new Promise(function(resolve) { setImmediate(resolve); });
		global.gc();
	}

	console.log('native screen capture verification passed');
}

Main().catch(function(error)
{
	console.error(error && error.stack ? error.stack : String(error));
	process.exit(1);
});
