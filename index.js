var crypto = require('node:crypto');
var child_process = require('node:child_process');
var fs = require('node:fs');
var path = require('node:path');
var robotjs = require('./build/Release/robotjs.node');

module.exports = robotjs;

class ScopedWindowError extends Error
{
	constructor(params)
	{
		super(params.message);
		this.name = 'ScopedWindowError';
		this.code = params.code;
		this.details = params.details || null;
	}
}

module.exports.ScopedWindowError = ScopedWindowError;
var image_reference_cache = new Map();

function bitmap(width, height, byte_width, bits_per_pixel, bytes_per_pixel, image)
{
	this.width = width;
	this.height = height;
	this.byteWidth = byte_width;
	this.bitsPerPixel = bits_per_pixel;
	this.bytesPerPixel = bytes_per_pixel;
	this.image = image;

	this.colorAt = function(x, y)
	{
		return robotjs.getColor(this, x, y);
	};
}

function create_bitmap_wrapper(bitmap_data)
{
	return new bitmap(
		bitmap_data.width,
		bitmap_data.height,
		bitmap_data.byteWidth,
		bitmap_data.bitsPerPixel,
		bitmap_data.bytesPerPixel,
		bitmap_data.image
	);
}

function rectangles_intersect(first_rect, second_rect)
{
	return first_rect.x < (second_rect.x + second_rect.width) &&
		(first_rect.x + first_rect.width) > second_rect.x &&
		first_rect.y < (second_rect.y + second_rect.height) &&
		(first_rect.y + first_rect.height) > second_rect.y;
}

function get_display_for_window(desktop_state, window_item)
{
	if (!desktop_state || !desktop_state.displays || !window_item || !window_item.geometry)
	{
		return null;
	}

	var window_rect = {
		x: window_item.geometry.x,
		y: window_item.geometry.y,
		width: window_item.geometry.width,
		height: window_item.geometry.height
	};

	for (var index = 0; index < desktop_state.displays.length; index += 1)
	{
		var display_item = desktop_state.displays[index];
		if (rectangles_intersect(window_rect, display_item))
		{
			return display_item;
		}
	}

	return null;
}

function build_window_target(desktop_state, window_item)
{
	var display_item = get_display_for_window(desktop_state, window_item);

	return {
		targetType: 'window',
		windowId: window_item.windowId,
		title: window_item.title,
		className: window_item.className,
		instanceName: window_item.instanceName,
		pid: window_item.pid,
		workspaceId: window_item.workspaceId,
		displayId: display_item ? display_item.id : null
	};
}

function window_matches_query(window_query, desktop_state, window_item)
{
	if (window_query.window_id && String(window_item.windowId) !== String(window_query.window_id))
	{
		return false;
	}

	if (window_query.title && window_item.title !== window_query.title)
	{
		return false;
	}

	if (window_query.title_includes)
	{
		if (!window_item.title || window_item.title.indexOf(window_query.title_includes) === -1)
		{
			return false;
		}
	}

	if (window_query.class_name && window_item.className !== window_query.class_name)
	{
		return false;
	}

	if (window_query.instance_name && window_item.instanceName !== window_query.instance_name)
	{
		return false;
	}

	if (typeof window_query.pid !== 'undefined' && window_item.pid !== window_query.pid)
	{
		return false;
	}

	if (typeof window_query.workspace_id !== 'undefined' && window_item.workspaceId !== window_query.workspace_id)
	{
		return false;
	}

	if (window_query.active_only && !window_item.isActive)
	{
		return false;
	}

	if (typeof window_query.monitor_id !== 'undefined')
	{
		var display_item = get_display_for_window(desktop_state, window_item);
		if (!display_item || display_item.id !== window_query.monitor_id)
		{
			return false;
		}
	}

	return true;
}

function get_desktop_state()
{
	return robotjs.getDesktopState();
}

function get_window_by_id(desktop_state, window_id)
{
	if (!desktop_state || !desktop_state.windows)
	{
		return null;
	}

	for (var index = 0; index < desktop_state.windows.length; index += 1)
	{
		if (String(desktop_state.windows[index].windowId) === String(window_id))
		{
			return desktop_state.windows[index];
		}
	}

	return null;
}

function sleep_ms(duration_ms)
{
	var shared_buffer = new SharedArrayBuffer(4);
	var shared_view = new Int32Array(shared_buffer);
	Atomics.wait(shared_view, 0, 0, duration_ms);
}

function sleep_async(duration_ms)
{
	return new Promise(function(resolve)
	{
		setTimeout(resolve, duration_ms);
	});
}

function create_scoped_window_error(params)
{
	return new ScopedWindowError({
		code: params.code,
		message: params.message,
		details: params.details
	});
}

function throw_scoped_window_error(params)
{
	throw create_scoped_window_error(params);
}

function is_bitmap_like(value)
{
	return !!(value &&
		typeof value.width === 'number' &&
		typeof value.height === 'number' &&
		typeof value.byteWidth === 'number' &&
		typeof value.bitsPerPixel === 'number' &&
		typeof value.bytesPerPixel === 'number' &&
		value.image &&
		typeof value.colorAt === 'function');
}

function assert_bitmap_like(value, error_message)
{
	if (!is_bitmap_like(value))
	{
		throw new Error(error_message || 'A valid bitmap reference is required.');
	}

	return value;
}

function get_verified_window_context(params)
{
	var desktop_state = get_desktop_state();
	var window_query = params || {};
	var target = window_query.target;
	var window_item = null;

	if (!desktop_state.capabilities || !desktop_state.capabilities.supportsStrictTargetVerification)
	{
		throw_scoped_window_error({
			code: 'WINDOW_VERIFICATION_UNSUPPORTED',
			message: 'Strict window target verification is not supported in the current Linux session.',
			details: {
				session: desktop_state.session,
				capabilities: desktop_state.capabilities
			}
		});
	}

	if (!target)
	{
		target = resolve_window_target(window_query);
	}

	window_item = get_window_by_id(desktop_state, target.windowId);
	if (!window_item)
	{
		throw_scoped_window_error({
			code: 'WINDOW_NOT_FOUND',
			message: 'The requested window target no longer exists.',
			details: {
				target: target
			}
		});
	}

	target = build_window_target(desktop_state, window_item);

	if (window_query.require_active === true)
	{
		if (!desktop_state.activeWindow || String(desktop_state.activeWindow.windowId) !== String(target.windowId))
		{
			throw_scoped_window_error({
				code: 'WINDOW_NOT_ACTIVE',
				message: 'The requested window target is not active.',
				details: {
					target: target,
					active_window: desktop_state.activeWindow
				}
			});
		}
	}

	return {
		desktop_state: desktop_state,
		target: target,
		window_item: window_item
	};
}

function wait_for_window_focus(params)
{
	var timeout_ms = typeof params.timeout_ms !== 'undefined' ? params.timeout_ms : 1000;
	var started_at = Date.now();

	while ((Date.now() - started_at) <= timeout_ms)
	{
		var desktop_state = get_desktop_state();
		if (desktop_state.activeWindow && String(desktop_state.activeWindow.windowId) === String(params.window_id))
		{
			return true;
		}

		sleep_ms(25);
	}

	return false;
}

function focus_and_verify_window_target(params)
{
	var context = get_verified_window_context({
		target: params.target,
		require_active: false
	});

	robotjs.focusWindow(context.target.windowId);

	if (!wait_for_window_focus({
		window_id: context.target.windowId,
		timeout_ms: params && typeof params.timeout_ms !== 'undefined' ? params.timeout_ms : 1000
	}))
	{
		throw_scoped_window_error({
			code: 'WINDOW_FOCUS_FAILED',
			message: 'The requested window target could not be focused.',
			details: {
				target: context.target
			}
		});
	}

	return get_verified_window_context({
		target: context.target,
		require_active: true
	}).target;
}

function resolve_window_target(params)
{
	var desktop_state = get_desktop_state();
	var window_query = params || {};
	var candidate_windows = [];

	if (!desktop_state.capabilities || !desktop_state.capabilities.supportsWindowDiscovery)
	{
		throw_scoped_window_error({
			code: 'WINDOW_DISCOVERY_UNSUPPORTED',
			message: 'Window discovery is not supported in the current Linux session.',
			details: {
				session: desktop_state.session,
				capabilities: desktop_state.capabilities
			}
		});
	}

	for (var index = 0; index < desktop_state.windows.length; index += 1)
	{
		var window_item = desktop_state.windows[index];
		if (window_matches_query(window_query, desktop_state, window_item))
		{
			candidate_windows.push(window_item);
		}
	}

	if (candidate_windows.length === 0)
	{
		throw_scoped_window_error({
			code: 'WINDOW_TARGET_NOT_FOUND',
			message: 'No window matched the requested target criteria.',
			details: {
				query: window_query
			}
		});
	}

	if (candidate_windows.length > 1)
	{
		throw_scoped_window_error({
			code: 'WINDOW_TARGET_AMBIGUOUS',
			message: 'Window target resolution was ambiguous.',
			details: {
				query: window_query,
				match_count: candidate_windows.length
			}
		});
	}

	return build_window_target(desktop_state, candidate_windows[0]);
}

