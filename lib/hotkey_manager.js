'use strict';

const MODIFIER_DEFINITIONS = Object.freeze({
	ctrl: Object.freeze({canonical: 'ctrl', bit: 1}),
	control: Object.freeze({canonical: 'ctrl', bit: 1}),
	alt: Object.freeze({canonical: 'alt', bit: 2}),
	option: Object.freeze({canonical: 'alt', bit: 2}),
	shift: Object.freeze({canonical: 'shift', bit: 4}),
	super: Object.freeze({canonical: 'super', bit: 8}),
	meta: Object.freeze({canonical: 'super', bit: 8}),
	win: Object.freeze({canonical: 'super', bit: 8}),
	command: Object.freeze({canonical: 'super', bit: 8}),
	cmd: Object.freeze({canonical: 'super', bit: 8})
});
const MODIFIER_ORDER = Object.freeze(['ctrl', 'alt', 'shift', 'super']);
const KEY_DEFINITIONS = Object.freeze({
	backspace: Object.freeze({canonical: 'backspace', native_key: 'BackSpace'}),
	capslock: Object.freeze({canonical: 'capslock', native_key: 'Caps_Lock'}),
	delete: Object.freeze({canonical: 'delete', native_key: 'Delete'}),
	down: Object.freeze({canonical: 'down', native_key: 'Down'}),
	end: Object.freeze({canonical: 'end', native_key: 'End'}),
	enter: Object.freeze({canonical: 'enter', native_key: 'Return'}),
	return: Object.freeze({canonical: 'enter', native_key: 'Return'}),
	esc: Object.freeze({canonical: 'escape', native_key: 'Escape'}),
	escape: Object.freeze({canonical: 'escape', native_key: 'Escape'}),
	home: Object.freeze({canonical: 'home', native_key: 'Home'}),
	insert: Object.freeze({canonical: 'insert', native_key: 'Insert'}),
	left: Object.freeze({canonical: 'left', native_key: 'Left'}),
	menu: Object.freeze({canonical: 'menu', native_key: 'Menu'}),
	numlock: Object.freeze({canonical: 'numlock', native_key: 'Num_Lock'}),
	pagedown: Object.freeze({canonical: 'pagedown', native_key: 'Next'}),
	pageup: Object.freeze({canonical: 'pageup', native_key: 'Prior'}),
	pause: Object.freeze({canonical: 'pause', native_key: 'Pause'}),
	printscreen: Object.freeze({canonical: 'printscreen', native_key: 'Print'}),
	right: Object.freeze({canonical: 'right', native_key: 'Right'}),
	scrolllock: Object.freeze({canonical: 'scrolllock', native_key: 'Scroll_Lock'}),
	space: Object.freeze({canonical: 'space', native_key: 'space'}),
	tab: Object.freeze({canonical: 'tab', native_key: 'Tab'}),
	up: Object.freeze({canonical: 'up', native_key: 'Up'}),
	comma: Object.freeze({canonical: 'comma', native_key: 'comma'}),
	minus: Object.freeze({canonical: 'minus', native_key: 'minus'}),
	period: Object.freeze({canonical: 'period', native_key: 'period'}),
	semicolon: Object.freeze({canonical: 'semicolon', native_key: 'semicolon'}),
	slash: Object.freeze({canonical: 'slash', native_key: 'slash'})
});
const REGISTER_KEYS = new Set([
	'name',
	'hotkey',
	'extra',
	'on_pressed',
	'on_error',
	'signal',
	'callback_mode',
	'callback_error_policy',
	'max_pending_callbacks'
]);

class HotkeyError extends Error
{
	constructor(params)
	{
		super(params.message, params.cause === undefined ? undefined : {cause: params.cause});
		this.name = 'HotkeyError';
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
		throw new TypeError('params.signal must be an AbortSignal.');
	}
}

function GetAbortReason(signal)
{
	if (signal.reason !== undefined)
	{
		return signal.reason;
	}
	const error = new Error('The hotkey registration was aborted.');
	error.name = 'AbortError';
	return error;
}

