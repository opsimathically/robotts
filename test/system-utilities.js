'use strict';

const child_process = require('node:child_process');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const robot = require('..');

function CreateFakeChild()
{
	const child = new EventEmitter();
	child.killed = false;
	child.stderr = new EventEmitter();
	child.stderr.setEncoding = function() {};
	child.kill = jasmine.createSpy('kill').and.callFake(function()
	{
		child.killed = true;
		return true;
	});
	return child;
}

function EmitClose(child, exit_code, signal)
{
	queueMicrotask(function()
	{
		child.emit('close', exit_code, signal || null);
	});
}

function EmitMissingExecutable(child)
{
	queueMicrotask(function()
	{
		const error = new Error('Executable not found.');
		error.code = 'ENOENT';
		child.emit('error', error);
		child.emit('close', -2, null);
	});
}

describe('System Utilities', function()
{
	describe('randomIntegerBetween', function()
	{
		it('includes both bounds and supports negative ranges.', function()
		{
			spyOn(crypto, 'randomBytes').and.returnValues(
				Buffer.from([0x00]),
				Buffer.from([0x0A])
			);

			expect(robot.randomIntegerBetween(-5, 5)).toEqual(-5);
			expect(robot.randomIntegerBetween(-5, 5)).toEqual(5);
			expect(crypto.randomBytes).toHaveBeenCalledTimes(2);
			expect(crypto.randomBytes).toHaveBeenCalledWith(1);
		});

		it('rejects out-of-range samples instead of introducing modulo bias.', function()
		{
			spyOn(crypto, 'randomBytes').and.returnValues(
				Buffer.from([0xFF]),
				Buffer.from([0x05])
			);

			expect(robot.randomIntegerBetween(-5, 5)).toEqual(0);
			expect(crypto.randomBytes).toHaveBeenCalledTimes(2);
		});

		it('returns equal bounds without requesting entropy.', function()
		{
			const random_bytes = spyOn(crypto, 'randomBytes');

			expect(robot.randomIntegerBetween(42, 42)).toEqual(42);
			expect(random_bytes).not.toHaveBeenCalled();
		});

		it('supports the complete safe-integer range.', function()
		{
			spyOn(crypto, 'randomBytes').and.returnValue(Buffer.alloc(7));

			expect(robot.randomIntegerBetween(
				Number.MIN_SAFE_INTEGER,
				Number.MAX_SAFE_INTEGER
			)).toEqual(Number.MIN_SAFE_INTEGER);
			expect(crypto.randomBytes).toHaveBeenCalledOnceWith(7);
		});

		it('rejects invalid and reversed bounds.', function()
		{
			expect(function()
			{
				robot.randomIntegerBetween('1', 2);
			}).toThrowError(TypeError, /min_value must be a number/);
			expect(function()
			{
				robot.randomIntegerBetween(1, 2.5);
			}).toThrowError(RangeError, /max_value must be a safe integer/);
			expect(function()
			{
				robot.randomIntegerBetween(Number.MIN_SAFE_INTEGER - 1, 0);
			}).toThrowError(RangeError, /min_value must be a safe integer/);
			expect(function()
			{
				robot.randomIntegerBetween(2, 1);
			}).toThrowError(RangeError, /greater than or equal/);
		});
	});

	describe('sleep', function()
	{
		beforeEach(function()
		{
			jasmine.clock().install();
		});

		afterEach(function()
		{
			jasmine.clock().uninstall();
		});

		it('adds duration components and resolves asynchronously.', async function()
		{
			let resolved = false;
			const completion = robot.sleep({
				seconds: 1,
				milliseconds: 250
			}).then(function()
			{
				resolved = true;
			});

			jasmine.clock().tick(1_249);
			await Promise.resolve();
			expect(resolved).toBeFalse();

			jasmine.clock().tick(1);
			await completion;
			expect(resolved).toBeTrue();
		});

		it('selects an inclusive random duration between normalized bounds.', async function()
		{
			spyOn(crypto, 'randomInt').and.returnValue(250);
			let resolved = false;
			const completion = robot.sleepRandom({
				minimum: {seconds: 1},
				maximum: {seconds: 2}
			}).then(function()
			{
				resolved = true;
			});

			expect(crypto.randomInt).toHaveBeenCalledOnceWith(1_001);
			jasmine.clock().tick(1_249);
			await Promise.resolve();
			expect(resolved).toBeFalse();

			jasmine.clock().tick(1);
			await completion;
			expect(resolved).toBeTrue();
		});

		it('rejects with the AbortSignal reason and clears the timer.', async function()
		{
			const controller = new AbortController();
			const reason = new Error('stop waiting');
			const completion = robot.sleep({
				hours: 1,
				signal: controller.signal
			});

			controller.abort(reason);
			await expectAsync(completion).toBeRejectedWith(reason);
			expect(jasmine.clock().mockDate).toBeDefined();
		});

		it('validates duration fields and random bound ordering.', function()
		{
			expect(function()
			{
				robot.sleep({seconds: -1});
			}).toThrowError(RangeError, /non-negative safe integer/);

			expect(function()
			{
				robot.sleep({sec: 1});
			}).toThrowError(TypeError, /not a supported option/);

			expect(function()
			{
				robot.sleepRandom({
					minimum: {seconds: 2},
					maximum: {seconds: 1}
				});
			}).toThrowError(RangeError, /must not be shorter/);
		});
	});

	describe('dialogs', function()
	{
		it('shows a message with the first available provider.', async function()
		{
			const child = CreateFakeChild();
			spyOn(child_process, 'spawn').and.callFake(function()
			{
				EmitClose(child, 0);
				return child;
			});

			await robot.showMessageBox({
				title: 'Status',
				message: 'The operation completed.'
			});

			expect(child_process.spawn).toHaveBeenCalledWith(
				'zenity',
				[
					'--info',
					'--title=Status',
					'--text=The operation completed.',
					'--ok-label=Close'
				],
				{stdio: ['ignore', 'ignore', 'pipe']}
			);
		});

		it('falls back when a dialog executable is unavailable.', async function()
		{
			const zenity_child = CreateFakeChild();
			const kdialog_child = CreateFakeChild();
			const xmessage_child = CreateFakeChild();
			let invocation = 0;

			spyOn(child_process, 'spawn').and.callFake(function()
			{
				invocation += 1;
				if (invocation === 1)
				{
					EmitMissingExecutable(zenity_child);
					return zenity_child;
				}
				if (invocation === 2)
				{
					EmitMissingExecutable(kdialog_child);
					return kdialog_child;
				}
				EmitClose(xmessage_child, 0);
				return xmessage_child;
			});

			await robot.showMessageBox({message: 'Fallback'});

			expect(child_process.spawn.calls.allArgs().map(function(args)
			{
				return args[0];
			})).toEqual(['zenity', 'kdialog', 'xmessage']);
		});

		it('returns explicit confirmation and cancellation results.', async function()
		{
			const confirm_child = CreateFakeChild();
			const cancel_child = CreateFakeChild();
			spyOn(child_process, 'spawn').and.returnValues(confirm_child, cancel_child);

			const confirm_completion = robot.showConfirmationDialog({message: 'Continue?'});
			EmitClose(confirm_child, 0);
			await expectAsync(confirm_completion).toBeResolvedTo('confirm');

			const cancel_completion = robot.showConfirmationDialog({message: 'Continue?'});
			EmitClose(cancel_child, 1);
			await expectAsync(cancel_completion).toBeResolvedTo('cancel');
		});

		it('terminates the dialog process when externally cancelled.', async function()
		{
			const child = CreateFakeChild();
			const controller = new AbortController();
			const reason = new Error('dialog no longer needed');
			spyOn(child_process, 'spawn').and.returnValue(child);

			const completion = robot.showMessageBox({
				message: 'Waiting',
				signal: controller.signal
			});
			controller.abort(reason);

			await expectAsync(completion).toBeRejectedWith(reason);
			expect(child.kill).toHaveBeenCalledOnceWith('SIGTERM');
		});

		it('reports unavailable providers and unexpected failures.', async function()
		{
			spyOn(child_process, 'spawn').and.callFake(function()
			{
				const child = CreateFakeChild();
				EmitMissingExecutable(child);
				return child;
			});

			const unavailable = robot.showMessageBox({message: 'Unavailable'});
			await expectAsync(unavailable).toBeRejectedWith(
				jasmine.objectContaining({
					name: 'DialogError',
					code: 'DIALOG_UNAVAILABLE'
				})
			);
		});

		it('does not mistake a provider display failure for cancellation.', async function()
		{
			const child = CreateFakeChild();
			spyOn(child_process, 'spawn').and.callFake(function()
			{
				queueMicrotask(function()
				{
					child.stderr.emit('data', 'Gtk-WARNING: cannot open display');
					child.emit('close', 1, null);
				});
				return child;
			});

			const completion = robot.showConfirmationDialog({message: 'Continue?'});
			await expectAsync(completion).toBeRejectedWith(
				jasmine.objectContaining({
					name: 'DialogError',
					code: 'DIALOG_FAILED',
					details: jasmine.objectContaining({
						provider: 'zenity',
						exit_code: 1,
						stderr: 'Gtk-WARNING: cannot open display'
					})
				})
			);
		});

		it('validates messages before starting a provider.', function()
		{
			const spawn = spyOn(child_process, 'spawn');

			expect(function()
			{
				robot.showMessageBox({message: ''});
			}).toThrowError(TypeError, /non-empty string/);
			expect(function()
			{
				robot.showConfirmationDialog({message: 'bad\u0000message'});
			}).toThrowError(TypeError, /null characters/);
			expect(spawn).not.toHaveBeenCalled();
		});
	});
});