function assert_window_target(params)
{
	var context = get_verified_window_context({
		target: params && params.target,
		window_id: params && params.window_id,
		title: params && params.title,
		title_includes: params && params.title_includes,
		class_name: params && params.class_name,
		instance_name: params && params.instance_name,
		pid: params && params.pid,
		workspace_id: params && params.workspace_id,
		monitor_id: params && params.monitor_id,
		active_only: params && params.active_only,
		require_active: !params || params.require_active !== false
	});

	return context.target;
}

function get_absolute_point_for_target(params)
{
	var context = get_verified_window_context({
		target: params.target,
		require_active: params.require_active === true
	});

	if (!context.window_item || !context.window_item.geometry)
	{
		throw_scoped_window_error({
			code: 'WINDOW_GEOMETRY_UNAVAILABLE',
			message: 'The requested window target does not have usable geometry.',
			details: {
				target: context.target,
				window: context.window_item
			}
		});
	}

	if (params.relative_to === 'global')
	{
		return {
			x: params.x,
			y: params.y,
			target: context.target
		};
	}

	return {
		x: context.window_item.geometry.x + params.x,
		y: context.window_item.geometry.y + params.y,
		target: context.target
	};
}

function has_window_query(params)
{
	return !!(params && (
		params.target ||
		typeof params.window_id !== 'undefined' ||
		typeof params.title !== 'undefined' ||
		typeof params.title_includes !== 'undefined' ||
		typeof params.class_name !== 'undefined' ||
		typeof params.instance_name !== 'undefined' ||
		typeof params.pid !== 'undefined' ||
		typeof params.workspace_id !== 'undefined' ||
		typeof params.monitor_id !== 'undefined' ||
		typeof params.active_only !== 'undefined'
	));
}

function clamp_number(value, minimum, maximum)
{
	if (value < minimum)
	{
		return minimum;
	}

	if (value > maximum)
	{
		return maximum;
	}

	return value;
}

function lerp_number(start_value, end_value, progress)
{
	return start_value + ((end_value - start_value) * progress);
}

function round_point(point)
{
	return {
		x: Math.round(point.x),
		y: Math.round(point.y)
	};
}

function hash_seed(seed)
{
	var seed_text = String(seed);
	var hash_value = 1779033703;
	var index = 0;

	for (index = 0; index < seed_text.length; index += 1)
	{
		hash_value = Math.imul(hash_value ^ seed_text.charCodeAt(index), 3432918353);
		hash_value = (hash_value << 13) | (hash_value >>> 19);
	}

	return function()
	{
		hash_value = Math.imul(hash_value ^ (hash_value >>> 16), 2246822507);
		hash_value = Math.imul(hash_value ^ (hash_value >>> 13), 3266489909);
		hash_value ^= hash_value >>> 16;
		return hash_value >>> 0;
	};
}

function resolve_effective_seed(params)
{
	if (typeof params.random_seed !== 'undefined' && params.random_seed !== null)
	{
		return params.random_seed;
	}

	return [
		'auto',
		process.pid,
		Date.now(),
		process.hrtime.bigint().toString(),
		crypto.randomUUID()
	].join(':');
}