function ParseHotkey(hotkey)
{
	if (typeof hotkey !== 'string' || hotkey.trim().length === 0)
	{
		throw new TypeError('params.hotkey must be a non-empty string.');
	}
	if (hotkey.length > 256)
	{
		throw new RangeError('params.hotkey must not exceed 256 characters.');
	}

	const tokens = hotkey.split('+').map(function(token)
	{
		return token.trim().toLowerCase();
	});
	if (tokens.some(function(token) { return token.length === 0; }))
	{
		throw new TypeError('params.hotkey contains an empty key or modifier.');
	}

	const modifiers = new Set();
	let logical_modifiers = 0;
	let key_token = null;

	for (const token of tokens)
	{
		const modifier = MODIFIER_DEFINITIONS[token];
		if (modifier)
		{
			if (modifiers.has(modifier.canonical))
			{
				throw new TypeError(`params.hotkey contains duplicate ${modifier.canonical} modifiers.`);
			}
			modifiers.add(modifier.canonical);
			logical_modifiers |= modifier.bit;
			continue;
		}

		if (key_token !== null)
		{
			throw new TypeError('params.hotkey must contain exactly one non-modifier key.');
		}
		key_token = token;
	}

	if (key_token === null)
	{
		throw new TypeError('params.hotkey must contain one non-modifier key.');
	}

	let key_definition = KEY_DEFINITIONS[key_token];
	if (!key_definition && /^[a-z0-9]$/.test(key_token))
	{
		key_definition = {
			canonical: key_token,
			native_key: key_token
		};
	}
	if (!key_definition && /^f(?:[1-9]|[12][0-9]|3[0-5])$/.test(key_token))
	{
		key_definition = {
			canonical: key_token,
			native_key: key_token.toUpperCase()
		};
	}
	if (!key_definition)
	{
		throw new TypeError(`params.hotkey contains unsupported key "${key_token}".`);
	}

	const canonical_parts = [];
	for (const modifier_name of MODIFIER_ORDER)
	{
		if (modifiers.has(modifier_name))
		{
			canonical_parts.push(modifier_name);
		}
	}
	canonical_parts.push(key_definition.canonical);

	return Object.freeze({
		hotkey: canonical_parts.join('+'),
		native_key: key_definition.native_key,
		logical_modifiers: logical_modifiers
	});
}

function NormalizeNativeError(error, details)
{
	const native_code = error && typeof error.code === 'string'
		? error.code
		: 'HOTKEY_BACKEND_ERROR';
	const supported_codes = new Set([
		'HOTKEY_BACKEND_UNAVAILABLE',
		'HOTKEY_BACKEND_ERROR',
		'HOTKEY_CONFLICT',
		'HOTKEY_INVALID_KEY',
		'HOTKEY_MANAGER_CLOSED',
		'HOTKEY_NOT_FOUND'
	]);
	const code = supported_codes.has(native_code)
		? native_code
		: 'HOTKEY_BACKEND_ERROR';

	return new HotkeyError({
		code: code,
		message: error && error.message
			? error.message
			: 'The X11 global hotkey operation failed.',
		details: details,
		cause: error
	});
}

class HotkeyRegistration
{
	constructor(params)
	{
		this.name = params.name;
		this.hotkey = params.hotkey;
		this._service = params.service;
		this._id = params.id;
		this._extra = params.extra;
		this._on_pressed = params.on_pressed;
		this._on_error = params.on_error;
		this._signal = params.signal;
		this._callback_mode = params.callback_mode;
		this._callback_error_policy = params.callback_error_policy;
		this._max_pending_callbacks = params.max_pending_callbacks;
		this._active = true;
		this._pending_callbacks = 0;
		this._callback_chain = Promise.resolve();
		this._sequence = 0;
		this._last_error = null;
		this.completion = new Promise((resolve) =>
		{
			this._resolve_completion = resolve;
		});
		this._handle_abort = () =>
		{
			this._service.StopRegistration({
				registration: this,
				reason: 'aborted',
				error: GetAbortReason(this._signal)
			}).catch((error) =>
			{
				this._last_error = error;
			});
		};
		if (this._signal)
		{
			this._signal.addEventListener('abort', this._handle_abort, {once: true});
		}
	}

	get active()
	{
		return this._active;
	}

	get pendingCallbacks()
	{
		return this._pending_callbacks;
	}

	get lastError()
	{
		return this._last_error;
	}

	unregister()
	{
		return this._service.StopRegistration({
			registration: this,
			reason: 'unregistered',
			error: null
		});
	}

