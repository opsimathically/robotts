'use strict';

const child_process = require('node:child_process');
const crypto = require('node:crypto');

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_DURATION_MS = 281_474_976_710_654;
const DURATION_MULTIPLIERS = Object.freeze({
	hours: 3_600_000,
	minutes: 60_000,
	seconds: 1_000,
	milliseconds: 1
});
const DURATION_KEYS = Object.freeze(Object.keys(DURATION_MULTIPLIERS));
const DIALOG_PROVIDERS = Object.freeze([
	Object.freeze({
		name: 'zenity',
		build_args: BuildZenityArguments
	}),
	Object.freeze({
		name: 'kdialog',
		build_args: BuildKDialogArguments
	}),
	Object.freeze({
		name: 'xmessage',
		build_args: BuildXMessageArguments
	})
]);

class DialogError extends Error
{
	constructor(params)
	{
		super(params.message);
		this.name = 'DialogError';
		this.code = params.code;
		this.details = params.details || null;
	}
}

function AssertPlainObject(value, name)
{
	if (value === null || typeof value !== 'object' || Array.isArray(value))
	{
		throw new TypeError(`${name} must be an object.`);
	}
}

function AssertKnownKeys(value, allowed_keys, name)
{
	for (const key of Object.keys(value))
	{
		if (!allowed_keys.has(key))
		{
			throw new TypeError(`${name}.${key} is not a supported option.`);
		}
	}
}

function AssertAbortSignal(signal)
{
	if (signal === undefined)
	{
		return;
	}

	if (
		signal === null ||
		typeof signal !== 'object' ||
		typeof signal.aborted !== 'boolean' ||
		typeof signal.addEventListener !== 'function' ||
		typeof signal.removeEventListener !== 'function'
	)
	{
		throw new TypeError('signal must be an AbortSignal.');
	}
}

function GetAbortReason(signal)
{
	if (signal && signal.reason !== undefined)
	{
		return signal.reason;
	}

	const error = new Error('The operation was aborted.');
	error.name = 'AbortError';
	return error;
}

function ParseDuration(duration, name)
{
	AssertPlainObject(duration, name);
	AssertKnownKeys(duration, new Set(DURATION_KEYS), name);

	let total_ms = 0;

	for (const key of DURATION_KEYS)
	{
		const value = duration[key];
		if (value === undefined)
		{
			continue;
		}

		if (!Number.isSafeInteger(value) || value < 0)
		{
			throw new RangeError(`${name}.${key} must be a non-negative safe integer.`);
		}

		const component_ms = value * DURATION_MULTIPLIERS[key];
		if (!Number.isSafeInteger(component_ms) || component_ms > MAX_DURATION_MS - total_ms)
		{
			throw new RangeError(`${name} exceeds the maximum supported duration.`);
		}

		total_ms += component_ms;
	}

	return total_ms;
}

function WaitForDuration(params)
{
	const duration_ms = params.duration_ms;
	const signal = params.signal;

	return new Promise(function(resolve, reject)
	{
		let remaining_ms = duration_ms;
		let timer = null;
		let settled = false;

		function Cleanup()
		{
			if (timer !== null)
			{
				clearTimeout(timer);
				timer = null;
			}
			if (signal)
			{
				signal.removeEventListener('abort', HandleAbort);
			}
		}

		function Finish()
		{
			if (settled)
			{
				return;
			}
			settled = true;
			Cleanup();
			resolve();
		}

		function HandleAbort()
		{
			if (settled)
			{
				return;
			}
			settled = true;
			Cleanup();
			reject(GetAbortReason(signal));
		}

		function ScheduleNextTimer()
		{
			const delay_ms = Math.min(remaining_ms, MAX_TIMER_DELAY_MS);
			timer = setTimeout(function()
			{
				timer = null;
				remaining_ms -= delay_ms;
				if (remaining_ms === 0)
				{
					Finish();
					return;
				}
				ScheduleNextTimer();
			}, delay_ms);
		}

		if (signal)
		{
			if (signal.aborted)
			{
				HandleAbort();
				return;
			}
			signal.addEventListener('abort', HandleAbort, {once: true});
		}

		ScheduleNextTimer();
	});
}

function Sleep(params)
{
	AssertPlainObject(params, 'params');
	AssertKnownKeys(
		params,
		new Set([...DURATION_KEYS, 'signal']),
		'params'
	);
	AssertAbortSignal(params.signal);

	const duration = {};
	for (const key of DURATION_KEYS)
	{
		if (params[key] !== undefined)
		{
			duration[key] = params[key];
		}
	}

	return WaitForDuration({
		duration_ms: ParseDuration(duration, 'params'),
		signal: params.signal
	});
}