function create_random_number_generator(random_seed)
{
	var seed_factory = hash_seed(random_seed);
	var state = seed_factory();

	return function()
	{
		state += 0x6D2B79F5;
		var value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function get_distance_between_points(start_point, end_point)
{
	var delta_x = end_point.x - start_point.x;
	var delta_y = end_point.y - start_point.y;

	return Math.sqrt((delta_x * delta_x) + (delta_y * delta_y));
}

function get_normalized_vector(start_point, end_point)
{
	var distance = get_distance_between_points(start_point, end_point);

	if (distance === 0)
	{
		return {
			distance: 0,
			unit_x: 0,
			unit_y: 0,
			perpendicular_x: 0,
			perpendicular_y: 0
		};
	}

	return {
		distance: distance,
		unit_x: (end_point.x - start_point.x) / distance,
		unit_y: (end_point.y - start_point.y) / distance,
		perpendicular_x: -(end_point.y - start_point.y) / distance,
		perpendicular_y: (end_point.x - start_point.x) / distance
	};
}

function ease_in_out_cubic(progress)
{
	if (progress < 0.5)
	{
		return 4 * progress * progress * progress;
	}

	return 1 - (Math.pow((-2 * progress) + 2, 3) / 2);
}

function cubic_bezier_point(start_point, control_point_1, control_point_2, end_point, progress)
{
	var inverse = 1 - progress;
	var inverse_squared = inverse * inverse;
	var progress_squared = progress * progress;

	return {
		x: (inverse_squared * inverse * start_point.x) +
			(3 * inverse_squared * progress * control_point_1.x) +
			(3 * inverse * progress_squared * control_point_2.x) +
			(progress_squared * progress * end_point.x),
		y: (inverse_squared * inverse * start_point.y) +
			(3 * inverse_squared * progress * control_point_1.y) +
			(3 * inverse * progress_squared * control_point_2.y) +
			(progress_squared * progress * end_point.y)
	};
}

function get_mouse_path_style(style)
{
	if (typeof style === 'undefined' || style === null)
	{
		return 'linear';
	}

	if (style !== 'linear' && style !== 'wavy' && style !== 'human_like')
	{
		throw new Error('Invalid mouse path style specified.');
	}

	return style;
}

function get_mouse_speed_profile(params)
{
	if (typeof params.speed_profile !== 'undefined' && params.speed_profile !== null)
	{
		if (params.speed_profile !== 'constant' && params.speed_profile !== 'humanized')
		{
			throw new Error('Invalid mouse speed profile specified.');
		}

		return params.speed_profile;
	}

	if (params.style === 'human_like')
	{
		return 'humanized';
	}

	return 'constant';
}

function get_mouse_path_steps(params)
{
	var steps = params.steps;
	var distance = params.distance;
	var duration_ms = params.duration_ms;
	var derived_steps = Math.max(12, Math.ceil(distance / 8));

	if (typeof duration_ms !== 'undefined')
	{
		derived_steps = Math.max(derived_steps, Math.ceil(duration_ms / 8));
	}

	if (typeof steps === 'undefined')
	{
		return clamp_number(derived_steps, 12, 240);
	}

	return clamp_number(Math.round(steps), 2, 240);
}

function get_mouse_speed_variation_amount(params)
{
	if (typeof params.speed_variation_amount === 'undefined')
	{
		return params.speed_profile === 'humanized' ? 0.35 : 0;
	}

	return clamp_number(params.speed_variation_amount, 0, 1);
}

function get_mouse_path_duration(params)
{
	if (typeof params.duration_ms !== 'undefined')
	{
		return Math.max(0, Math.round(params.duration_ms));
	}

	return clamp_number(Math.round(120 + (params.distance * 0.75)), 80, 1200);
}

function build_constant_delay_schedule(params)
{
	var delay_schedule = [];
	var index = 0;
	var total_delay_units = params.point_count - 1;
	var carried_delay = 0;

	if (params.point_count <= 1 || params.duration_ms <= 0)
	{
		return delay_schedule;
	}

	for (index = 0; index < total_delay_units; index += 1)
	{
		var scheduled_total = Math.round(((index + 1) * params.duration_ms) / total_delay_units);
		delay_schedule.push(scheduled_total - carried_delay);
		carried_delay = scheduled_total;
	}

	return delay_schedule;
}

function normalize_delay_weights(params)
{
	var normalized_weights = [];
	var minimum_delay = params.minimum_delay;
	var maximum_delay = params.maximum_delay;
	var remaining_budget = params.total_duration;
	var base_delays = [];
	var weights_total = 0;
	var index = 0;

	if (params.weights.length === 0)
	{
		return [];
	}

	for (index = 0; index < params.weights.length; index += 1)
	{
		normalized_weights.push(Math.max(0.0001, params.weights[index]));
		weights_total += normalized_weights[index];
	}

	for (index = 0; index < normalized_weights.length; index += 1)
	{
		base_delays.push(minimum_delay);
		remaining_budget -= minimum_delay;
	}

	if (remaining_budget <= 0)
	{
		base_delays[base_delays.length - 1] += remaining_budget;
		return base_delays;
	}

	for (index = 0; index < normalized_weights.length; index += 1)
	{
		var extra_budget = Math.round((normalized_weights[index] / weights_total) * remaining_budget);
		var allowed_extra = maximum_delay - base_delays[index];
		var applied_extra = clamp_number(extra_budget, 0, allowed_extra);
		base_delays[index] += applied_extra;
		remaining_budget -= applied_extra;
	}

	index = 0;
	while (remaining_budget > 0)
	{
		var allowed_increment = maximum_delay - base_delays[index];
		if (allowed_increment > 0)
		{
			base_delays[index] += 1;
			remaining_budget -= 1;
		}
		index = (index + 1) % base_delays.length;
	}

	return base_delays;
}

function build_humanized_delay_schedule(params)
{
	var delay_weights = [];
	var index = 0;
	var total_delay_units = params.point_count - 1;
	var minimum_delay = typeof params.min_step_delay_ms !== 'undefined' ? Math.max(0, Math.round(params.min_step_delay_ms)) : 4;
	var maximum_delay = typeof params.max_step_delay_ms !== 'undefined' ? Math.max(minimum_delay, Math.round(params.max_step_delay_ms)) : Math.max(minimum_delay + 1, Math.round(params.duration_ms * 0.3));
	var variation_amount = get_mouse_speed_variation_amount(params);

	if (params.point_count <= 1 || params.duration_ms <= 0)
	{
		return [];
	}

	if (minimum_delay > maximum_delay)
	{
		throw new Error('Invalid mouse speed delay bounds specified.');
	}

	if ((minimum_delay * total_delay_units) > params.duration_ms)
	{
		throw new Error('The requested duration is too small for the minimum per-step delay.');
	}

	for (index = 0; index < total_delay_units; index += 1)
	{
		var progress = total_delay_units === 1 ? 1 : index / (total_delay_units - 1);
		var edge_slowdown = Math.pow((Math.cos(progress * Math.PI) + 1) / 2, 1.35);
		var timing_weight = 1 + (edge_slowdown * 1.6);
		var timing_jitter = ((params.random() * 2) - 1) * variation_amount * 0.55;
		delay_weights.push(Math.max(0.05, timing_weight + timing_jitter));
	}

	return normalize_delay_weights({
		weights: delay_weights,
		total_duration: params.duration_ms,
		minimum_delay: minimum_delay,
		maximum_delay: maximum_delay
	});
}

function build_mouse_delay_schedule(params)
{
	if (params.duration_ms <= 0)
	{
		return [];
	}

	if (params.speed_profile === 'constant')
	{
		return build_constant_delay_schedule(params);
	}

	if (params.speed_profile === 'humanized')
	{
		return build_humanized_delay_schedule(params);
	}

	throw new Error('Invalid mouse speed profile specified.');
}

function build_linear_mouse_path(params)
{
	var path_points = [];
	var index = 0;
	var jitter_amount = params.randomization_amount || 0;
	var random_value = params.random;
	var vector = get_normalized_vector(params.start_point, params.end_point);

	for (index = 1; index <= params.steps; index += 1)
	{
		var progress = index / params.steps;
		var path_point = {
			x: lerp_number(params.start_point.x, params.end_point.x, progress),
			y: lerp_number(params.start_point.y, params.end_point.y, progress)
		};

		if (jitter_amount > 0 && progress < 1)
		{
			var jitter_scale = Math.sin(progress * Math.PI) * jitter_amount * 12;
			var jitter_offset = ((random_value() * 2) - 1) * jitter_scale;
			path_point.x += vector.perpendicular_x * jitter_offset;
			path_point.y += vector.perpendicular_y * jitter_offset;
		}

		path_points.push(round_point(path_point));
	}

	return path_points;
}

function build_wavy_mouse_path(params)
{
	var path_points = [];
	var index = 0;
	var random_value = params.random;
	var vector = get_normalized_vector(params.start_point, params.end_point);
	var wave_amplitude = typeof params.wave_amplitude !== 'undefined' ?
		params.wave_amplitude :
		clamp_number((vector.distance * 0.08) + ((params.randomization_amount || 0) * 10), 6, 36);
	var wave_frequency = typeof params.wave_frequency !== 'undefined' ?
		params.wave_frequency :
		clamp_number(Math.round(vector.distance / 120), 1, 4);
	var phase = random_value() * Math.PI * 2;

	for (index = 1; index <= params.steps; index += 1)
	{
		var progress = index / params.steps;
		var base_point = {
			x: lerp_number(params.start_point.x, params.end_point.x, progress),
			y: lerp_number(params.start_point.y, params.end_point.y, progress)
		};
		var wave_decay = Math.sin(progress * Math.PI);
		var wave_offset = Math.sin((progress * wave_frequency * Math.PI * 2) + phase) * wave_amplitude * wave_decay;
		var random_offset = ((random_value() * 2) - 1) * (params.randomization_amount || 0) * 6 * wave_decay;

		path_points.push(round_point({
			x: base_point.x + (vector.perpendicular_x * (wave_offset + random_offset)),
			y: base_point.y + (vector.perpendicular_y * (wave_offset + random_offset))
		}));
	}

	return path_points;
}

function build_human_like_mouse_path(params)
{
	var path_points = [];
	var index = 0;
	var random_value = params.random;
	var vector = get_normalized_vector(params.start_point, params.end_point);
	var humanization_amount = typeof params.humanization_amount !== 'undefined' ?
		params.humanization_amount :
		0.5;
	var perpendicular_distance = clamp_number((vector.distance * (0.12 + (humanization_amount * 0.08))), 10, 80);
	var control_1_progress = 0.25 + (random_value() * 0.15);
	var control_2_progress = 0.65 + (random_value() * 0.15);
	var control_1_offset = ((random_value() * 2) - 1) * perpendicular_distance;
	var control_2_offset = ((random_value() * 2) - 1) * perpendicular_distance;
	var control_point_1 = {
		x: lerp_number(params.start_point.x, params.end_point.x, control_1_progress) + (vector.perpendicular_x * control_1_offset),
		y: lerp_number(params.start_point.y, params.end_point.y, control_1_progress) + (vector.perpendicular_y * control_1_offset)
	};
	var control_point_2 = {
		x: lerp_number(params.start_point.x, params.end_point.x, control_2_progress) + (vector.perpendicular_x * control_2_offset),
		y: lerp_number(params.start_point.y, params.end_point.y, control_2_progress) + (vector.perpendicular_y * control_2_offset)
	};

	for (index = 1; index <= params.steps; index += 1)
	{
		var progress = index / params.steps;
		var eased_progress = ease_in_out_cubic(progress);
		var path_point = cubic_bezier_point(
			params.start_point,
			control_point_1,
			control_point_2,
			params.end_point,
			eased_progress
		);
		var correction_scale = Math.sin(progress * Math.PI) * (params.randomization_amount || 0.2) * 4;
		path_point.x += ((random_value() * 2) - 1) * correction_scale;
		path_point.y += ((random_value() * 2) - 1) * correction_scale;
		path_points.push(round_point(path_point));
	}

	return path_points;
}

function build_mouse_path_points(params)
{
	var path_points = [];

	if (params.distance === 0)
	{
		return [round_point(params.end_point)];
	}

	switch (params.style)
	{
		case 'linear':
			path_points = build_linear_mouse_path(params);
			break;
		case 'wavy':
			path_points = build_wavy_mouse_path(params);
			break;
		case 'human_like':
			path_points = build_human_like_mouse_path(params);
			break;
		default:
			throw new Error('Invalid mouse path style specified.');
	}

	if (path_points.length === 0 ||
		path_points[path_points.length - 1].x !== Math.round(params.end_point.x) ||
		path_points[path_points.length - 1].y !== Math.round(params.end_point.y))
	{
		path_points.push(round_point(params.end_point));
	}

	return path_points;
}

function get_path_destination_point(params)
{
	if (params.relative_to === 'global' && !has_window_query(params))
	{
		return {
			x: params.x,
			y: params.y,
			target: null
		};
	}

	return get_absolute_point_for_target({
		target: params.target || resolve_window_target(params),
		x: params.x,
		y: params.y,
		relative_to: params.relative_to,
		require_active: params.require_active === true
	});
}

function move_mouse_path(params)
{
	var style = get_mouse_path_style(params.style);
	var effective_seed = resolve_effective_seed({
		random_seed: params.random_seed
	});
	var speed_profile = get_mouse_speed_profile({
		style: style,
		speed_profile: params.speed_profile
	});
	var start_point = robotjs.getMousePos();
	var destination_point = params.destination_point || get_path_destination_point(params);
	var distance = get_distance_between_points(start_point, destination_point);
	var steps = get_mouse_path_steps({
		steps: params.steps,
		distance: distance,
		duration_ms: params.duration_ms
	});
	var duration_ms = get_mouse_path_duration({
		duration_ms: params.duration_ms,
		distance: distance
	});
	var random_value = create_random_number_generator(effective_seed);
	var path_points = build_mouse_path_points({
		style: style,
		start_point: start_point,
		end_point: destination_point,
		distance: distance,
		steps: steps,
		random: random_value,
		randomization_amount: typeof params.randomization_amount !== 'undefined' ? params.randomization_amount : (style === 'linear' ? 0 : 0.2),
		wave_amplitude: params.wave_amplitude,
		wave_frequency: params.wave_frequency,
		humanization_amount: params.humanization_amount
	});
	var delay_schedule = build_mouse_delay_schedule({
		point_count: path_points.length,
		duration_ms: duration_ms,
		speed_profile: speed_profile,
		speed_variation_amount: params.speed_variation_amount,
		min_step_delay_ms: params.min_step_delay_ms,
		max_step_delay_ms: params.max_step_delay_ms,
		random: random_value
	});
	var index = 0;

	for (index = 0; index < path_points.length; index += 1)
	{
		robotjs.moveMouse(path_points[index].x, path_points[index].y);

		if (index < delay_schedule.length && delay_schedule[index] > 0)
		{
			sleep_ms(delay_schedule[index]);
		}
	}

	robotjs.moveMouse(Math.round(destination_point.x), Math.round(destination_point.y));

	return {
		x: Math.round(destination_point.x),
		y: Math.round(destination_point.y),
		target: destination_point.target,
		speed_profile: speed_profile,
		effective_seed: params.include_effective_seed ? effective_seed : undefined
	};
}

function build_public_mouse_path_result(path_result)
{
	var public_result = {
		x: path_result.x,
		y: path_result.y
	};

	if (typeof path_result.effective_seed !== 'undefined')
	{
		public_result.effective_seed = path_result.effective_seed;
	}

	return public_result;
}

function load_image_reference_from_png(params)
{
	var action_params = params || {};
	var png_path = typeof action_params.png_path === 'string' ? action_params.png_path.trim() : '';
	var use_cache = action_params.use_cache !== false;
	var resolved_path;
	var bitmap_item;

	if (!png_path)
	{
		throw new Error('A non-empty png_path is required.');
	}

	resolved_path = path.resolve(png_path);

	if (!fs.existsSync(resolved_path))
	{
		throw new Error('The requested PNG reference path does not exist.');
	}

	if (use_cache && image_reference_cache.has(resolved_path))
	{
		return image_reference_cache.get(resolved_path);
	}

	bitmap_item = create_bitmap_wrapper(robotjs.loadBitmapFromFile(resolved_path));
	assert_bitmap_like(bitmap_item, 'The PNG reference could not be loaded as a bitmap.');

	if (use_cache)
	{
		image_reference_cache.set(resolved_path, bitmap_item);
	}

	return bitmap_item;
}

function normalize_image_reference(reference)
{
	if (!reference || typeof reference !== 'object')
	{
		throw new Error('An image reference object is required.');
	}

	if (reference.bitmap)
	{
		return {
			reference_type: 'bitmap',
			bitmap: assert_bitmap_like(reference.bitmap, 'A valid bitmap reference is required.'),
			png_path: null
		};
	}

	if (reference.png_path)
	{
		var resolved_path = path.resolve(reference.png_path);

		return {
			reference_type: 'png_path',
			bitmap: load_image_reference_from_png({
				png_path: resolved_path,
				use_cache: reference.use_cache !== false
			}),
			png_path: resolved_path
		};
	}

	throw new Error('The image reference must provide either bitmap or png_path.');
}

function build_source_region(params)
{
	var source = params.source || {};
	var x = typeof source.x !== 'undefined' ? source.x : 0;
	var y = typeof source.y !== 'undefined' ? source.y : 0;
	var width = typeof source.width !== 'undefined' ? source.width : null;
	var height = typeof source.height !== 'undefined' ? source.height : null;

	return {
		x: x,
		y: y,
		width: width,
		height: height
	};
}

function capture_image_search_source(params)
{
	var source = params.source || {
		type: 'screen'
	};
	var region = build_source_region(params);
	var display_item;
	var target;
	var bitmap_item;

	switch (source.type)
	{
		case 'screen':
			if (region.width !== null && region.height !== null)
			{
				bitmap_item = module.exports.screen.capture(region.x, region.y, region.width, region.height);
			}
			else
			{
				bitmap_item = module.exports.screen.capture();
			}

			return {
				source_type: 'screen',
				bitmap: bitmap_item,
				offset_x: region.width !== null ? region.x : 0,
				offset_y: region.height !== null ? region.y : 0,
				target: null,
				display_id: null
			};
		case 'display':
			display_item = module.exports.desktop.listDisplays().find(function(item)
			{
				return item.id === source.display_id;
			});

			if (!display_item)
			{
				throw new Error('The requested display source does not exist.');
			}

			if (region.width !== null && region.height !== null)
			{
				bitmap_item = module.exports.screen.capture(
					display_item.x + region.x,
					display_item.y + region.y,
					region.width,
					region.height
				);
			}
			else
			{
				bitmap_item = module.exports.screen.captureDisplay({
					display_id: source.display_id
				});
			}

			return {
				source_type: 'display',
				bitmap: bitmap_item,
				offset_x: display_item.x + (region.width !== null ? region.x : 0),
				offset_y: display_item.y + (region.height !== null ? region.y : 0),
				target: null,
				display_id: display_item.id
			};
		case 'region':
			if (region.width === null || region.height === null)
			{
				throw new Error('Region image search sources require width and height.');
			}

			return {
				source_type: 'region',
				bitmap: module.exports.screen.capture(region.x, region.y, region.width, region.height),
				offset_x: region.x,
				offset_y: region.y,
				target: null,
				display_id: null
			};
		case 'bitmap':
			return {
				source_type: 'bitmap',
				bitmap: assert_bitmap_like(source.bitmap, 'A valid bitmap image search source is required.'),
				offset_x: null,
				offset_y: null,
				target: null,
				display_id: null
			};
		case 'window':
			target = assert_window_target({
				target: source.target,
				window_id: source.window_id,
				title: source.title,
				title_includes: source.title_includes,
				class_name: source.class_name,
				instance_name: source.instance_name,
				pid: source.pid,
				workspace_id: source.workspace_id,
				monitor_id: source.monitor_id,
				require_active: source.require_active === true
			});
			var window_context = get_verified_window_context({
				target: target,
				require_active: source.require_active === true
			});

			bitmap_item = module.exports.screen.captureWindow({
				target: target,
				x: region.x,
				y: region.y,
				width: region.width !== null ? region.width : window_context.window_item.geometry.width,
				height: region.height !== null ? region.height : window_context.window_item.geometry.height,
				require_active: source.require_active === true
			});

			return {
				source_type: 'window',
				bitmap: bitmap_item,
				offset_x: window_context.window_item.geometry.x + region.x,
				offset_y: window_context.window_item.geometry.y + region.y,
				target: target,
				display_id: target.displayId
			};
		case 'locked_window':
			if (!source.locked_window || typeof source.locked_window.getTarget !== 'function' || typeof source.locked_window.capture !== 'function')
			{
				throw new Error('A valid locked_window source is required.');
			}

			target = source.locked_window.assert();
			var locked_context = get_verified_window_context({
				target: target,
				require_active: source.require_active === true
			});

			bitmap_item = source.locked_window.capture({
				x: region.x,
				y: region.y,
				width: region.width !== null ? region.width : locked_context.window_item.geometry.width,
				height: region.height !== null ? region.height : locked_context.window_item.geometry.height,
				require_active: source.require_active === true
			});

			return {
				source_type: 'locked_window',
				bitmap: bitmap_item,
				offset_x: locked_context.window_item.geometry.x + region.x,
				offset_y: locked_context.window_item.geometry.y + region.y,
				target: target,
				display_id: target.displayId
			};
		default:
			throw new Error('Unsupported image search source type specified.');
	}
}

function build_public_image_search_result(native_result, source_context, reference_context)
{
	var public_result = {
		found: !!native_result.found,
		score: native_result.score,
		location: native_result.location,
		size: native_result.size,
		overlap_ratio: typeof native_result.overlap_ratio === 'number' ? native_result.overlap_ratio : null,
		global_location: null,
		source_type: source_context.source_type,
		reference_type: reference_context.reference_type,
		display_id: source_context.display_id,
		target: source_context.target
	};

	if (public_result.location && source_context.offset_x !== null && source_context.offset_y !== null)
	{
		public_result.global_location = {
			x: source_context.offset_x + public_result.location.x,
			y: source_context.offset_y + public_result.location.y
		};
	}

	return public_result;
}

function find_image_in_source(params)
{
	var action_params = params || {};
	var source_context = capture_image_search_source(action_params);
	var reference_context = normalize_image_reference(action_params.reference);
	var native_result = robotjs.findBitmap(
		source_context.bitmap,
		reference_context.bitmap,
		typeof action_params.tolerance !== 'undefined' ? action_params.tolerance : 0
	);

	return build_public_image_search_result(native_result, source_context, reference_context);
}

function find_all_images_in_source(params)
{
	var action_params = params || {};
	var source_context = capture_image_search_source(action_params);
	var reference_context = normalize_image_reference(action_params.reference);
	var native_results = robotjs.findAllBitmaps(
		source_context.bitmap,
		reference_context.bitmap,
		typeof action_params.tolerance !== 'undefined' ? action_params.tolerance : 0
	);
	var max_results = typeof action_params.max_results !== 'undefined' ? Math.max(1, Math.round(action_params.max_results)) : native_results.length;

	return native_results.slice(0, max_results).map(function(native_result)
	{
		return build_public_image_search_result(native_result, source_context, reference_context);
	});
}

function get_validated_fuzzy_number(params)
{
	var value = params.value;
	var label = params.label;
	var minimum = params.minimum;
	var maximum = params.maximum;

	if (typeof value === 'undefined')
	{
		return params.default_value;
	}

	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)
	{
		throw new Error(label + ' must be a finite number between ' + minimum + ' and ' + maximum + '.');
	}

	return value;
}

function get_validated_sample_step(value)
{
	if (typeof value === 'undefined')
	{
		return 0;
	}

	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Math.floor(value) !== value)
	{
		throw new Error('sample_step must be a non-negative integer.');
	}

	return value;
}