	DispatchNativeEvent(native_event, robot)
	{
		if (!this._active)
		{
			return;
		}
		if (this._pending_callbacks >= this._max_pending_callbacks)
		{
			const overflow_error = new HotkeyError({
				code: 'HOTKEY_CALLBACK_QUEUE_FULL',
				message: `The callback queue for hotkey "${this.name}" is full.`,
				details: {
					name: this.name,
					hotkey: this.hotkey,
					max_pending_callbacks: this._max_pending_callbacks
				}
			});
			this._last_error = overflow_error;
			this.ReportError(overflow_error, robot);
			return;
		}

		this._sequence += 1;
		const event = Object.freeze({
			type: 'hotkey_pressed',
			name: this.name,
			hotkey: this.hotkey,
			sequence: this._sequence,
			pressed_at_ms: Date.now(),
			server_timestamp_ms: native_event.server_timestamp_ms
		});

		this._pending_callbacks += 1;
		const Invoke = async () =>
		{
			if (!this._active)
			{
				return;
			}
			try
			{
				await this._on_pressed(event, robot, this._extra);
			}
			catch (error)
			{
				await this.HandleCallbackError(error, robot);
			}
		};
		const Finalize = () =>
		{
			this._pending_callbacks -= 1;
		};

		if (this._callback_mode === 'serial')
		{
			const pending = this._callback_chain.then(Invoke, Invoke);
			this._callback_chain = pending.then(Finalize, Finalize);
			return;
		}

		Promise.resolve()
			.then(Invoke)
			.then(Finalize, Finalize);
	}

	async HandleCallbackError(cause, robot)
	{
		const callback_error = new HotkeyError({
			code: 'HOTKEY_CALLBACK_FAILED',
			message: `The callback for hotkey "${this.name}" failed.`,
			details: {
				name: this.name,
				hotkey: this.hotkey,
				cause: cause && cause.message ? cause.message : String(cause)
			},
			cause: cause
		});
		this._last_error = callback_error;
		await this.ReportError(callback_error, robot);

		if (this._callback_error_policy === 'unregister' && this._active)
		{
			try
			{
				await this._service.StopRegistration({
					registration: this,
					reason: 'callback_error',
					error: callback_error
				});
			}
			catch (unregister_error)
			{
				this._last_error = unregister_error;
			}
		}
	}

	async ReportError(error, robot)
	{
		if (!this._on_error)
		{
			return;
		}

		const event = Object.freeze({
			type: 'hotkey_error',
			name: this.name,
			hotkey: this.hotkey,
			error: error
		});
		try
		{
			await this._on_error(event, robot, this._extra);
		}
		catch (error_callback_failure)
		{
			this._last_error = new HotkeyError({
				code: 'HOTKEY_ERROR_CALLBACK_FAILED',
				message: `The error callback for hotkey "${this.name}" failed.`,
				details: {
					name: this.name,
					hotkey: this.hotkey,
					cause: error_callback_failure && error_callback_failure.message
						? error_callback_failure.message
						: String(error_callback_failure)
				},
				cause: error_callback_failure
			});
		}
	}

	Complete(params)
	{
		if (!this._active)
		{
			return;
		}
		this._active = false;
		if (this._signal)
		{
			this._signal.removeEventListener('abort', this._handle_abort);
		}
		this._resolve_completion(Object.freeze({
			reason: params.reason,
			name: this.name,
			hotkey: this.hotkey,
			error: params.error
		}));
	}
}

class HotkeyService
{
	constructor(params)
	{
		this._NativeHotkeyManager = params.NativeHotkeyManager;
		this._get_robot = params.get_robot;
		this._native_manager = null;
		this._registrations = new Map();
		this._names = new Map();
		this._hotkeys = new Map();
		this._next_registration_id = 1;
	}

