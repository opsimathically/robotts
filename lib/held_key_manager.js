'use strict';

const HOLD_OPTION_KEYS = new Set(['keys', 'target']);
const SIGNAL_NAMES = Object.freeze(['SIGHUP', 'SIGINT', 'SIGTERM']);
const MODIFIER_ORDER = new Map([
	['control', 0],
	['right_control', 1],
	['alt', 2],
	['right_alt', 3],
	['shift', 4],
	['right_shift', 5],
	['super', 6]
]);
const MODIFIER_ALIASES = Object.freeze({
	ctrl: Object.freeze({canonical: 'control', native_key: 'control'}),
	control: Object.freeze({canonical: 'control', native_key: 'control'}),
	left_control: Object.freeze({canonical: 'control', native_key: 'control'}),
	right_control: Object.freeze({canonical: 'right_control', native_key: 'right_control'}),
	alt: Object.freeze({canonical: 'alt', native_key: 'alt'}),
	option: Object.freeze({canonical: 'alt', native_key: 'alt'}),
	right_alt: Object.freeze({canonical: 'right_alt', native_key: 'right_alt'}),
	shift: Object.freeze({canonical: 'shift', native_key: 'shift'}),
	left_shift: Object.freeze({canonical: 'shift', native_key: 'shift'}),
	right_shift: Object.freeze({canonical: 'right_shift', native_key: 'right_shift'}),
	super: Object.freeze({canonical: 'super', native_key: 'command'}),
	meta: Object.freeze({canonical: 'super', native_key: 'command'}),
	win: Object.freeze({canonical: 'super', native_key: 'command'}),
	command: Object.freeze({canonical: 'super', native_key: 'command'}),
	cmd: Object.freeze({canonical: 'super', native_key: 'command'})
});
const NAMED_KEY_ALIASES = Object.freeze({
	backspace: Object.freeze({canonical: 'backspace', native_key: 'backspace'}),
	capslock: Object.freeze({canonical: 'capslock', native_key: 'capslock'}),
	delete: Object.freeze({canonical: 'delete', native_key: 'delete'}),
	down: Object.freeze({canonical: 'down', native_key: 'down'}),
	end: Object.freeze({canonical: 'end', native_key: 'end'}),
	enter: Object.freeze({canonical: 'enter', native_key: 'enter'}),
	return: Object.freeze({canonical: 'enter', native_key: 'enter'}),
	esc: Object.freeze({canonical: 'escape', native_key: 'escape'}),
	escape: Object.freeze({canonical: 'escape', native_key: 'escape'}),
	home: Object.freeze({canonical: 'home', native_key: 'home'}),
	insert: Object.freeze({canonical: 'insert', native_key: 'insert'}),
	left: Object.freeze({canonical: 'left', native_key: 'left'}),
	pagedown: Object.freeze({canonical: 'pagedown', native_key: 'pagedown'}),
	pageup: Object.freeze({canonical: 'pageup', native_key: 'pageup'}),
	printscreen: Object.freeze({canonical: 'printscreen', native_key: 'printscreen'}),
	right: Object.freeze({canonical: 'right', native_key: 'right'}),
	space: Object.freeze({canonical: 'space', native_key: 'space'}),
	tab: Object.freeze({canonical: 'tab', native_key: 'tab'}),
	up: Object.freeze({canonical: 'up', native_key: 'up'}),
	comma: Object.freeze({canonical: 'comma', native_key: ','}),
	minus: Object.freeze({canonical: 'minus', native_key: '-'}),
	period: Object.freeze({canonical: 'period', native_key: '.'}),
	semicolon: Object.freeze({canonical: 'semicolon', native_key: ';'}),
	slash: Object.freeze({canonical: 'slash', native_key: '/'})
});