function find_fuzzy_image_in_source(params)
{
	var action_params = params || {};
	var source_context = capture_image_search_source(action_params);
	var reference_context = normalize_image_reference(action_params.reference);
	var threshold = get_validated_fuzzy_number({
		value: action_params.threshold,
		label: 'threshold',
		minimum: 0,
		maximum: 1,
		default_value: 0.85
	});
	var tolerance = get_validated_fuzzy_number({
		value: action_params.tolerance,
		label: 'tolerance',
		minimum: 0,
		maximum: 1,
		default_value: 0.15
	});
	var minimum_overlap_ratio = get_validated_fuzzy_number({
		value: action_params.minimum_overlap_ratio,
		label: 'minimum_overlap_ratio',
		minimum: 0,
		maximum: 1,
		default_value: 0.6
	});
	var sample_step = get_validated_sample_step(action_params.sample_step);
	var native_result = robotjs.findFuzzyBitmap(
		source_context.bitmap,
		reference_context.bitmap,
		threshold,
		tolerance,
		action_params.allow_partial_match === true,
		minimum_overlap_ratio,
		sample_step
	);

	return build_public_image_search_result(native_result, source_context, reference_context);
}

function get_image_match_anchor(anchor)
{
	if (typeof anchor === 'undefined' || anchor === null)
	{
		return 'center';
	}

	if (anchor !== 'center' && anchor !== 'top_left')
	{
		throw new Error('Invalid image match anchor specified.');
	}

	return anchor;
}