function SleepRandom(params)
{
	AssertPlainObject(params, 'params');
	AssertKnownKeys(params, new Set(['minimum', 'maximum', 'signal']), 'params');
	AssertAbortSignal(params.signal);

	if (params.minimum === undefined)
	{
		throw new TypeError('params.minimum is required.');
	}
	if (params.maximum === undefined)
	{
		throw new TypeError('params.maximum is required.');
	}

	const minimum_ms = ParseDuration(params.minimum, 'params.minimum');
	const maximum_ms = ParseDuration(params.maximum, 'params.maximum');

	if (maximum_ms < minimum_ms)
	{
		throw new RangeError('params.maximum must not be shorter than params.minimum.');
	}

	const duration_ms = minimum_ms === maximum_ms
		? minimum_ms
		: minimum_ms + crypto.randomInt((maximum_ms - minimum_ms) + 1);

	return WaitForDuration({
		duration_ms: duration_ms,
		signal: params.signal
	});
}

function RandomBigIntBelow(upper_bound)
{
	if (upper_bound === 1n)
	{
		return 0n;
	}

	const bit_count = (upper_bound - 1n).toString(2).length;
	const byte_count = Math.ceil(bit_count / 8);
	const mask = (1n << BigInt(bit_count)) - 1n;

	while (true)
	{
		const random_bytes = crypto.randomBytes(byte_count);
		let candidate = 0n;
		for (const byte of random_bytes)
		{
			candidate = (candidate << 8n) | BigInt(byte);
		}
		candidate &= mask;

		if (candidate < upper_bound)
		{
			return candidate;
		}
	}
}

function RandomIntegerBetween(min_value, max_value)
{
	if (typeof min_value !== 'number')
	{
		throw new TypeError('min_value must be a number.');
	}
	if (typeof max_value !== 'number')
	{
		throw new TypeError('max_value must be a number.');
	}
	if (!Number.isSafeInteger(min_value))
	{
		throw new RangeError('min_value must be a safe integer.');
	}
	if (!Number.isSafeInteger(max_value))
	{
		throw new RangeError('max_value must be a safe integer.');
	}
	if (max_value < min_value)
	{
		throw new RangeError('max_value must be greater than or equal to min_value.');
	}
	if (min_value === max_value)
	{
		return min_value;
	}

	const minimum = BigInt(min_value);
	const range_size = BigInt(max_value) - minimum + 1n;
	return Number(minimum + RandomBigIntBelow(range_size));
}

function ValidateDialogParams(params)
{
	AssertPlainObject(params, 'params');
	AssertKnownKeys(params, new Set(['message', 'title', 'signal']), 'params');
	AssertAbortSignal(params.signal);

	if (typeof params.message !== 'string' || params.message.length === 0)
	{
		throw new TypeError('params.message must be a non-empty string.');
	}
	if (params.message.includes('\u0000'))
	{
		throw new TypeError('params.message must not contain null characters.');
	}
	if (Buffer.byteLength(params.message, 'utf8') > 65_536)
	{
		throw new RangeError('params.message must not exceed 65,536 UTF-8 bytes.');
	}

	const title = params.title === undefined ? 'RobotTS' : params.title;
	if (typeof title !== 'string' || title.length === 0)
	{
		throw new TypeError('params.title must be a non-empty string when provided.');
	}
	if (title.includes('\u0000'))
	{
		throw new TypeError('params.title must not contain null characters.');
	}
	if (Buffer.byteLength(title, 'utf8') > 512)
	{
		throw new RangeError('params.title must not exceed 512 UTF-8 bytes.');
	}

	return {
		message: params.message,
		title: title,
		signal: params.signal
	};
}

function BuildZenityArguments(kind, params)
{
	return [
		kind === 'message' ? '--info' : '--question',
		`--title=${params.title}`,
		`--text=${params.message}`,
		kind === 'message' ? '--ok-label=Close' : '--ok-label=OK',
		...(kind === 'confirmation' ? ['--cancel-label=Cancel'] : [])
	];
}

function BuildKDialogArguments(kind, params)
{
	if (kind === 'message')
	{
		return ['--title', params.title, '--ok-label', 'Close', '--msgbox', params.message];
	}

	return [
		'--title',
		params.title,
		'--yes-label',
		'OK',
		'--no-label',
		'Cancel',
		'--yesno',
		params.message
	];
}