class HeldKeyError extends Error
{
	constructor(params)
	{
		super(params.message, params.cause === undefined ? undefined : {cause: params.cause});
		this.name = 'HeldKeyError';
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

function ParseKeyInput(keys)
{
	let tokens;
	if (typeof keys === 'string')
	{
		if (keys.length > 256)
		{
			throw new RangeError('params.keys must not exceed 256 characters.');
		}
		tokens = keys.split('+');
	}
	else if (Array.isArray(keys))
	{
		if (keys.length > 32)
		{
			throw new RangeError('params.keys must contain no more than 32 keys.');
		}
		tokens = keys.slice();
	}
	else
	{
		throw new TypeError('params.keys must be a chord string or an array of key names.');
	}

	if (tokens.length === 0)
	{
		throw new TypeError('params.keys must contain at least one key.');
	}

	return tokens.map(function(token)
	{
		if (typeof token !== 'string' || token.trim().length === 0)
		{
			throw new TypeError('params.keys contains an empty or non-string key.');
		}
		return token.trim().toLowerCase();
	});
}

function ResolveHeldKey(token)
{
	if (MODIFIER_ALIASES[token])
	{
		return MODIFIER_ALIASES[token];
	}
	if (NAMED_KEY_ALIASES[token])
	{
		return NAMED_KEY_ALIASES[token];
	}
	if (/^[a-z0-9]$/.test(token))
	{
		return {
			canonical: token,
			native_key: token
		};
	}
	if (/^f(?:[1-9]|1[0-2])$/.test(token))
	{
		return {
			canonical: token,
			native_key: token
		};
	}
	throw new TypeError(`params.keys contains unsupported key "${token}".`);
}

function ParseHeldKeys(keys)
{
	const definitions = new Map();
	for (const token of ParseKeyInput(keys))
	{
		const definition = ResolveHeldKey(token);
		if (!definitions.has(definition.canonical))
		{
			definitions.set(definition.canonical, Object.freeze({
				canonical: definition.canonical,
				native_key: definition.native_key
			}));
		}
	}
	if (definitions.size === 0)
	{
		throw new TypeError('params.keys must contain at least one key.');
	}

	const ordered = Array.from(definitions.values()).sort(function(first, second)
	{
		const first_order = MODIFIER_ORDER.has(first.canonical)
			? MODIFIER_ORDER.get(first.canonical)
			: Number.MAX_SAFE_INTEGER;
		const second_order = MODIFIER_ORDER.has(second.canonical)
			? MODIFIER_ORDER.get(second.canonical)
			: Number.MAX_SAFE_INTEGER;
		if (first_order !== second_order)
		{
			return first_order - second_order;
		}
		return first.canonical.localeCompare(second.canonical);
	});

	return Object.freeze({
		chord: ordered.map(function(item) { return item.canonical; }).join('+'),
		keys: Object.freeze(ordered.map(function(item) { return item.canonical; })),
		definitions: Object.freeze(ordered)
	});
}

function FailureDetail(key, error)
{
	return Object.freeze({
		key: key,
		message: error && error.message ? error.message : String(error),
		code: error && typeof error.code === 'string' ? error.code : null
	});
}

class HeldKeysHandle
{
	constructor(params)
	{
		this.chord = params.parsed_keys.chord;
		this.keys = params.parsed_keys.keys;
		this.target = params.target || null;
		this._service = params.service;
		this._owned_keys = new Set();
		this._release_result = null;
		this._last_error = null;
	}

	get active()
	{
		return this._owned_keys.size > 0;
	}

	get pendingKeys()
	{
		return Object.freeze(Array.from(this._owned_keys));
	}

	get lastError()
	{
		return this._last_error;
	}

	releaseKeys()
	{
		return this._service.ReleaseHandle(this);
	}
}

class HeldKeyService
{
	constructor(params)
	{
		if (!params || typeof params.toggle_key !== 'function')
		{
			throw new TypeError('CreateHeldKeyService requires a toggle_key function.');
		}
		this._toggle_key = params.toggle_key;
		this._process = params.process_object || process;
		this._report_cleanup_error = typeof params.report_cleanup_error === 'function'
			? params.report_cleanup_error
			: function() {};
		this._ownership = new Map();
		this._physical_order = [];
		this._handles = new Set();
		this._hooks_installed = false;
		this._hook_handlers = new Map();
	}

	HoldKeysDown(params)
	{
		AssertPlainObject(params, 'params');
		AssertKnownKeys(params, HOLD_OPTION_KEYS, 'params');
		const parsed_keys = ParseHeldKeys(params.keys);
		const handle = new HeldKeysHandle({
			service: this,
			parsed_keys: parsed_keys,
			target: params.target
		});
		const acquired_keys = [];

		try
		{
			for (const definition of parsed_keys.definitions)
			{
				const ownership = this._ownership.get(definition.canonical);
				if (ownership)
				{
					ownership.count += 1;
					handle._owned_keys.add(definition.canonical);
					acquired_keys.push(definition.canonical);
					continue;
				}

				this._toggle_key(definition.native_key, 'down');
				this._ownership.set(definition.canonical, {
					count: 1,
					native_key: definition.native_key
				});
				this._physical_order.push(definition.canonical);
				handle._owned_keys.add(definition.canonical);
				acquired_keys.push(definition.canonical);
				this.EnsureCleanupHooks();
			}
		}
		catch (cause)
		{
			const rollback = this.ReleaseHandleBestEffort(handle);
			if (handle.active)
			{
				this._handles.add(handle);
			}
			const error = new HeldKeyError({
				code: 'HELD_KEYS_ACQUIRE_FAILED',
				message: `Could not acquire held-key chord "${parsed_keys.chord}".`,
				details: {
					chord: parsed_keys.chord,
					acquired_keys: acquired_keys,
					rollback_released_keys: rollback.released_keys,
					rollback_shared_keys: rollback.shared_keys,
					unreleased_keys: rollback.retained_keys,
					release_failures: rollback.failures
				},
				cause: cause
			});
			handle._last_error = error;
			throw error;
		}

		this._handles.add(handle);
		return handle;
	}

	ReleaseHandle(handle)
	{
		if (handle._release_result)
		{
			return handle._release_result;
		}

		const result = this.ReleaseHandleBestEffort(handle);
		if (result.failures.length > 0)
		{
			const error = new HeldKeyError({
				code: 'HELD_KEYS_RELEASE_FAILED',
				message: `Could not release every key in held-key chord "${handle.chord}".`,
				details: {
					chord: handle.chord,
					released_keys: result.released_keys,
					shared_keys: result.shared_keys,
					unreleased_keys: result.retained_keys,
					release_failures: result.failures
				}
			});
			handle._last_error = error;
			throw error;
		}

		handle._last_error = null;
		handle._release_result = Object.freeze({
			chord: handle.chord,
			released_keys: Object.freeze(result.released_keys),
			shared_keys: Object.freeze(result.shared_keys)
		});
		return handle._release_result;
	}

	ReleaseHandleBestEffort(handle)
	{
		const released_keys = [];
		const shared_keys = [];
		const failures = [];
		const keys = Array.from(handle._owned_keys).reverse();

		for (const key of keys)
		{
			const ownership = this._ownership.get(key);
			if (!ownership)
			{
				handle._owned_keys.delete(key);
				continue;
			}
			if (ownership.count > 1)
			{
				ownership.count -= 1;
				handle._owned_keys.delete(key);
				shared_keys.push(key);
				continue;
			}

			try
			{
				this._toggle_key(ownership.native_key, 'up');
				this._ownership.delete(key);
				handle._owned_keys.delete(key);
				released_keys.push(key);
			}
			catch (error)
			{
				failures.push(FailureDetail(key, error));
			}
		}

		this.AfterOwnershipChange(handle);
		return {
			released_keys: released_keys,
			shared_keys: shared_keys,
			retained_keys: Array.from(handle._owned_keys),
			failures: failures
		};
	}

	ReleaseAllHeldKeys()
	{
		const released_keys = [];
		const failures = [];
		const keys = this._physical_order.slice().reverse();

		for (const key of keys)
		{
			const ownership = this._ownership.get(key);
			if (!ownership)
			{
				continue;
			}
			try
			{
				this._toggle_key(ownership.native_key, 'up');
				this._ownership.delete(key);
				released_keys.push(key);
				for (const handle of this._handles)
				{
					handle._owned_keys.delete(key);
				}
			}
			catch (error)
			{
				failures.push(FailureDetail(key, error));
			}
		}

		for (const handle of Array.from(this._handles))
		{
			if (!handle.active)
			{
				this._handles.delete(handle);
			}
		}
		this.CompactPhysicalOrder();
		if (this._ownership.size === 0)
		{
			this.RemoveCleanupHooks();
		}

		if (failures.length > 0)
		{
			throw new HeldKeyError({
				code: 'HELD_KEYS_CLEANUP_FAILED',
				message: 'Could not release every key owned by RobotTS.',
				details: {
					released_keys: released_keys,
					unreleased_keys: Array.from(this._ownership.keys()),
					release_failures: failures
				}
			});
		}

		return Object.freeze({
			released_keys: Object.freeze(released_keys),
			unreleased_keys: Object.freeze([])
		});
	}

	AfterOwnershipChange(handle)
	{
		if (!handle.active)
		{
			this._handles.delete(handle);
		}
		this.CompactPhysicalOrder();
		if (this._ownership.size === 0)
		{
			this.RemoveCleanupHooks();
		}
	}

	CompactPhysicalOrder()
	{
		this._physical_order = this._physical_order.filter((key) => this._ownership.has(key));
	}

	EnsureCleanupHooks()
	{
		if (this._hooks_installed)
		{
			return;
		}

		const cleanup_handler = (reason) =>
		{
			this.CleanupWithoutThrow(reason);
		};
		this._hook_handlers.set('beforeExit', function() { cleanup_handler('beforeExit'); });
		this._hook_handlers.set('exit', function() { cleanup_handler('exit'); });
		this._hook_handlers.set('uncaughtExceptionMonitor', function()
		{
			cleanup_handler('uncaughtException');
		});

		for (const [event_name, handler] of this._hook_handlers)
		{
			this.AddCleanupListener(event_name, handler);
		}
		for (const signal of SIGNAL_NAMES)
		{
			const signal_handler = () =>
			{
				const should_reraise = this._process.listenerCount(signal) === 1;
				this.CleanupWithoutThrow(signal);
				if (should_reraise)
				{
					this.RemoveCleanupHooks();
					this._process.kill(this._process.pid, signal);
				}
			};
			this._hook_handlers.set(signal, signal_handler);
			this.AddCleanupListener(signal, signal_handler);
		}
		this._hooks_installed = true;
	}

	AddCleanupListener(event_name, handler)
	{
		if (typeof this._process.prependListener === 'function')
		{
			this._process.prependListener(event_name, handler);
			return;
		}
		this._process.on(event_name, handler);
	}

	RemoveCleanupHooks()
	{
		if (!this._hooks_installed)
		{
			return;
		}
		for (const [event_name, handler] of this._hook_handlers)
		{
			this._process.removeListener(event_name, handler);
		}
		this._hook_handlers.clear();
		this._hooks_installed = false;
	}

	CleanupWithoutThrow(reason)
	{
		try
		{
			this.ReleaseAllHeldKeys();
		}
		catch (error)
		{
			try
			{
				this._report_cleanup_error(error, reason);
			}
			catch (_report_error)
			{
				// Process cleanup must continue even if diagnostics fail.
			}
		}
	}
}

function CreateHeldKeyService(params)
{
	return new HeldKeyService(params);
}

module.exports = {
	CreateHeldKeyService: CreateHeldKeyService,
	HeldKeyError: HeldKeyError,
	ParseHeldKeys: ParseHeldKeys
};