function get_image_move_offset(value, label)
{
	if (typeof value === 'undefined')
	{
		return 0;
	}

	if (typeof value !== 'number' || !Number.isFinite(value))
	{
		throw new Error(label + ' must be a finite number.');
	}

	return value;
}

function assert_coordinate_bearing_image_source(params)
{
	var source = params.source;

	if (source && source.type === 'bitmap')
	{
		throw new Error('Image move operations require a coordinate-bearing image search source. Bitmap sources are not supported.');
	}
}

function get_image_match_destination_point(params)
{
	var match = params.match;
	var match_anchor = get_image_match_anchor(params.match_anchor);
	var offset_x = get_image_move_offset(params.offset_x, 'offset_x');
	var offset_y = get_image_move_offset(params.offset_y, 'offset_y');
	var destination_x;
	var destination_y;

	if (!match || !match.global_location || !match.size)
	{
		throw new Error('The accepted image match does not provide usable global coordinates.');
	}

	destination_x = match.global_location.x;
	destination_y = match.global_location.y;

	if (match_anchor === 'center')
	{
		destination_x += Math.round((match.size.width - 1) / 2);
		destination_y += Math.round((match.size.height - 1) / 2);
	}

	return {
		x: Math.round(destination_x + offset_x),
		y: Math.round(destination_y + offset_y),
		target: match.target || null
	};
}

function build_image_mouse_move_result(params)
{
	var public_result = {
		found: !!(params.match && params.match.found),
		moved: params.moved === true,
		match: params.match,
		destination: params.destination ? {
			x: params.destination.x,
			y: params.destination.y
		} : null
	};

	if (typeof params.effective_seed !== 'undefined')
	{
		public_result.effective_seed = params.effective_seed;
	}

	return public_result;
}

function move_mouse_to_image_match(params)
{
	var match = params.match;
	var destination_point;
	var path_result;

	if (!match || match.found !== true)
	{
		return build_image_mouse_move_result({
			match: match,
			moved: false,
			destination: null
		});
	}

	destination_point = get_image_match_destination_point({
		match: match,
		match_anchor: params.match_anchor,
		offset_x: params.offset_x,
		offset_y: params.offset_y
	});

	if (params.path === true)
	{
		path_result = move_mouse_path({
			destination_point: destination_point,
			style: params.style,
			duration_ms: params.duration_ms,
			steps: params.steps,
			random_seed: params.random_seed,
			include_effective_seed: params.include_effective_seed,
			randomization_amount: params.randomization_amount,
			speed_profile: params.speed_profile,
			speed_variation_amount: params.speed_variation_amount,
			min_step_delay_ms: params.min_step_delay_ms,
			max_step_delay_ms: params.max_step_delay_ms,
			wave_amplitude: params.wave_amplitude,
			wave_frequency: params.wave_frequency,
			humanization_amount: params.humanization_amount
		});

		return build_image_mouse_move_result({
			match: match,
			moved: true,
			destination: {
				x: path_result.x,
				y: path_result.y
			},
			effective_seed: path_result.effective_seed
		});
	}

	robotjs.moveMouse(destination_point.x, destination_point.y);

	return build_image_mouse_move_result({
		match: match,
		moved: true,
		destination: destination_point
	});
}

function run_image_mouse_move_action(params)
{
	var action_params = params.action_params || {};
	var search_result;

	if (params.require_coordinate_source !== false)
	{
		assert_coordinate_bearing_image_source(action_params);
	}

	search_result = params.find_match(action_params);

	return move_mouse_to_image_match({
		match: search_result,
		path: params.path === true,
		match_anchor: action_params.match_anchor,
		offset_x: action_params.offset_x,
		offset_y: action_params.offset_y,
		style: action_params.style,
		duration_ms: action_params.duration_ms,
		steps: action_params.steps,
		random_seed: action_params.random_seed,
		include_effective_seed: action_params.include_effective_seed,
		randomization_amount: action_params.randomization_amount,
		speed_profile: action_params.speed_profile,
		speed_variation_amount: action_params.speed_variation_amount,
		min_step_delay_ms: action_params.min_step_delay_ms,
		max_step_delay_ms: action_params.max_step_delay_ms,
		wave_amplitude: action_params.wave_amplitude,
		wave_frequency: action_params.wave_frequency,
		humanization_amount: action_params.humanization_amount
	});
}

function build_locked_window_image_source(locked_window, action_params)
{
	return {
		type: 'locked_window',
		locked_window: locked_window,
		x: action_params.x,
		y: action_params.y,
		width: action_params.width,
		height: action_params.height,
		require_active: action_params.require_active === true
	};
}

function build_locked_window_image_action_params(locked_window, action_params)
{
	return {
		source: build_locked_window_image_source(locked_window, action_params),
		reference: action_params.reference,
		tolerance: action_params.tolerance,
		threshold: action_params.threshold,
		allow_partial_match: action_params.allow_partial_match,
		minimum_overlap_ratio: action_params.minimum_overlap_ratio,
		sample_step: action_params.sample_step,
		match_anchor: action_params.match_anchor,
		offset_x: action_params.offset_x,
		offset_y: action_params.offset_y,
		style: action_params.style,
		duration_ms: action_params.duration_ms,
		steps: action_params.steps,
		random_seed: action_params.random_seed,
		include_effective_seed: action_params.include_effective_seed,
		randomization_amount: action_params.randomization_amount,
		speed_profile: action_params.speed_profile,
		speed_variation_amount: action_params.speed_variation_amount,
		min_step_delay_ms: action_params.min_step_delay_ms,
		max_step_delay_ms: action_params.max_step_delay_ms,
		wave_amplitude: action_params.wave_amplitude,
		wave_frequency: action_params.wave_frequency,
		humanization_amount: action_params.humanization_amount
	};
}

function prepare_scoped_keyboard_target(params)
{
	var target = params.target || resolve_window_target(params);

	if (params.require_active === false)
	{
		return assert_window_target({
			target: target,
			require_active: false
		});
	}

	return focus_and_verify_window_target({
		target: target
	});
}

function get_typing_humanization_level(level)
{
	if (typeof level === 'undefined' || level === null)
	{
		return 'medium';
	}

	if (level !== 'low' && level !== 'medium' && level !== 'high')
	{
		throw new Error('Invalid typing humanization level specified.');
	}

	return level;
}