function BuildXMessageArguments(kind, params)
{
	const buttons = kind === 'message' ? 'Close:0' : 'OK:0,Cancel:1';
	return [
		'-center',
		'-title',
		params.title,
		'-buttons',
		buttons,
		'-default',
		kind === 'message' ? 'Close' : 'OK',
		params.message
	];
}

function RunDialog(params)
{
	return new Promise(function(resolve, reject)
	{
		let provider_index = 0;
		let active_child = null;
		let settled = false;
		let stderr_text = '';

		function CleanupAbortListener()
		{
			if (params.signal)
			{
				params.signal.removeEventListener('abort', HandleAbort);
			}
		}

		function Resolve(value)
		{
			if (settled)
			{
				return;
			}
			settled = true;
			CleanupAbortListener();
			resolve(value);
		}

		function Reject(error)
		{
			if (settled)
			{
				return;
			}
			settled = true;
			CleanupAbortListener();
			reject(error);
		}

		function HandleAbort()
		{
			if (active_child !== null && !active_child.killed)
			{
				active_child.kill('SIGTERM');
			}
			Reject(GetAbortReason(params.signal));
		}

		function TryNextProvider()
		{
			if (settled)
			{
				return;
			}

			if (provider_index >= DIALOG_PROVIDERS.length)
			{
				Reject(new DialogError({
					code: 'DIALOG_UNAVAILABLE',
					message: 'No supported Linux dialog provider is installed.',
					details: {
						providers: DIALOG_PROVIDERS.map(function(provider)
						{
							return provider.name;
						})
					}
				}));
				return;
			}

			const provider = DIALOG_PROVIDERS[provider_index];
			provider_index += 1;
			stderr_text = '';
			let child_error = false;
			let dialog_child;

			try
			{
				dialog_child = child_process.spawn(
					provider.name,
					provider.build_args(params.kind, params),
					{
						stdio: ['ignore', 'ignore', 'pipe']
					}
				);
				active_child = dialog_child;
			}
			catch (error)
			{
				Reject(new DialogError({
					code: 'DIALOG_FAILED',
					message: `Could not start the ${provider.name} dialog provider.`,
					details: {
						provider: provider.name,
						cause: error.message
					}
				}));
				return;
			}

			dialog_child.stderr.setEncoding('utf8');
			dialog_child.stderr.on('data', function(chunk)
			{
				if (stderr_text.length < 8_192)
				{
					stderr_text += chunk;
				}
			});

			dialog_child.once('error', function(error)
			{
				child_error = true;
				if (active_child === dialog_child)
				{
					active_child = null;
				}
				if (error && error.code === 'ENOENT')
				{
					TryNextProvider();
					return;
				}

				Reject(new DialogError({
					code: 'DIALOG_FAILED',
					message: `The ${provider.name} dialog provider could not be started.`,
					details: {
						provider: provider.name,
						cause: error && error.message ? error.message : String(error)
					}
				}));
			});

			dialog_child.once('close', function(exit_code, signal)
			{
				if (active_child === dialog_child)
				{
					active_child = null;
				}
				if (settled || child_error)
				{
					return;
				}

				if (exit_code === 0)
				{
					Resolve(params.kind === 'confirmation' ? 'confirm' : undefined);
					return;
				}
				if (exit_code === 1 && stderr_text.trim().length === 0)
				{
					Resolve(params.kind === 'confirmation' ? 'cancel' : undefined);
					return;
				}

				Reject(new DialogError({
					code: 'DIALOG_FAILED',
					message: `The ${provider.name} dialog provider exited unexpectedly.`,
					details: {
						provider: provider.name,
						exit_code: exit_code,
						signal: signal,
						stderr: stderr_text.trim() || null
					}
				}));
			});
		}

		if (params.signal)
		{
			if (params.signal.aborted)
			{
				Reject(GetAbortReason(params.signal));
				return;
			}
			params.signal.addEventListener('abort', HandleAbort, {once: true});
		}

		TryNextProvider();
	});
}

function ShowMessageBox(params)
{
	const validated_params = ValidateDialogParams(params);
	return RunDialog({
		kind: 'message',
		message: validated_params.message,
		title: validated_params.title,
		signal: validated_params.signal
	});
}

function ShowConfirmationDialog(params)
{
	const validated_params = ValidateDialogParams(params);
	return RunDialog({
		kind: 'confirmation',
		message: validated_params.message,
		title: validated_params.title,
		signal: validated_params.signal
	});
}

module.exports = {
	DialogError: DialogError,
	randomIntegerBetween: RandomIntegerBetween,
	sleep: Sleep,
	sleepRandom: SleepRandom,
	showMessageBox: ShowMessageBox,
	showConfirmationDialog: ShowConfirmationDialog
};