	async RegisterHotkey(params)
	{
		AssertPlainObject(params, 'params');
		AssertKnownKeys(params, REGISTER_KEYS, 'params');
		AssertAbortSignal(params.signal);

		if (
			typeof params.name !== 'string' ||
			params.name.length === 0 ||
			params.name.length > 128 ||
			!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(params.name)
		)
		{
			throw new TypeError(
				'params.name must be 1-128 characters using letters, numbers, periods, underscores, or hyphens.'
			);
		}
		if (typeof params.on_pressed !== 'function')
		{
			throw new TypeError('params.on_pressed must be a function.');
		}
		if (params.on_error !== undefined && typeof params.on_error !== 'function')
		{
			throw new TypeError('params.on_error must be a function when provided.');
		}

		const parsed_hotkey = ParseHotkey(params.hotkey);
		const callback_mode = params.callback_mode === undefined ? 'serial' : params.callback_mode;
		if (callback_mode !== 'serial' && callback_mode !== 'concurrent')
		{
			throw new TypeError('params.callback_mode must be "serial" or "concurrent".');
		}
		const callback_error_policy = params.callback_error_policy === undefined
			? 'unregister'
			: params.callback_error_policy;
		if (callback_error_policy !== 'unregister' && callback_error_policy !== 'continue')
		{
			throw new TypeError(
				'params.callback_error_policy must be "unregister" or "continue".'
			);
		}
		const max_pending_callbacks = params.max_pending_callbacks === undefined
			? 16
			: params.max_pending_callbacks;
		if (!Number.isSafeInteger(max_pending_callbacks) || max_pending_callbacks < 1 || max_pending_callbacks > 1_024)
		{
			throw new RangeError('params.max_pending_callbacks must be an integer from 1 through 1,024.');
		}
		if (params.signal && params.signal.aborted)
		{
			throw GetAbortReason(params.signal);
		}
		if (this._names.has(params.name))
		{
			throw new HotkeyError({
				code: 'HOTKEY_CONFLICT',
				message: `A global hotkey named "${params.name}" is already registered.`,
				details: {name: params.name}
			});
		}
		if (this._hotkeys.has(parsed_hotkey.hotkey))
		{
			throw new HotkeyError({
				code: 'HOTKEY_CONFLICT',
				message: `Global hotkey "${parsed_hotkey.hotkey}" is already registered.`,
				details: {hotkey: parsed_hotkey.hotkey}
			});
		}

		this.EnsureNativeManager();
		const registration_id = this.GetNextRegistrationId();
		try
		{
			this._native_manager.registerHotkey(
				registration_id,
				parsed_hotkey.native_key,
				parsed_hotkey.logical_modifiers
			);
		}
		catch (error)
		{
			if (this._registrations.size === 0)
			{
				this.CloseNativeManager();
			}
			throw NormalizeNativeError(error, {
				name: params.name,
				hotkey: parsed_hotkey.hotkey
			});
		}

		const registration = new HotkeyRegistration({
			service: this,
			id: registration_id,
			name: params.name,
			hotkey: parsed_hotkey.hotkey,
			extra: params.extra,
			on_pressed: params.on_pressed,
			on_error: params.on_error,
			signal: params.signal,
			callback_mode: callback_mode,
			callback_error_policy: callback_error_policy,
			max_pending_callbacks: max_pending_callbacks
		});
		this._registrations.set(registration_id, registration);
		this._names.set(registration.name, registration);
		this._hotkeys.set(registration.hotkey, registration);

		if (params.signal && params.signal.aborted)
		{
			await this.StopRegistration({
				registration: registration,
				reason: 'aborted',
				error: GetAbortReason(params.signal)
			});
		}
		return registration;
	}

	async StopRegistration(params)
	{
		const registration = params.registration;
		if (!registration.active)
		{
			return registration.completion;
		}

		try
		{
			this._native_manager.unregisterHotkey(registration._id);
		}
		catch (error)
		{
			throw NormalizeNativeError(error, {
				name: registration.name,
				hotkey: registration.hotkey
			});
		}

		this._registrations.delete(registration._id);
		this._names.delete(registration.name);
		this._hotkeys.delete(registration.hotkey);
		registration.Complete({
			reason: params.reason,
			error: params.error
		});
		if (this._registrations.size === 0)
		{
			this.CloseNativeManager();
		}
		return registration.completion;
	}

	EnsureNativeManager()
	{
		if (this._native_manager !== null)
		{
			return;
		}
		try
		{
			this._native_manager = new this._NativeHotkeyManager((event) =>
			{
				this.HandleNativeEvent(event);
			});
		}
		catch (error)
		{
			this._native_manager = null;
			throw NormalizeNativeError(error, null);
		}
	}

	CloseNativeManager()
	{
		if (this._native_manager !== null)
		{
			this._native_manager.close();
			this._native_manager = null;
		}
	}

	HandleNativeEvent(event)
	{
		if (
			event === null ||
			typeof event !== 'object' ||
			!Number.isSafeInteger(event.registration_id)
		)
		{
			return;
		}
		const registration = this._registrations.get(event.registration_id);
		if (registration)
		{
			registration.DispatchNativeEvent(event, this._get_robot());
		}
	}

	GetNextRegistrationId()
	{
		for (let attempts = 0; attempts < 0xFFFF_FFFF; attempts += 1)
		{
			const registration_id = this._next_registration_id;
			this._next_registration_id = registration_id === 0xFFFF_FFFF
				? 1
				: registration_id + 1;
			if (!this._registrations.has(registration_id))
			{
				return registration_id;
			}
		}
		throw new HotkeyError({
			code: 'HOTKEY_BACKEND_ERROR',
			message: 'No global hotkey registration identifiers are available.',
			details: null
		});
	}
}

function CreateHotkeyService(params)
{
	return new HotkeyService(params);
}

module.exports = {
	CreateHotkeyService: CreateHotkeyService,
	HotkeyError: HotkeyError,
	ParseHotkey: ParseHotkey
};