function get_typing_delay_bounds(params)
{
	var level = get_typing_humanization_level(params.level);
	var defaults = {
		low: {
			minimum_delay: 28,
			maximum_delay: 70
		},
		medium: {
			minimum_delay: 45,
			maximum_delay: 125
		},
		high: {
			minimum_delay: 75,
			maximum_delay: 210
		}
	}[level];
	var minimum_delay = typeof params.min_delay_ms !== 'undefined' ? Math.max(0, Math.round(params.min_delay_ms)) : defaults.minimum_delay;
	var maximum_delay = typeof params.max_delay_ms !== 'undefined' ? Math.max(minimum_delay, Math.round(params.max_delay_ms)) : defaults.maximum_delay;

	if (minimum_delay > maximum_delay)
	{
		throw new Error('Invalid typing delay bounds specified.');
	}

	return {
		level: level,
		minimum_delay: minimum_delay,
		maximum_delay: maximum_delay
	};
}

function build_humanized_typing_delays(params)
{
	var delays = [];
	var index = 0;
	var previous_character = params.characters[0] || '';

	if (params.characters.length <= 1)
	{
		return delays;
	}

	for (index = 1; index < params.characters.length; index += 1)
	{
		var progress = index / (params.characters.length - 1);
		var edge_slowdown = Math.pow((Math.cos(progress * Math.PI) + 1) / 2, 1.25);
		var punctuation_pause = /[,.!?;:]/.test(previous_character) ? 0.45 : 0;
		var whitespace_pause = /\s/.test(previous_character) ? 0.15 : 0;
		var jitter = ((params.random() * 2) - 1) * 0.22;
		var weighted_progress = clamp_number(0.45 + (edge_slowdown * 0.65) + punctuation_pause + whitespace_pause + jitter, 0, 1);

		delays.push(Math.round(lerp_number(params.bounds.minimum_delay, params.bounds.maximum_delay, weighted_progress)));
		previous_character = params.characters[index];
	}

	return delays;
}

function type_humanized_character(character)
{
	if (character === '\r')
	{
		return;
	}

	if (character === '\n')
	{
		robotjs.keyTap('enter');
		return;
	}

	if (character === '\t')
	{
		robotjs.keyTap('tab');
		return;
	}

	robotjs.unicodeTap(character.codePointAt(0));
}

function type_string_humanized(params)
{
	var action_params = params || {};
	var text = typeof action_params.text === 'string' ? action_params.text : '';
	var characters = Array.from(text);
	var effective_seed = resolve_effective_seed({
		random_seed: action_params.random_seed
	});
	var random_value = create_random_number_generator(effective_seed);
	var bounds = get_typing_delay_bounds(action_params);
	var typing_delays = build_humanized_typing_delays({
		characters: characters,
		random: random_value,
		bounds: bounds
	});
	var elapsed_ms = 0;
	var index = 0;

	if (action_params.mistake_probability && action_params.mistake_probability > 0)
	{
		throw new Error('mistake_probability is not supported yet. Omit it or set it to 0.');
	}

	for (index = 0; index < characters.length; index += 1)
	{
		if (index > 0)
		{
			sleep_ms(typing_delays[index - 1]);
			elapsed_ms += typing_delays[index - 1];
		}

		type_humanized_character(characters[index]);
	}

	return {
		text: text,
		elapsed_ms: elapsed_ms,
		effective_seed: action_params.include_effective_seed ? effective_seed : undefined
	};
}

function build_public_typing_result(typing_result)
{
	var public_result = {
		text: typing_result.text,
		elapsed_ms: typing_result.elapsed_ms
	};

	if (typeof typing_result.effective_seed !== 'undefined')
	{
		public_result.effective_seed = typing_result.effective_seed;
	}

	return public_result;
}

function get_double_click_humanization_level(level)
{
	if (typeof level === 'undefined' || level === null)
	{
		return 'medium';
	}

	if (level !== 'low' && level !== 'medium' && level !== 'high')
	{
		throw new Error('Invalid double-click humanization level specified.');
	}

	return level;
}

function get_double_click_interval_bounds(params)
{
	var level = get_double_click_humanization_level(params.level);
	var defaults = {
		low: {
			minimum_interval: 105,
			maximum_interval: 155
		},
		medium: {
			minimum_interval: 130,
			maximum_interval: 205
		},
		high: {
			minimum_interval: 170,
			maximum_interval: 260
		}
	}[level];
	var minimum_interval = typeof params.min_interval_ms !== 'undefined' ? Math.max(30, Math.round(params.min_interval_ms)) : defaults.minimum_interval;
	var maximum_interval = typeof params.max_interval_ms !== 'undefined' ? Math.max(minimum_interval, Math.round(params.max_interval_ms)) : defaults.maximum_interval;

	if (minimum_interval > maximum_interval)
	{
		throw new Error('Invalid double-click interval bounds specified.');
	}

	return {
		level: level,
		minimum_interval: minimum_interval,
		maximum_interval: maximum_interval
	};
}

function double_click_humanized(params)
{
	var action_params = params || {};
	var button = typeof action_params.button === 'string' ? action_params.button : 'left';
	var effective_seed = resolve_effective_seed({
		random_seed: action_params.random_seed
	});
	var random_value = create_random_number_generator(effective_seed);
	var interval_bounds = get_double_click_interval_bounds(action_params);
	var interval_ms = Math.round(lerp_number(
		interval_bounds.minimum_interval,
		interval_bounds.maximum_interval,
		clamp_number(0.5 + (((random_value() * 2) - 1) * 0.35), 0, 1)
	));

	robotjs.mouseClick(button, false);
	sleep_ms(interval_ms);

	if (typeof action_params.before_second_click === 'function')
	{
		action_params.before_second_click();
	}

	robotjs.mouseClick(button, false);

	return {
		interval_ms: interval_ms,
		effective_seed: action_params.include_effective_seed ? effective_seed : undefined
	};
}

function build_public_double_click_result(double_click_result)
{
	var public_result = {
		interval_ms: double_click_result.interval_ms
	};

	if (typeof double_click_result.effective_seed !== 'undefined')
	{
		public_result.effective_seed = double_click_result.effective_seed;
	}

	return public_result;
}

function get_clipboard_command_result(command, args, input_text)
{
	var command_result = child_process.spawnSync(command, args, {
		input: input_text,
		encoding: 'utf8'
	});

	if (command_result.error)
	{
		return {
			ok: false,
			error: command_result.error
		};
	}

	if (command_result.status !== 0)
	{
		return {
			ok: false,
			error: new Error((command_result.stderr || '').trim() || ('Clipboard command failed: ' + command))
		};
	}

	return {
		ok: true,
		stdout: command_result.stdout || ''
	};
}

function clear_clipboard_text()
{
	var primary_error = null;
	var command_result;

	if (typeof robotjs.clearClipboardText === 'function')
	{
		try
		{
			robotjs.clearClipboardText();
			return {
				method: 'native_x11'
			};
		}
		catch (error)
		{
			primary_error = error;
		}
	}

	command_result = get_clipboard_command_result('xclip', ['-selection', 'clipboard'], '');
	if (command_result.ok)
	{
		return {
			method: 'xclip'
		};
	}

	command_result = get_clipboard_command_result('xsel', ['--clipboard', '--input'], '');
	if (command_result.ok)
	{
		return {
			method: 'xsel'
		};
	}

	throw create_scoped_window_error({
		code: 'CLIPBOARD_UNAVAILABLE',
		message: 'Clipboard access is not available in the current Linux session.',
		details: {
			native_error: primary_error ? primary_error.message : null
		}
	});
}

function read_clipboard_text()
{
	var primary_error = null;
	var command_result;

	if (typeof robotjs.getClipboardText === 'function')
	{
		try
		{
			return {
				data: robotjs.getClipboardText(),
				method: 'native_x11'
			};
		}
		catch (error)
		{
			primary_error = error;
		}
	}

	command_result = get_clipboard_command_result('xclip', ['-o', '-selection', 'clipboard'], null);
	if (command_result.ok)
	{
		return {
			data: command_result.stdout,
			method: 'xclip'
		};
	}

	command_result = get_clipboard_command_result('xsel', ['--clipboard', '--output'], null);
	if (command_result.ok)
	{
		return {
			data: command_result.stdout,
			method: 'xsel'
		};
	}

	throw create_scoped_window_error({
		code: 'CLIPBOARD_UNAVAILABLE',
		message: 'Clipboard access is not available in the current Linux session.',
		details: {
			native_error: primary_error ? primary_error.message : null
		}
	});
}

async function wait_for_clipboard_text(params)
{
	var started_at = Date.now();
	var timeout_ms = typeof params.timeout_ms !== 'undefined' ? Math.max(50, Math.round(params.timeout_ms)) : 1500;
	var poll_interval_ms = typeof params.poll_interval_ms !== 'undefined' ? Math.max(10, Math.round(params.poll_interval_ms)) : 50;
	var last_result = null;

	while ((Date.now() - started_at) <= timeout_ms)
	{
		last_result = read_clipboard_text();
		if (typeof last_result.data === 'string' && last_result.data.length > 0)
		{
			return last_result;
		}

		await sleep_async(poll_interval_ms);
	}

	throw create_scoped_window_error({
		code: 'CLIPBOARD_TIMEOUT',
		message: 'Timed out waiting for clipboard text after the copy shortcut was sent.',
		details: {
			timeout_ms: timeout_ms,
			last_method: last_result ? last_result.method : null
		}
	});
}

