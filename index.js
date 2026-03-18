var crypto = require('node:crypto');
var robotjs = require('./build/Release/robotjs.node');

module.exports = robotjs;

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

function get_verified_window_context(params)
{
	var desktop_state = get_desktop_state();
	var window_query = params || {};
	var target = window_query.target;
	var window_item = null;

	if (!desktop_state.capabilities || !desktop_state.capabilities.supportsStrictTargetVerification)
	{
		throw new Error('Strict window target verification is not supported in the current Linux session.');
	}

	if (!target)
	{
		target = resolve_window_target(window_query);
	}

	window_item = get_window_by_id(desktop_state, target.windowId);
	if (!window_item)
	{
		throw new Error('The requested window target no longer exists.');
	}

	target = build_window_target(desktop_state, window_item);

	if (window_query.require_active === true)
	{
		if (!desktop_state.activeWindow || String(desktop_state.activeWindow.windowId) !== String(target.windowId))
		{
			throw new Error('The requested window target is not active.');
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
		throw new Error('The requested window target could not be focused.');
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
		throw new Error('Window discovery is not supported in the current Linux session.');
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
		throw new Error('No window matched the requested target criteria.');
	}

	if (candidate_windows.length > 1)
	{
		throw new Error('Window target resolution was ambiguous.');
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
		throw new Error('The requested window target does not have usable geometry.');
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
			var target = assert_window_target({
				target: locked_target,
				require_active: action_params.require_active !== false
			});

			locked_target = target;

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
				var target = assert_window_target({
					target: locked_target,
					require_active: action_params.require_active !== false
				});

				locked_target = target;
				robotjs.mouseClick(action_params.button, action_params.double);

				return build_public_mouse_path_result(path_result);
			},
			keyTap: function(key_params)
			{
			locked_target = focus_and_verify_window_target({
				target: locked_target
			});

			return robotjs.keyTap(key_params.key, key_params.modifier);
		},
		typeString: function(type_params)
		{
			locked_target = focus_and_verify_window_target({
				target: locked_target
			});

			return robotjs.typeString(type_params.text);
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

	return new bitmap(
		bitmap_data.width,
		bitmap_data.height,
		bitmap_data.byteWidth,
		bitmap_data.bitsPerPixel,
		bitmap_data.bytesPerPixel,
		bitmap_data.image
	);
};

module.exports.screen.captureWindow = function(params)
{
	var target = assert_window_target({
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
	var desktop_state = get_desktop_state();
	var window_item = get_window_by_id(desktop_state, target.windowId);
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
			var target = params.target || resolve_window_target(params);

			if (params.require_active === false)
			{
				assert_window_target({
					target: target,
					require_active: false
				});
			}
			else
			{
				focus_and_verify_window_target({
					target: target
				});
			}

			return robotjs.keyTap(params.key, params.modifier);
		},
		typeStringTarget: function(params)
		{
			var target = params.target || resolve_window_target(params);

			if (params.require_active === false)
			{
				assert_window_target({
					target: target,
					require_active: false
				});
			}
			else
			{
				focus_and_verify_window_target({
					target: target
				});
			}

			return robotjs.typeString(params.text);
		}
};