async function copy_selection_from_target(params)
{
	var action_params = params || {};
	var target = action_params.target || resolve_window_target(action_params);
	var active_target;
	var clipboard_clear_result = null;
	var clipboard_read_result = null;
	var copy_context = null;
	var copy_result = null;

	if (action_params.require_active === true)
	{
		active_target = assert_window_target({
			target: target,
			require_active: true
		});
	}
	else
	{
		active_target = focus_and_verify_window_target({
			target: target
		});
	}

	if (action_params.clear_clipboard !== false)
	{
		clipboard_clear_result = clear_clipboard_text();
	}

	robotjs.keyTap('c', 'control');
	clipboard_read_result = await wait_for_clipboard_text(action_params);

	var context = get_verified_window_context({
		target: active_target,
		require_active: false
	});
	copy_context = {
		target: context.target,
		window: context.window_item,
		session: context.desktop_state.session,
		backend: context.desktop_state.capabilities.backend,
		timestamp: new Date().toISOString(),
		copy_method: clipboard_read_result.method,
		clear_method: clipboard_clear_result ? clipboard_clear_result.method : null,
		clipboard_format: 'text/plain'
	};
	copy_result = {
		data: clipboard_read_result.data,
		context: copy_context
	};

	if (typeof action_params.callback === 'function')
	{
		return action_params.callback(copy_result);
	}

	return copy_result;
}

function create_locked_window(params)
{
	var locked_target = params.target;

	return {
		getTarget: function()
		{
			return locked_target;
		},
		assert: function()
		{
			locked_target = get_verified_window_context({
				target: locked_target,
				require_active: false
			}).target;

			return locked_target;
		},
		focus: function()
		{
			locked_target = focus_and_verify_window_target({
				target: locked_target
			});

			return locked_target;
		},
		moveMouse: function(move_params)
		{
			var absolute_point = get_absolute_point_for_target({
				target: locked_target,
				x: move_params.x,
				y: move_params.y,
				relative_to: 'window',
				require_active: move_params && move_params.require_active === true
			});

			locked_target = absolute_point.target;
			return robotjs.moveMouse(absolute_point.x, absolute_point.y);
		},
		moveMousePath: function(move_params)
		{
			var path_result = move_mouse_path({
				target: locked_target,
				x: move_params.x,
				y: move_params.y,
				relative_to: 'window',
				require_active: move_params && move_params.require_active === true,
				style: move_params && move_params.style,
				duration_ms: move_params && move_params.duration_ms,
				steps: move_params && move_params.steps,
				random_seed: move_params && move_params.random_seed,
				include_effective_seed: move_params && move_params.include_effective_seed,
				randomization_amount: move_params && move_params.randomization_amount,
				speed_profile: move_params && move_params.speed_profile,
				speed_variation_amount: move_params && move_params.speed_variation_amount,
				min_step_delay_ms: move_params && move_params.min_step_delay_ms,
				max_step_delay_ms: move_params && move_params.max_step_delay_ms,
				wave_amplitude: move_params && move_params.wave_amplitude,
				wave_frequency: move_params && move_params.wave_frequency,
				humanization_amount: move_params && move_params.humanization_amount
			});

			if (path_result.target)
			{
				locked_target = path_result.target;
			}

			return build_public_mouse_path_result(path_result);
		},
		mouseClick: function(click_params)
		{
			var action_params = click_params || {};

			locked_target = assert_window_target({
				target: locked_target,
				require_active: action_params.require_active !== false
			});

			if (typeof action_params.x !== 'undefined' && typeof action_params.y !== 'undefined')
			{
				var absolute_point = get_absolute_point_for_target({
					target: locked_target,
					x: action_params.x,
					y: action_params.y,
					relative_to: 'window',
					require_active: action_params.require_active !== false
				});
				locked_target = absolute_point.target;
				robotjs.moveMouse(absolute_point.x, absolute_point.y);
			}

			return robotjs.mouseClick(action_params.button, action_params.double);
		},
		mouseClickPath: function(click_params)
		{
			var action_params = click_params || {};
			var path_result = this.moveMousePath(action_params);

			locked_target = assert_window_target({
				target: locked_target,
				require_active: action_params.require_active !== false
			});

			robotjs.mouseClick(action_params.button, action_params.double);

			return build_public_mouse_path_result(path_result);
		},
		doubleClickHumanized: function(click_params)
		{
			var action_params = click_params || {};

			locked_target = assert_window_target({
				target: locked_target,
				require_active: action_params.require_active !== false
			});

			if (typeof action_params.x !== 'undefined' && typeof action_params.y !== 'undefined')
			{
				var absolute_point = get_absolute_point_for_target({
					target: locked_target,
					x: action_params.x,
					y: action_params.y,
					relative_to: 'window',
					require_active: action_params.require_active !== false
				});
				locked_target = absolute_point.target;
				robotjs.moveMouse(absolute_point.x, absolute_point.y);
			}

			return build_public_double_click_result(double_click_humanized({
				button: action_params.button,
				level: action_params.level,
				random_seed: action_params.random_seed,
				include_effective_seed: action_params.include_effective_seed,
				min_interval_ms: action_params.min_interval_ms,
				max_interval_ms: action_params.max_interval_ms,
				before_second_click: function()
				{
					locked_target = assert_window_target({
						target: locked_target,
						require_active: action_params.require_active !== false
					});
				}
			}));
		},
		keyTap: function(key_params)
		{
			locked_target = prepare_scoped_keyboard_target({
				target: locked_target,
				require_active: key_params && key_params.require_active
			});

			return robotjs.keyTap(key_params.key, key_params.modifier);
		},
		typeString: function(type_params)
		{
			locked_target = prepare_scoped_keyboard_target({
				target: locked_target,
				require_active: type_params && type_params.require_active
			});

			return robotjs.typeString(type_params.text);
		},
		typeStringHumanized: function(type_params)
		{
			locked_target = prepare_scoped_keyboard_target({
				target: locked_target,
				require_active: type_params && type_params.require_active
			});

			return build_public_typing_result(type_string_humanized(type_params));
		},
		copySelection: async function(copy_params)
		{
			var action_params = copy_params || {};

			return copy_selection_from_target({
				target: locked_target,
				timeout_ms: action_params.timeout_ms,
				poll_interval_ms: action_params.poll_interval_ms,
				require_active: action_params.require_active === true,
				clear_clipboard: action_params.clear_clipboard,
				callback: action_params.callback
			}).then(function(result)
			{
				if (result && result.context && result.context.target)
				{
					locked_target = result.context.target;
				}

				return result;
			});
		},
		findImage: function(search_params)
		{
			var action_params = search_params || {};

			return find_image_in_source({
				source: build_locked_window_image_source(this, action_params),
				reference: action_params.reference,
				tolerance: action_params.tolerance
			});
		},
		findAllImages: function(search_params)
		{
			var action_params = search_params || {};

			return find_all_images_in_source({
				source: build_locked_window_image_source(this, action_params),
				reference: action_params.reference,
				tolerance: action_params.tolerance,
				max_results: action_params.max_results
			});
		},
		findImageFuzzy: function(search_params)
		{
			var action_params = search_params || {};

			return find_fuzzy_image_in_source({
				source: build_locked_window_image_source(this, action_params),
				reference: action_params.reference,
				threshold: action_params.threshold,
				tolerance: action_params.tolerance,
				allow_partial_match: action_params.allow_partial_match,
				minimum_overlap_ratio: action_params.minimum_overlap_ratio,
				sample_step: action_params.sample_step
			});
		},
		moveMouseToImage: function(search_params)
		{
			var action_params = search_params || {};
			var result = run_image_mouse_move_action({
				action_params: build_locked_window_image_action_params(this, action_params),
				find_match: find_image_in_source,
				path: false,
				require_coordinate_source: false
			});

			if (result.match && result.match.target)
			{
				locked_target = result.match.target;
			}

			return result;
		},
		moveMousePathToImage: function(search_params)
		{
			var action_params = search_params || {};
			var result = run_image_mouse_move_action({
				action_params: build_locked_window_image_action_params(this, action_params),
				find_match: find_image_in_source,
				path: true,
				require_coordinate_source: false
			});

			if (result.match && result.match.target)
			{
				locked_target = result.match.target;
			}

			return result;
		},
		moveMouseToImageFuzzy: function(search_params)
		{
			var action_params = search_params || {};
			var result = run_image_mouse_move_action({
				action_params: build_locked_window_image_action_params(this, action_params),
				find_match: find_fuzzy_image_in_source,
				path: false,
				require_coordinate_source: false
			});

			if (result.match && result.match.target)
			{
				locked_target = result.match.target;
			}

			return result;
		},
		moveMousePathToImageFuzzy: function(search_params)
		{
			var action_params = search_params || {};
			var result = run_image_mouse_move_action({
				action_params: build_locked_window_image_action_params(this, action_params),
				find_match: find_fuzzy_image_in_source,
				path: true,
				require_coordinate_source: false
			});

			if (result.match && result.match.target)
			{
				locked_target = result.match.target;
			}

			return result;
		},
		capture: function(capture_params)
		{
			var action_params = capture_params || {};
			locked_target = get_verified_window_context({
				target: locked_target,
				require_active: action_params.require_active === true
			}).target;

			return module.exports.screen.captureWindow({
				target: locked_target,
				x: action_params.x,
				y: action_params.y,
				width: action_params.width,
				height: action_params.height,
				require_active: action_params.require_active === true
			});
		}
	};
}

module.exports.screen = {};

module.exports.screen.capture = function(x, y, width, height)
{
	var bitmap_data;

	if (typeof x !== 'undefined' &&
		typeof y !== 'undefined' &&
		typeof width !== 'undefined' &&
		typeof height !== 'undefined')
	{
		bitmap_data = robotjs.captureScreen(x, y, width, height);
	}
	else
	{
		bitmap_data = robotjs.captureScreen();
	}

	return create_bitmap_wrapper(bitmap_data);
};

module.exports.screen.captureWindow = function(params)
{
	var context = get_verified_window_context({
		target: params.target,
		window_id: params.window_id,
		title: params.title,
		title_includes: params.title_includes,
		class_name: params.class_name,
		instance_name: params.instance_name,
		pid: params.pid,
		workspace_id: params.workspace_id,
		monitor_id: params.monitor_id,
		require_active: params.require_active === true
	});
	var window_item = context.window_item;
	var capture_x = window_item.geometry.x + (params.x || 0);
	var capture_y = window_item.geometry.y + (params.y || 0);
	var capture_width = typeof params.width !== 'undefined' ? params.width : window_item.geometry.width;
	var capture_height = typeof params.height !== 'undefined' ? params.height : window_item.geometry.height;

	return module.exports.screen.capture(capture_x, capture_y, capture_width, capture_height);
};

module.exports.screen.captureDisplay = function(params)
{
	var desktop_state = get_desktop_state();
	var display_item = null;

	for (var index = 0; index < desktop_state.displays.length; index += 1)
	{
		if (desktop_state.displays[index].id === params.display_id)
		{
			display_item = desktop_state.displays[index];
			break;
		}
	}

	if (!display_item)
	{
		throw new Error('The requested display target does not exist.');
	}

	return module.exports.screen.capture(display_item.x, display_item.y, display_item.width, display_item.height);
};

module.exports.image_search = {
	loadReference: function(params)
	{
		return load_image_reference_from_png(params);
	},
	find: function(params)
	{
		return find_image_in_source(params);
	},
	findAll: function(params)
	{
		return find_all_images_in_source(params);
	},
	findFuzzy: function(params)
	{
		return find_fuzzy_image_in_source(params);
	}
};

module.exports.desktop = {
	getState: function()
	{
		return get_desktop_state();
	},
	getCapabilities: function()
	{
		return get_desktop_state().capabilities;
	},
	listDisplays: function()
	{
		return get_desktop_state().displays;
	},
	listWorkspaces: function()
	{
		return get_desktop_state().workspaces;
	},
	listWindows: function()
	{
		return get_desktop_state().windows;
	},
	getActiveWindow: function()
	{
		return get_desktop_state().activeWindow;
	},
	resolveWindowTarget: function(params)
	{
		return resolve_window_target(params);
	},
		assertWindowTarget: function(params)
		{
			return assert_window_target(params);
		},
		lockWindow: function(params)
		{
			return create_locked_window({
				target: resolve_window_target(params)
			});
		},
		focusWindow: function(params)
		{
			var target = params.target || resolve_window_target(params);
		robotjs.focusWindow(target.windowId);
		return target;
	},
	moveMouseTarget: function(params)
	{
		var absolute_point = get_absolute_point_for_target({
			target: params.target || resolve_window_target(params),
			x: params.x,
			y: params.y,
			relative_to: params.relative_to,
			require_active: params.require_active === true
		});

		return robotjs.moveMouse(absolute_point.x, absolute_point.y);
	},
	moveMousePath: function(params)
	{
		var resolved_target = null;
		var path_result;

		if (has_window_query(params))
		{
			resolved_target = params.target || resolve_window_target(params);
		}

		path_result = move_mouse_path({
			target: resolved_target,
			window_id: params.window_id,
			title: params.title,
			title_includes: params.title_includes,
			class_name: params.class_name,
			instance_name: params.instance_name,
			pid: params.pid,
			workspace_id: params.workspace_id,
			monitor_id: params.monitor_id,
			active_only: params.active_only,
			x: params.x,
			y: params.y,
			relative_to: params.relative_to,
			require_active: params.require_active === true,
			style: params.style,
			duration_ms: params.duration_ms,
			steps: params.steps,
			random_seed: params.random_seed,
			include_effective_seed: params.include_effective_seed,
			randomization_amount: params.randomization_amount,
			speed_profile: params.speed_profile,
			speed_variation_amount: params.speed_variation_amount,
			min_step_delay_ms: params.min_step_delay_ms,
			max_step_delay_ms: params.max_step_delay_ms,
			wave_amplitude: params.wave_amplitude,
			wave_frequency: params.wave_frequency,
			humanization_amount: params.humanization_amount
		});

		return build_public_mouse_path_result(path_result);
	},
	moveMouseToImage: function(params)
	{
		return run_image_mouse_move_action({
			action_params: params || {},
			find_match: find_image_in_source,
			path: false
		});
	},
	moveMousePathToImage: function(params)
	{
		return run_image_mouse_move_action({
			action_params: params || {},
			find_match: find_image_in_source,
			path: true
		});
	},
	moveMouseToImageFuzzy: function(params)
	{
		return run_image_mouse_move_action({
			action_params: params || {},
			find_match: find_fuzzy_image_in_source,
			path: false
		});
	},
	moveMousePathToImageFuzzy: function(params)
	{
		return run_image_mouse_move_action({
			action_params: params || {},
			find_match: find_fuzzy_image_in_source,
			path: true
		});
	},
	mouseClickTarget: function(params)
	{
		var target = assert_window_target({
			target: params.target || resolve_window_target(params),
			require_active: params.require_active !== false
		});

		if (typeof params.x !== 'undefined' && typeof params.y !== 'undefined')
		{
			var absolute_point = get_absolute_point_for_target({
				target: target,
				x: params.x,
				y: params.y,
				relative_to: params.relative_to,
				require_active: params.require_active !== false
			});
			robotjs.moveMouse(absolute_point.x, absolute_point.y);
		}

		return robotjs.mouseClick(params.button, params.double);
	},
	doubleClickTargetHumanized: function(params)
	{
		var target = assert_window_target({
			target: params.target || resolve_window_target(params),
			require_active: params.require_active !== false
		});

		if (typeof params.x !== 'undefined' && typeof params.y !== 'undefined')
		{
			var absolute_point = get_absolute_point_for_target({
				target: target,
				x: params.x,
				y: params.y,
				relative_to: params.relative_to,
				require_active: params.require_active !== false
			});
			robotjs.moveMouse(absolute_point.x, absolute_point.y);
		}

		return build_public_double_click_result(double_click_humanized({
			button: params.button,
			level: params.level,
			random_seed: params.random_seed,
			include_effective_seed: params.include_effective_seed,
			min_interval_ms: params.min_interval_ms,
			max_interval_ms: params.max_interval_ms,
			before_second_click: function()
			{
				assert_window_target({
					target: target,
					require_active: params.require_active !== false
				});
			}
		}));
	},
	mouseClickPath: function(params)
	{
		var path_result = this.moveMousePath(params);

		if (has_window_query(params))
		{
			assert_window_target({
				target: params.target || resolve_window_target(params),
				require_active: params.require_active !== false
			});
		}

		robotjs.mouseClick(params.button, params.double);
		return build_public_mouse_path_result(path_result);
	},
		keyTapTarget: function(params)
		{
			prepare_scoped_keyboard_target({
				target: params.target || resolve_window_target(params),
				require_active: params.require_active
			});

			return robotjs.keyTap(params.key, params.modifier);
		},
		typeStringTarget: function(params)
		{
			prepare_scoped_keyboard_target({
				target: params.target || resolve_window_target(params),
				require_active: params.require_active
			});

			return robotjs.typeString(params.text);
		},
		typeStringTargetHumanized: function(params)
		{
			prepare_scoped_keyboard_target({
				target: params.target || resolve_window_target(params),
				require_active: params.require_active
			});

			return build_public_typing_result(type_string_humanized(params));
		},
		copySelectionFromTarget: async function(params)
		{
			return copy_selection_from_target(params);
		}
};

module.exports.typeStringHumanized = function(params)
{
	return build_public_typing_result(type_string_humanized(params));
};

module.exports.doubleClickHumanized = function(params)
{
	return build_public_double_click_result(double_click_humanized(params));
};
