'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CONTINUE = 'CONTINUE';
const EXIT = 'EXIT';

class ImageCatalogWatcherError extends Error
{
	constructor(params)
	{
		super(params.message);
		this.name = 'ImageCatalogWatcherError';
		this.code = params.code;
		this.details = params.details || null;
		this.recoverable = params.recoverable === true;
		if (params.cause)
		{
			this.cause = params.cause;
		}
	}
}

function AssertObject(value, message)
{
	if (!value || typeof value !== 'object' || Array.isArray(value))
	{
		throw new TypeError(message);
	}
	return value;
}

function GetFiniteNumber(params)
{
	const value = params.value;
	if (typeof value === 'undefined')
	{
		return params.default_value;
	}
	if (typeof value !== 'number' || !Number.isFinite(value) ||
		value < params.minimum || value > params.maximum)
	{
		throw new TypeError(params.label + ' must be a finite number between ' +
			params.minimum + ' and ' + params.maximum + '.');
	}
	return value;
}

function GetPositiveInteger(params)
{
	const value = typeof params.value === 'undefined' ? params.default_value : params.value;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || Math.floor(value) !== value)
	{
		throw new TypeError(params.label + ' must be a positive integer.');
	}
	return value;
}

function GetThreadCount(value)
{
	if (typeof value === 'undefined' || value === 'auto')
	{
		return Math.max(1, Math.min(8, os.availableParallelism()));
	}
	if (typeof value !== 'number' || !Number.isFinite(value) ||
		value < 1 || value > 64 || Math.floor(value) !== value)
	{
		throw new TypeError('matching.thread_count must be "auto" or an integer between 1 and 64.');
	}
	return value;
}

function GetEnum(params)
{
	const value = typeof params.value === 'undefined' ? params.default_value : params.value;
	if (!params.values.includes(value))
	{
		throw new TypeError(params.label + ' must be one of: ' + params.values.join(', ') + '.');
	}
	return value;
}

function ValidateCallback(value, label, required)
{
	if (typeof value === 'undefined' && !required)
	{
		return null;
	}
	if (typeof value !== 'function')
	{
		throw new TypeError(label + ' must be a function.');
	}
	return value;
}

function AssertKnownKeys(value, allowed_keys, label)
{
	for (const key of Object.keys(value))
	{
		if (!allowed_keys.has(key))
		{
			throw new TypeError(label + ' contains an unsupported option: ' + key + '.');
		}
	}
}

function NormalizeDisplayIds(value, label)
{
	if (typeof value === 'undefined')
	{
		return null;
	}
	if (!Array.isArray(value) || value.length === 0)
	{
		throw new TypeError(label + ' must be a non-empty array when provided.');
	}

	return Object.freeze(Array.from(new Set(value.map(function(display_id)
	{
		if (typeof display_id !== 'number' || !Number.isFinite(display_id) || Math.floor(display_id) !== display_id)
		{
			throw new TypeError('Every ' + label.slice(0, -1) + ' must be an integer.');
		}
		return display_id;
	}))));
}

function IsLockedWindowLike(value)
{
	return !!value &&
		typeof value === 'object' &&
		typeof value.getTarget === 'function' &&
		typeof value.assert === 'function' &&
		typeof value.capture === 'function';
}

function NormalizeSource(params)
{
	if (typeof params.source === 'undefined')
	{
		return Object.freeze({
			type: 'displays',
			display_ids: NormalizeDisplayIds(params.display_ids, 'display_ids')
		});
	}
	if (typeof params.display_ids !== 'undefined')
	{
		throw new TypeError('display_ids cannot be combined with source. Configure display IDs inside source instead.');
	}

	const source = AssertObject(params.source, 'source must be an object.');
	if (source.type === 'displays')
	{
		AssertKnownKeys(source, new Set(['type', 'display_ids']), 'source');
		return Object.freeze({
			type: 'displays',
			display_ids: NormalizeDisplayIds(source.display_ids, 'source.display_ids')
		});
	}
	if (source.type === 'locked_window')
	{
		AssertKnownKeys(source, new Set(['type', 'locked_window', 'require_active']), 'source');
		if (!IsLockedWindowLike(source.locked_window))
		{
			throw new TypeError('source.locked_window must be a valid locked window handle.');
		}
		if (typeof source.require_active !== 'undefined' && typeof source.require_active !== 'boolean')
		{
			throw new TypeError('source.require_active must be a boolean when provided.');
		}
		return Object.freeze({
			type: 'locked_window',
			locked_window: source.locked_window,
			require_active: source.require_active === true
		});
	}

	throw new TypeError('source.type must be "displays" or "locked_window".');
}

function NormalizeImageSets(value)
{
	if (typeof value === 'undefined')
	{
		return [];
	}
	if (!Array.isArray(value))
	{
		throw new TypeError('image_sets must be an array.');
	}

	const names = new Set();
	return value.map(function(set_value, set_index)
	{
		AssertObject(set_value, 'Every image set must be an object.');
		const name = typeof set_value.name === 'string' ? set_value.name.trim() : '';
		if (!name)
		{
			throw new TypeError('Image set names must be non-empty strings.');
		}
		if (names.has(name))
		{
			throw new TypeError('Image set names must be unique. Duplicate: ' + name);
		}
		names.add(name);

		if (!Array.isArray(set_value.members) || set_value.members.length === 0)
		{
			throw new TypeError('Image set ' + name + ' must contain at least one member.');
		}
		const members = set_value.members.map(function(member)
		{
			if (typeof member !== 'string' || !member.trim())
			{
				throw new TypeError('Image set members must be non-empty relative paths or filenames.');
			}
			const normalized = member.trim().replace(/\\/g, '/');
			if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../'))
			{
				throw new TypeError('Image set members must stay within image_dir.');
			}
			return normalized.replace(/^\.\//, '');
		});

		return Object.freeze({ name: name, members: Object.freeze(members), order: set_index });
	});
}

function NormalizeOptions(input)
{
	const params = AssertObject(input, 'Image catalog watcher options are required.');
	const image_dir = typeof params.image_dir === 'string' ? params.image_dir.trim() : '';
	if (!image_dir)
	{
		throw new TypeError('image_dir must be a non-empty string.');
	}

	const matching_input = typeof params.matching === 'undefined'
		? {}
		: AssertObject(params.matching, 'matching must be an object.');
	AssertKnownKeys(
		matching_input,
		new Set([
			'mode',
			'threshold',
			'tolerance',
			'allow_partial_match',
			'minimum_overlap_ratio',
			'candidate_step',
			'max_results_per_image',
			'max_candidates_per_image',
			'thread_count'
		]),
		'matching'
	);
	const repeat_input = typeof params.repeat === 'undefined'
		? {}
		: AssertObject(params.repeat, 'repeat must be an object.');
	const mode = GetEnum({
		value: matching_input.mode,
		default_value: 'exact',
		values: ['exact', 'fuzzy'],
		label: 'matching.mode'
	});
	const repeat_mode = GetEnum({
		value: repeat_input.mode,
		default_value: 'changes_only',
		values: ['every_sweep', 'changes_only', 'transition_only', 'throttled'],
		label: 'repeat.mode'
	});

	if (typeof params.signal !== 'undefined' &&
		(!params.signal || typeof params.signal.addEventListener !== 'function' || typeof params.signal.aborted !== 'boolean'))
	{
		throw new TypeError('signal must be an AbortSignal.');
	}

	return Object.freeze({
		image_dir: path.resolve(image_dir),
		check_period_ms: GetPositiveInteger({ value: params.check_period_ms, default_value: 1000, label: 'check_period_ms' }),
		catalog_debounce_ms: GetPositiveInteger({ value: params.catalog_debounce_ms, default_value: 150, label: 'catalog_debounce_ms' }),
		max_file_size_bytes: GetPositiveInteger({ value: params.max_file_size_bytes, default_value: 64 * 1024 * 1024, label: 'max_file_size_bytes' }),
		max_catalog_images: GetPositiveInteger({ value: params.max_catalog_images, default_value: 10000, label: 'max_catalog_images' }),
		max_total_decoded_bytes: GetPositiveInteger({ value: params.max_total_decoded_bytes, default_value: 512 * 1024 * 1024, label: 'max_total_decoded_bytes' }),
		matching: Object.freeze({
			mode: mode,
			threshold: GetFiniteNumber({ value: matching_input.threshold, default_value: 0.85, minimum: 0, maximum: 1, label: 'matching.threshold' }),
			tolerance: GetFiniteNumber({ value: matching_input.tolerance, default_value: mode === 'fuzzy' ? 0.15 : 0, minimum: 0, maximum: 1, label: 'matching.tolerance' }),
			allow_partial_match: matching_input.allow_partial_match === true,
			minimum_overlap_ratio: GetFiniteNumber({ value: matching_input.minimum_overlap_ratio, default_value: 0.6, minimum: 0, maximum: 1, label: 'matching.minimum_overlap_ratio' }),
			candidate_step: GetPositiveInteger({ value: matching_input.candidate_step, default_value: 1, label: 'matching.candidate_step' }),
			max_results_per_image: GetPositiveInteger({ value: matching_input.max_results_per_image, default_value: 100, label: 'matching.max_results_per_image' }),
			max_candidates_per_image: GetPositiveInteger({ value: matching_input.max_candidates_per_image, default_value: 1000000, label: 'matching.max_candidates_per_image' }),
			thread_count: GetThreadCount(matching_input.thread_count)
		}),
		repeat: Object.freeze({
			mode: repeat_mode,
			interval_ms: GetPositiveInteger({ value: repeat_input.interval_ms, default_value: 5000, label: 'repeat.interval_ms' })
		}),
		callback_mode: GetEnum({ value: params.callback_mode, default_value: 'serial', values: ['serial', 'concurrent'], label: 'callback_mode' }),
		max_pending_callbacks: GetPositiveInteger({ value: params.max_pending_callbacks, default_value: 8, label: 'max_pending_callbacks' }),
		callback_error_policy: GetEnum({ value: params.callback_error_policy, default_value: 'stop', values: ['stop', 'continue'], label: 'callback_error_policy' }),
		max_consecutive_errors: GetPositiveInteger({ value: params.max_consecutive_errors, default_value: 3, label: 'max_consecutive_errors' }),
		source: NormalizeSource(params),
		image_sets: Object.freeze(NormalizeImageSets(params.image_sets)),
		extra: params.extra,
		signal: params.signal || null,
		on_before_sweep: ValidateCallback(params.on_before_sweep, 'on_before_sweep', false),
		on_matches_found: ValidateCallback(params.on_matches_found, 'on_matches_found', true),
		on_no_matches_found: ValidateCallback(params.on_no_matches_found, 'on_no_matches_found', false),
		on_image_sets_found: ValidateCallback(params.on_image_sets_found, 'on_image_sets_found', false),
		on_catalog_changed: ValidateCallback(params.on_catalog_changed, 'on_catalog_changed', false),
		on_error: ValidateCallback(params.on_error, 'on_error', false)
	});
}

function HashBitmap(bitmap)
{
	const hash = crypto.createHash('sha256');
	const metadata = Buffer.allocUnsafe(20);
	metadata.writeUInt32LE(bitmap.width, 0);
	metadata.writeUInt32LE(bitmap.height, 4);
	metadata.writeUInt32LE(bitmap.byteWidth, 8);
	metadata.writeUInt32LE(bitmap.bitsPerPixel, 12);
	metadata.writeUInt32LE(bitmap.bytesPerPixel, 16);
	hash.update(metadata);
	const visible_row_bytes = bitmap.width * bitmap.bytesPerPixel;
	for (let y = 0; y < bitmap.height; y += 1)
	{
		const row_start = y * bitmap.byteWidth;
		hash.update(bitmap.image.subarray(row_start, row_start + visible_row_bytes));
	}
	return hash.digest('hex');
}

async function DiscoverPngPaths(root_path, diagnostics)
{
	const paths = [];
	async function Walk(directory_path)
	{
		let entries;
		try
		{
			entries = await fs.promises.readdir(directory_path, { withFileTypes: true });
		}
		catch (error)
		{
			diagnostics.push({ code: 'DIRECTORY_READ_FAILED', path: directory_path, message: error.message });
			return;
		}

		entries.sort(function(first, second) { return first.name.localeCompare(second.name); });
		for (const entry of entries)
		{
			const entry_path = path.join(directory_path, entry.name);
			if (entry.isSymbolicLink())
			{
				diagnostics.push({ code: 'SYMLINK_SKIPPED', path: entry_path, message: 'Symbolic links are not followed.' });
				continue;
			}
			if (entry.isDirectory())
			{
				await Walk(entry_path);
			}
			else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.png')
			{
				paths.push(entry_path);
			}
		}
	}

	await Walk(root_path);
	return paths;
}

function PublicCatalogImage(image)
{
	return {
		content_id: image.content_id,
		width: image.width,
		height: image.height,
		aliases: image.aliases.map(function(alias)
		{
			return {
				relative_path: alias.relative_path,
				absolute_path: alias.absolute_path,
				file_sha256: alias.file_sha256,
				file_size_bytes: alias.file_size_bytes,
				mtime_ms: alias.mtime_ms
			};
		})
	};
}

function ResolveImageSets(image_sets, images, diagnostics)
{
	const by_relative_path = new Map();
	const by_basename = new Map();
	for (const image of images)
	{
		for (const alias of image.aliases)
		{
			by_relative_path.set(alias.relative_path, image);
			const basename = path.posix.basename(alias.relative_path);
			if (!by_basename.has(basename)) by_basename.set(basename, []);
			by_basename.get(basename).push(image);
		}
	}

	return image_sets.map(function(image_set)
	{
		const resolved_images = [];
		let valid = true;
		for (const member of image_set.members)
		{
			let image = null;
			if (member.includes('/'))
			{
				image = by_relative_path.get(member) || null;
			}
			else
			{
				const matches = by_basename.get(member) || [];
				const unique_matches = Array.from(new Map(matches.map(function(item) { return [item.content_id, item]; })).values());
				if (unique_matches.length === 1) image = unique_matches[0];
				else if (unique_matches.length > 1)
				{
					valid = false;
					diagnostics.push({ code: 'IMAGE_SET_MEMBER_AMBIGUOUS', set_name: image_set.name, member: member, message: 'Bare filename resolves to multiple catalog images.' });
					continue;
				}
			}

			if (!image)
			{
				valid = false;
				diagnostics.push({ code: 'IMAGE_SET_MEMBER_MISSING', set_name: image_set.name, member: member, message: 'Image set member is not present in the catalog.' });
				continue;
			}
			if (!resolved_images.some(function(item) { return item.content_id === image.content_id; }))
			{
				resolved_images.push(image);
			}
		}

		return Object.freeze({
			name: image_set.name,
			configured_members: image_set.members,
			images: Object.freeze(resolved_images),
			valid: valid
		});
	});
}

async function BuildCatalogGeneration(params)
{
	const options = params.options;
	const diagnostics = [];
	const png_paths = await DiscoverPngPaths(options.image_dir, diagnostics);
	if (png_paths.length > options.max_catalog_images)
	{
		throw new ImageCatalogWatcherError({
			code: 'CATALOG_IMAGE_LIMIT_EXCEEDED',
			message: 'PNG catalog contains more files than max_catalog_images.',
			details: { count: png_paths.length, limit: options.max_catalog_images }
		});
	}

	const images_by_hash = new Map();
	let decoded_bytes = 0;
	function RetainPreviousAlias(absolute_path)
	{
		if (!params.previous_generation) return;
		for (const previous_image of params.previous_generation.images)
		{
			const previous_alias = previous_image.aliases.find(function(alias)
			{
				return alias.absolute_path === absolute_path;
			});
			if (!previous_alias) continue;

			if (images_by_hash.has(previous_image.content_id))
			{
				images_by_hash.get(previous_image.content_id).aliases.push(previous_alias);
				return;
			}
			const bitmap_bytes = previous_image.bitmap.byteWidth * previous_image.bitmap.height;
			decoded_bytes += bitmap_bytes;
			if (decoded_bytes > options.max_total_decoded_bytes)
			{
				throw new ImageCatalogWatcherError({
					code: 'CATALOG_MEMORY_LIMIT_EXCEEDED',
					message: 'Decoded PNG catalog exceeds max_total_decoded_bytes.',
					details: { decoded_bytes: decoded_bytes, limit: options.max_total_decoded_bytes }
				});
			}
			images_by_hash.set(previous_image.content_id, {
				content_id: previous_image.content_id,
				width: previous_image.width,
				height: previous_image.height,
				bitmap: previous_image.bitmap,
				aliases: [previous_alias]
			});
			return;
		}
	}
	for (const absolute_path of png_paths)
	{
		try
		{
			const before_stat = await fs.promises.stat(absolute_path);
			if (before_stat.size > options.max_file_size_bytes)
			{
				diagnostics.push({ code: 'PNG_FILE_TOO_LARGE', path: absolute_path, message: 'PNG exceeds max_file_size_bytes.' });
				RetainPreviousAlias(absolute_path);
				continue;
			}
			const file_data = await fs.promises.readFile(absolute_path);
			const file_sha256 = crypto.createHash('sha256').update(file_data).digest('hex');
			const bitmap = params.dependencies.load_bitmap(absolute_path);
			const after_stat = await fs.promises.stat(absolute_path);
			if (before_stat.size !== after_stat.size || before_stat.mtimeMs !== after_stat.mtimeMs)
			{
				diagnostics.push({ code: 'PNG_CHANGED_DURING_READ', path: absolute_path, message: 'PNG changed while it was being decoded and will be retried.' });
				RetainPreviousAlias(absolute_path);
				continue;
			}

			const bitmap_bytes = bitmap.byteWidth * bitmap.height;
			decoded_bytes += bitmap_bytes;
			if (decoded_bytes > options.max_total_decoded_bytes)
			{
				throw new ImageCatalogWatcherError({
					code: 'CATALOG_MEMORY_LIMIT_EXCEEDED',
					message: 'Decoded PNG catalog exceeds max_total_decoded_bytes.',
					details: { decoded_bytes: decoded_bytes, limit: options.max_total_decoded_bytes }
				});
			}

			const content_id = HashBitmap(bitmap);
			const alias = Object.freeze({
				relative_path: path.relative(options.image_dir, absolute_path).split(path.sep).join('/'),
				absolute_path: absolute_path,
				file_sha256: file_sha256,
				file_size_bytes: after_stat.size,
				mtime_ms: after_stat.mtimeMs
			});
			if (images_by_hash.has(content_id))
			{
				images_by_hash.get(content_id).aliases.push(alias);
				decoded_bytes -= bitmap_bytes;
			}
			else
			{
				images_by_hash.set(content_id, {
					content_id: content_id,
					width: bitmap.width,
					height: bitmap.height,
					bitmap: bitmap,
					aliases: [alias]
				});
			}
		}
		catch (error)
		{
			if (error instanceof ImageCatalogWatcherError) throw error;
			diagnostics.push({ code: 'PNG_LOAD_FAILED', path: absolute_path, message: error.message });
			RetainPreviousAlias(absolute_path);
		}
	}

	const images = Array.from(images_by_hash.values()).sort(function(first, second)
	{
		return first.content_id.localeCompare(second.content_id);
	});
	for (const image of images)
	{
		image.aliases.sort(function(first, second) { return first.relative_path.localeCompare(second.relative_path); });
		Object.freeze(image.aliases);
		Object.freeze(image);
	}
	const resolved_sets = ResolveImageSets(options.image_sets, images, diagnostics);
	const matcher = params.dependencies.create_matcher(
		images.map(function(image) { return image.bitmap; }),
		options.matching
	);

	return Object.freeze({
		id: params.generation_id,
		created_at_ms: Date.now(),
		images: Object.freeze(images),
		resolved_sets: Object.freeze(resolved_sets),
		diagnostics: Object.freeze(diagnostics),
		decoded_bytes: decoded_bytes,
		matcher: matcher
	});
}

function CatalogSignature(generation)
{
	return JSON.stringify({
		images: generation.images.map(function(image)
		{
			return {
				content_id: image.content_id,
				aliases: image.aliases.map(function(alias)
				{
					return [alias.relative_path, alias.file_sha256];
				})
			};
		}),
		diagnostics: generation.diagnostics
	});
}

function DiffCatalogs(previous, current)
{
	const previous_paths = new Map();
	const current_paths = new Map();
	if (previous)
	{
		for (const image of previous.images)
		{
			for (const alias of image.aliases)
			{
				previous_paths.set(alias.relative_path, { content_id: image.content_id, file_sha256: alias.file_sha256 });
			}
		}
	}
	for (const image of current.images)
	{
		for (const alias of image.aliases)
		{
			current_paths.set(alias.relative_path, { content_id: image.content_id, file_sha256: alias.file_sha256 });
		}
	}

	const added = [];
	const changed = [];
	const deleted = [];
	for (const [relative_path, value] of current_paths)
	{
		if (!previous_paths.has(relative_path)) added.push(relative_path);
		else if (previous_paths.get(relative_path).file_sha256 !== value.file_sha256) changed.push(relative_path);
	}
	for (const relative_path of previous_paths.keys())
	{
		if (!current_paths.has(relative_path)) deleted.push(relative_path);
	}
	return {
		added: added.sort(),
		changed: changed.sort(),
		deleted: deleted.sort()
	};
}

function CloneDisplay(display)
{
	return {
		id: display.id,
		name: typeof display.name === 'string' ? display.name : null,
		x: display.x,
		y: display.y,
		width: display.width,
		height: display.height,
		is_primary: display.isPrimary === true
	};
}

function CloneTarget(target)
{
	return {
		targetType: 'window',
		windowId: String(target.windowId),
		title: typeof target.title === 'string' ? target.title : null,
		className: typeof target.className === 'string' ? target.className : null,
		instanceName: typeof target.instanceName === 'string' ? target.instanceName : null,
		pid: typeof target.pid === 'number' ? target.pid : null,
		workspaceId: typeof target.workspaceId === 'number' ? target.workspaceId : null,
		displayId: typeof target.displayId === 'number' ? target.displayId : null
	};
}

function CloneGeometry(geometry)
{
	return {
		x: geometry.x,
		y: geometry.y,
		width: geometry.width,
		height: geometry.height
	};
}

function FindOccurrenceDisplay(displays, global_x, global_y, preferred_display_id)
{
	let display = displays.find(function(item)
	{
		return global_x >= item.x && global_x < item.x + item.width &&
			global_y >= item.y && global_y < item.y + item.height;
	});
	if (!display && typeof preferred_display_id === 'number')
	{
		display = displays.find(function(item) { return item.id === preferred_display_id; });
	}
	if (!display)
	{
		throw new ImageCatalogWatcherError({
			code: 'MATCH_DISPLAY_UNAVAILABLE',
			message: 'A locked-window match could not be mapped to a desktop display.'
		});
	}
	return display;
}

function ValidateLockedWindowContext(options, context, displays)
{
	if (!context || typeof context !== 'object' ||
		!context.target || typeof context.target.windowId === 'undefined' ||
		!context.geometry || !Number.isFinite(context.geometry.x) ||
		!Number.isFinite(context.geometry.y) || !Number.isFinite(context.geometry.width) ||
		!Number.isFinite(context.geometry.height) || context.geometry.width <= 0 ||
		context.geometry.height <= 0)
	{
		throw new ImageCatalogWatcherError({
			code: 'LOCKED_WINDOW_CONTEXT_INVALID',
			message: 'The locked-window source did not provide a valid verified capture context.'
		});
	}
	if (context.bitmap && (!Number.isFinite(context.bitmap.width) || !Number.isFinite(context.bitmap.height)))
	{
		throw new ImageCatalogWatcherError({
			code: 'LOCKED_WINDOW_CAPTURE_INVALID',
			message: 'The locked-window source did not provide a valid bitmap capture.'
		});
	}

	return {
		type: 'locked_window',
		locked_window: options.source.locked_window,
		require_active: options.source.require_active,
		target: CloneTarget(context.target),
		geometry: CloneGeometry(context.geometry),
		displays: displays.slice(),
		bitmap: context.bitmap || null
	};
}

function IsTerminalLockedWindowError(error)
{
	return !!error && [
		'WINDOW_NOT_FOUND',
		'WINDOW_TARGET_NOT_FOUND',
		'WINDOW_VERIFICATION_UNSUPPORTED',
		'WINDOW_GEOMETRY_UNAVAILABLE',
		'LOCKED_WINDOW_CONTEXT_INVALID'
	].includes(error.code);
}

function EmptyNativeMetrics()
{
	return {
		catalog_images: 0,
		fingerprint_entries: 0,
		haystack_pixels_scanned: 0,
		index_buckets_visited: 0,
		candidate_offsets_generated: 0,
		candidate_offsets_verified: 0,
		verification_pixels_compared: 0,
		fingerprint_collisions_tested: 0,
		candidate_votes_recorded: 0,
		evidence_cells_initialized: 0,
		evidence_cells_examined: 0,
		workspace_bytes: 0,
		requested_thread_count: 0,
		available_thread_count: 0,
		effective_thread_count: 0,
		candidate_scan_ms: 0,
		candidate_extraction_ms: 0,
		verification_ms: 0,
		bitmap_copy_ms: 0,
		result_construction_ms: 0,
		queue_ms: 0,
		thread_budget_wait_ms: 0,
		capture_ms: 0,
		elapsed_ms: 0
	};
}

function AddNativeMetrics(target, source)
{
	for (const key of Object.keys(target))
	{
		if (key === 'workspace_bytes' ||
			key === 'requested_thread_count' ||
			key === 'available_thread_count' ||
			key === 'effective_thread_count')
		{
			target[key] = Math.max(target[key], source[key] || 0);
		}
		else
		{
			target[key] += source[key] || 0;
		}
	}
}

function BuildPublicOccurrence(source_result, occurrence)
{
	if (source_result.source_type === 'display' || source_result.display)
	{
		return {
			source_type: 'display',
			display: CloneDisplay(source_result.display),
			display_position: { x: occurrence.x, y: occurrence.y },
			global_position: {
				x: source_result.display.x + occurrence.x,
				y: source_result.display.y + occurrence.y
			},
			size: { width: occurrence.width, height: occurrence.height },
			score: occurrence.score,
			overlap_ratio: occurrence.overlap_ratio
		};
	}

	const global_x = source_result.geometry.x + occurrence.x;
	const global_y = source_result.geometry.y + occurrence.y;
	const display = FindOccurrenceDisplay(
		source_result.displays,
		global_x,
		global_y,
		source_result.target.displayId
	);
	return {
		source_type: 'locked_window',
		display: CloneDisplay(display),
		display_position: {
			x: global_x - display.x,
			y: global_y - display.y
		},
		window_position: { x: occurrence.x, y: occurrence.y },
		global_position: { x: global_x, y: global_y },
		size: { width: occurrence.width, height: occurrence.height },
		score: occurrence.score,
		overlap_ratio: occurrence.overlap_ratio
	};
}

function BuildSweepMatches(generation, source_results)
{
	const occurrences_by_content = new Map();
	const native_metrics = EmptyNativeMetrics();
	for (const source_result of source_results)
	{
		AddNativeMetrics(native_metrics, source_result.result.metrics);
		for (const image_result of source_result.result.images)
		{
			if (!image_result.occurrences || image_result.occurrences.length === 0) continue;
			const image = generation.images[image_result.image_index];
			if (!image) continue;
			if (!occurrences_by_content.has(image.content_id)) occurrences_by_content.set(image.content_id, []);
			for (const occurrence of image_result.occurrences)
			{
				occurrences_by_content.get(image.content_id).push(BuildPublicOccurrence(source_result, occurrence));
			}
		}
	}

	const matches = [];
	for (const image of generation.images)
	{
		if (!occurrences_by_content.has(image.content_id)) continue;
		const occurrences = occurrences_by_content.get(image.content_id);
		occurrences.sort(function(first, second)
		{
			return first.display.id - second.display.id ||
				first.display_position.y - second.display_position.y ||
				first.display_position.x - second.display_position.x ||
				first.source_type.localeCompare(second.source_type);
		});
		matches.push({ image: PublicCatalogImage(image), occurrences: occurrences });
	}

	const sets = [];
	for (const image_set of generation.resolved_sets)
	{
		if (!image_set.valid || image_set.images.length === 0 ||
			!image_set.images.every(function(image) { return occurrences_by_content.has(image.content_id); }))
		{
			continue;
		}
		sets.push({
			name: image_set.name,
			members: image_set.images.map(function(image)
			{
				return {
					image: PublicCatalogImage(image),
					occurrences: occurrences_by_content.get(image.content_id)
				};
			})
		});
	}

	return { matches: matches, sets: sets, native_metrics: native_metrics };
}

function SweepResultSignature(matches, sets)
{
	return JSON.stringify({
		matches: matches.map(function(match)
		{
			return [match.image.content_id, match.occurrences.map(function(occurrence)
			{
				return [occurrence.source_type, occurrence.display.id, occurrence.display_position.x,
					occurrence.display_position.y, occurrence.size.width,
					occurrence.size.height, Number(occurrence.score.toFixed(6))];
			})];
		}),
		sets: sets.map(function(image_set) { return image_set.name; })
	});
}

class ImageCatalogWatcherSession
{
	constructor(options, dependencies, initial_generation)
	{
		this._options = options;
		this._dependencies = dependencies;
		this._generation = initial_generation;
		this._generation_signature = CatalogSignature(initial_generation);
		this._state = 'starting';
		this._stop_reason = null;
		this._fatal_error = null;
		this._watcher = null;
		this._catalog_timer = null;
		this._delay_timer = null;
		this._delay_resolve = null;
		this._rebuild_running = false;
		this._rebuild_requested = false;
		this._next_generation_id = initial_generation.id + 1;
		this._pending_callbacks = new Set();
		this._last_result_signature = null;
		this._last_had_matches = null;
		this._last_emitted_at_ms = 0;
		this._consecutive_catalog_errors = 0;
		this._consecutive_sweep_errors = 0;
		this._abort_listener = null;
		this._last_source_context = null;
		this._started_at_ms = Date.now();
		this._stats = {
			sweeps: 0,
			match_sweeps: 0,
			no_match_sweeps: 0,
			match_occurrences: 0,
			satisfied_image_sets: 0,
			catalog_rebuilds: 0,
			catalog_errors: initial_generation.diagnostics.length,
			operational_errors: 0,
			callback_errors: 0,
			captures: 0,
			last_sweep_duration_ms: null,
			last_sweep_finished_at_ms: null,
			native: EmptyNativeMetrics()
		};
		this.completion = new Promise((resolve, reject) =>
		{
			this._resolve_completion = resolve;
			this._reject_completion = reject;
		});
	}

	getState()
	{
		return this._state;
	}

	getStatistics()
	{
		return {
			state: this._state,
			uptime_ms: Date.now() - this._started_at_ms,
			catalog_generation: this._generation.id,
			catalog_images: this._generation.images.length,
			catalog_aliases: this._generation.images.reduce(function(total, image) { return total + image.aliases.length; }, 0),
			decoded_bytes: this._generation.decoded_bytes,
			pending_callbacks: this._pending_callbacks.size,
			sweeps: this._stats.sweeps,
			match_sweeps: this._stats.match_sweeps,
			no_match_sweeps: this._stats.no_match_sweeps,
			match_occurrences: this._stats.match_occurrences,
			satisfied_image_sets: this._stats.satisfied_image_sets,
			catalog_rebuilds: this._stats.catalog_rebuilds,
			catalog_errors: this._stats.catalog_errors,
			operational_errors: this._stats.operational_errors,
			callback_errors: this._stats.callback_errors,
			captures: this._stats.captures,
			last_sweep_duration_ms: this._stats.last_sweep_duration_ms,
			last_sweep_finished_at_ms: this._stats.last_sweep_finished_at_ms,
			native: Object.assign({}, this._stats.native)
		};
	}

	stop()
	{
		this._RequestStop('stopped', null);
		return this.completion;
	}

	async Start()
	{
		this._state = 'running';
		this._last_source_context = this._PrepareSourceContext();
		this._StartFilesystemWatcher();
		if (this._options.signal)
		{
			this._abort_listener = () => this._RequestStop('aborted', null);
			this._options.signal.addEventListener('abort', this._abort_listener, { once: true });
			if (this._options.signal.aborted) this._RequestStop('aborted', null);
		}

		await this._EmitCatalogChanged(null, this._generation);
		this._Run().catch((error) => this._RequestStop('error', error));
		return this;
	}

	_StartFilesystemWatcher()
	{
		if (this._watcher || this._state !== 'running') return;
		try
		{
			this._watcher = fs.watch(this._options.image_dir, { recursive: true, persistent: false }, () =>
			{
				this._ScheduleCatalogRebuild();
			});
			this._watcher.on('error', (error) =>
			{
				const failed_watcher = this._watcher;
				this._watcher = null;
				if (failed_watcher) failed_watcher.close();
				void this._HandleOperationalError('CATALOG_WATCH_FAILED', error, true, 'catalog');
				this._ScheduleCatalogRebuild();
			});
		}
		catch (error)
		{
			void this._HandleOperationalError('CATALOG_WATCH_FAILED', error, true, 'catalog');
			this._ScheduleCatalogRebuild();
		}
	}

	_ScheduleCatalogRebuild()
	{
		if (this._state !== 'running') return;
		this._rebuild_requested = true;
		if (this._catalog_timer) clearTimeout(this._catalog_timer);
		this._catalog_timer = setTimeout(() =>
		{
			this._catalog_timer = null;
			this._RebuildCatalog().catch(async (error) =>
			{
				await this._HandleOperationalError('CATALOG_REBUILD_FAILED', error, true, 'catalog');
				if (this._state === 'running')
				{
					this._catalog_timer = setTimeout(() =>
					{
						this._catalog_timer = null;
						this._ScheduleCatalogRebuild();
					}, Math.min(5000, 100 * Math.pow(2, Math.max(0, this._consecutive_catalog_errors - 1))));
				}
			});
		}, this._options.catalog_debounce_ms);
	}

	async _RebuildCatalog()
	{
		if (this._rebuild_running || this._state !== 'running') return;
		this._rebuild_running = true;
		this._rebuild_requested = false;
		try
		{
			const root_stat = await fs.promises.lstat(this._options.image_dir);
			if (!root_stat.isDirectory() || root_stat.isSymbolicLink())
			{
				throw new Error('image_dir is no longer an accessible non-symlink directory.');
			}
			const next_generation = await BuildCatalogGeneration({
				options: this._options,
				dependencies: this._dependencies,
				generation_id: this._next_generation_id,
				previous_generation: this._generation
			});
			const next_signature = CatalogSignature(next_generation);
			if (this._state === 'running' && next_signature !== this._generation_signature)
			{
				const previous = this._generation;
				this._generation = next_generation;
				this._generation_signature = next_signature;
				this._next_generation_id += 1;
				this._stats.catalog_rebuilds += 1;
				this._stats.catalog_errors += next_generation.diagnostics.length;
				await this._EmitCatalogChanged(previous, next_generation);
			}
			this._consecutive_catalog_errors = 0;
			this._StartFilesystemWatcher();
		}
		finally
		{
			this._rebuild_running = false;
			if (this._rebuild_requested) this._ScheduleCatalogRebuild();
		}
	}

	async _EmitCatalogChanged(previous, current)
	{
		if (!this._options.on_catalog_changed || this._state !== 'running') return;
		const diff = DiffCatalogs(previous, current);
		await this._Dispatch(this._options.on_catalog_changed, {
			type: 'catalog_changed',
			generation: current.id,
			images: current.images.map(PublicCatalogImage),
			added_paths: diff.added,
			changed_paths: diff.changed,
			deleted_paths: diff.deleted,
			diagnostics: current.diagnostics,
			statistics: this.getStatistics(),
			source: this._PublicSource(this._last_source_context)
		}, true);
	}

	async _Run()
	{
		try
		{
			while (this._state === 'running')
			{
				try
				{
					await this._RunSweep();
				}
				catch (error)
				{
					const terminal_locked_error = this._options.source.type === 'locked_window' &&
						IsTerminalLockedWindowError(error);
					await this._HandleOperationalError(
						terminal_locked_error ? 'LOCKED_WINDOW_UNAVAILABLE' : 'SWEEP_FAILED',
						error,
						!terminal_locked_error,
						'sweep'
					);
					if (this._state === 'running')
					{
						await this._Delay(Math.min(5000, 100 * Math.pow(2, Math.max(0, this._consecutive_sweep_errors - 1))));
					}
				}
			}
		}
		catch (error)
		{
			this._stop_reason = 'error';
			this._fatal_error = error;
			this._state = 'stopping';
		}
		finally
		{
			this._Cleanup();
			this._state = 'stopped';
			const summary = { reason: this._stop_reason || 'stopped', statistics: this.getStatistics() };
			if (this._fatal_error) this._reject_completion(this._fatal_error);
			else this._resolve_completion(summary);
		}
	}

	async _RunSweep()
	{
		const generation = this._generation;
		const started_at = Date.now();
		let source_context = this._PrepareSourceContext();
		this._last_source_context = source_context;
		if (this._options.on_before_sweep)
		{
			await this._Dispatch(this._options.on_before_sweep, {
				type: 'before_sweep',
				generation: generation.id,
				statistics: this.getStatistics(),
				source: this._PublicSource(source_context)
			}, true);
			if (this._state !== 'running') return;
		}

		const source_results = [];
		if (generation.images.length > 0)
		{
			if (source_context.type === 'displays')
			{
				const captures = [];
				for (const display of source_context.displays)
				{
					const capture_started_at = process.hrtime.bigint();
					const bitmap = this._dependencies.capture_display(display.id);
					const capture_ms = Number(process.hrtime.bigint() - capture_started_at) / 1000000;
					this._stats.captures += 1;
					captures.push({
						display: display,
						bitmap: bitmap,
						capture_ms: capture_ms
					});
				}
				for (const capture of captures)
				{
					const result = await generation.matcher.search(
						capture.bitmap,
						this._options.matching.thread_count
					);
					result.metrics.capture_ms = capture.capture_ms;
					source_results.push({
						source_type: 'display',
						display: capture.display,
						result: result
					});
				}
			}
			else
			{
				const capture_started_at = process.hrtime.bigint();
				const capture_context = this._dependencies.capture_locked_window(
					source_context.locked_window,
					source_context.require_active
				);
				const capture_ms = Number(process.hrtime.bigint() - capture_started_at) / 1000000;
				source_context = ValidateLockedWindowContext(
					this._options,
					capture_context,
					source_context.displays
				);
				this._last_source_context = source_context;
				this._stats.captures += 1;
				const result = await generation.matcher.search(
					source_context.bitmap,
					this._options.matching.thread_count
				);
				result.metrics.capture_ms = capture_ms;
				source_results.push({
					source_type: 'locked_window',
					target: source_context.target,
					geometry: source_context.geometry,
					displays: source_context.displays,
					result: result
				});
			}
		}

		const search_finished_at = Date.now();
		const sweep_result = BuildSweepMatches(generation, source_results);
		this._stats.sweeps += 1;
		this._stats.last_sweep_duration_ms = search_finished_at - started_at;
		this._stats.last_sweep_finished_at_ms = search_finished_at;
		AddNativeMetrics(this._stats.native, sweep_result.native_metrics);
		const occurrence_count = sweep_result.matches.reduce(function(total, match) { return total + match.occurrences.length; }, 0);
		const has_matches = sweep_result.matches.length > 0;
		if (has_matches)
		{
			this._stats.match_sweeps += 1;
			this._stats.match_occurrences += occurrence_count;
			this._stats.satisfied_image_sets += sweep_result.sets.length;
		}
		else
		{
			this._stats.no_match_sweeps += 1;
		}

		const signature = SweepResultSignature(sweep_result.matches, sweep_result.sets);
		const should_emit = this._ShouldEmit(signature, has_matches, search_finished_at);
		this._last_result_signature = signature;
		this._last_had_matches = has_matches;
		if (should_emit)
		{
			this._last_emitted_at_ms = search_finished_at;
			if (has_matches)
			{
				await this._Dispatch(this._options.on_matches_found, {
					type: 'matches_found',
					generation: generation.id,
					matches: sweep_result.matches,
					statistics: this.getStatistics(),
					native_metrics: sweep_result.native_metrics,
					source: this._PublicSource(source_context)
				}, false);
				if (sweep_result.sets.length > 0 && this._options.on_image_sets_found && this._state === 'running')
				{
					await this._Dispatch(this._options.on_image_sets_found, {
						type: 'image_sets_found',
						generation: generation.id,
						sets: sweep_result.sets,
						statistics: this.getStatistics(),
						source: this._PublicSource(source_context)
					}, false);
				}
			}
			else if (this._options.on_no_matches_found)
			{
				await this._Dispatch(this._options.on_no_matches_found, {
					type: 'no_matches_found',
					reason: generation.images.length === 0 ? 'empty_catalog' : 'no_match',
					generation: generation.id,
					statistics: this.getStatistics(),
					native_metrics: sweep_result.native_metrics,
					source: this._PublicSource(source_context)
				}, false);
			}
		}

		this._consecutive_sweep_errors = 0;
		if (this._state !== 'running') return;
		const remaining_delay = Math.max(0, this._options.check_period_ms - (Date.now() - search_finished_at));
		await this._Delay(remaining_delay);
	}

	_SelectDisplays()
	{
		const displays = this._dependencies.list_displays();
		if (!Array.isArray(displays) || displays.length === 0)
		{
			throw new ImageCatalogWatcherError({ code: 'DISPLAY_UNAVAILABLE', message: 'No displays are available for image catalog searching.' });
		}
		if (!this._options.source.display_ids) return displays;
		const selected = this._options.source.display_ids.map(function(display_id)
		{
			return displays.find(function(display) { return display.id === display_id; }) || null;
		});
		if (selected.some(function(display) { return display === null; }))
		{
			throw new ImageCatalogWatcherError({ code: 'DISPLAY_NOT_FOUND', message: 'A configured display_id is not available.' });
		}
		return selected;
	}

	_PrepareSourceContext()
	{
		if (this._options.source.type === 'displays')
		{
			return {
				type: 'displays',
				displays: this._SelectDisplays()
			};
		}

		const displays = this._dependencies.list_displays();
		if (!Array.isArray(displays) || displays.length === 0)
		{
			throw new ImageCatalogWatcherError({
				code: 'DISPLAY_UNAVAILABLE',
				message: 'No displays are available for locked-window coordinate mapping.'
			});
		}
		return ValidateLockedWindowContext(
			this._options,
			this._dependencies.inspect_locked_window(
				this._options.source.locked_window,
				this._options.source.require_active
			),
			displays
		);
	}

	_PublicSource(source_context)
	{
		if (source_context.type === 'displays')
		{
			return {
				type: 'displays',
				displays: source_context.displays.map(CloneDisplay)
			};
		}
		return {
			type: 'locked_window',
			locked_window: source_context.locked_window,
			require_active: source_context.require_active,
			target: CloneTarget(source_context.target),
			geometry: CloneGeometry(source_context.geometry)
		};
	}

	_ShouldEmit(signature, has_matches, now_ms)
	{
		switch (this._options.repeat.mode)
		{
			case 'every_sweep': return true;
			case 'changes_only': return signature !== this._last_result_signature;
			case 'transition_only': return has_matches !== this._last_had_matches;
			case 'throttled': return signature !== this._last_result_signature ||
				(now_ms - this._last_emitted_at_ms) >= this._options.repeat.interval_ms;
			default: return false;
		}
	}

	async _Dispatch(callback, event, force_serial)
	{
		if (!callback || this._state !== 'running') return CONTINUE;
		if (force_serial || this._options.callback_mode === 'serial')
		{
			return this._InvokeCallback(callback, event);
		}

		while (this._pending_callbacks.size >= this._options.max_pending_callbacks && this._state === 'running')
		{
			await Promise.race(this._pending_callbacks);
		}
		if (this._state !== 'running') return EXIT;

		let pending;
		pending = this._InvokeCallback(callback, event)
			.catch((error) => this._HandleCallbackFailure(error, event.type))
			.finally(() => this._pending_callbacks.delete(pending));
		this._pending_callbacks.add(pending);
		return CONTINUE;
	}

	async _InvokeCallback(callback, event)
	{
		try
		{
			const result = await callback(event, this._dependencies.robot, this._options.extra);
			if (typeof result !== 'undefined' && result !== CONTINUE && result !== EXIT)
			{
				throw new TypeError('Watcher callbacks may return only CONTINUE, EXIT, or undefined.');
			}
			if (result === EXIT) this._RequestStop('callback_exit', null);
			return result || CONTINUE;
		}
		catch (error)
		{
			await this._HandleCallbackFailure(error, event.type);
			return this._state === 'running' ? CONTINUE : EXIT;
		}
	}

	async _HandleCallbackFailure(error, callback_type)
	{
		this._stats.callback_errors += 1;
		await this._EmitError({
			code: 'CALLBACK_FAILED',
			message: 'Image catalog watcher callback failed: ' + error.message,
			recoverable: this._options.callback_error_policy === 'continue',
			details: { callback_type: callback_type },
			cause: error
		});
		if (this._options.callback_error_policy === 'stop') this._RequestStop('error', error);
	}

	async _HandleOperationalError(code, error, recoverable, domain)
	{
		this._stats.operational_errors += 1;
		if (domain === 'catalog') this._consecutive_catalog_errors += 1;
		else this._consecutive_sweep_errors += 1;
		await this._EmitError({ code: code, message: error.message, recoverable: recoverable, cause: error });
		const consecutive_errors = domain === 'catalog'
			? this._consecutive_catalog_errors
			: this._consecutive_sweep_errors;
		if (!recoverable || consecutive_errors >= this._options.max_consecutive_errors)
		{
			this._RequestStop('error', error);
		}
	}

	async _EmitError(params)
	{
		const watcher_error = params instanceof ImageCatalogWatcherError
			? params
			: new ImageCatalogWatcherError(params);
		if (!this._options.on_error) return;
		try
		{
			const result = await this._options.on_error({
				type: 'error',
				error: watcher_error,
				statistics: this.getStatistics(),
				source: this._PublicSource(this._last_source_context)
			}, this._dependencies.robot, this._options.extra);
			if (result === EXIT) this._RequestStop('callback_exit', null);
		}
		catch (error)
		{
			this._RequestStop('error', error);
		}
	}

	_Delay(ms)
	{
		if (ms <= 0 || this._state !== 'running') return Promise.resolve();
		return new Promise((resolve) =>
		{
			this._delay_resolve = resolve;
			this._delay_timer = setTimeout(() =>
			{
				this._delay_timer = null;
				this._delay_resolve = null;
				resolve();
			}, ms);
		});
	}

	_RequestStop(reason, error)
	{
		if (this._state === 'stopping' || this._state === 'stopped') return;
		this._state = 'stopping';
		this._stop_reason = reason;
		this._fatal_error = error || null;
		if (this._delay_timer)
		{
			clearTimeout(this._delay_timer);
			this._delay_timer = null;
			const resolve = this._delay_resolve;
			this._delay_resolve = null;
			if (resolve) resolve();
		}
	}

	_Cleanup()
	{
		if (this._watcher)
		{
			this._watcher.close();
			this._watcher = null;
		}
		if (this._catalog_timer)
		{
			clearTimeout(this._catalog_timer);
			this._catalog_timer = null;
		}
		if (this._options.signal && this._abort_listener)
		{
			this._options.signal.removeEventListener('abort', this._abort_listener);
			this._abort_listener = null;
		}
	}
}

async function StartImageCatalogWatcher(params, dependencies)
{
	const options = NormalizeOptions(params);
	AssertObject(dependencies, 'Image catalog watcher dependencies are required.');
	const required_dependencies = ['robot', 'load_bitmap', 'create_matcher', 'list_displays', 'get_capabilities'];
	if (options.source.type === 'displays')
	{
		required_dependencies.push('capture_display');
	}
	else
	{
		required_dependencies.push('is_locked_window', 'inspect_locked_window', 'capture_locked_window');
	}
	for (const dependency_name of required_dependencies)
	{
		if (!dependencies[dependency_name] ||
			(dependency_name !== 'robot' && typeof dependencies[dependency_name] !== 'function'))
		{
			throw new TypeError('Missing image catalog watcher dependency: ' + dependency_name);
		}
	}
	if (options.source.type === 'locked_window' &&
		dependencies.is_locked_window(options.source.locked_window) !== true)
	{
		throw new TypeError('source.locked_window must be a RobotTS locked window handle.');
	}

	let root_stat;
	try
	{
		root_stat = await fs.promises.lstat(options.image_dir);
	}
	catch (error)
	{
		throw new ImageCatalogWatcherError({ code: 'IMAGE_DIRECTORY_NOT_FOUND', message: 'image_dir does not exist or cannot be accessed.', cause: error });
	}
	if (!root_stat.isDirectory() || root_stat.isSymbolicLink())
	{
		throw new ImageCatalogWatcherError({ code: 'INVALID_IMAGE_DIRECTORY', message: 'image_dir must be a non-symlink directory.' });
	}

	const capabilities = dependencies.get_capabilities();
	if (!capabilities || capabilities.supportsScreenCapture !== true)
	{
		throw new ImageCatalogWatcherError({ code: 'SCREEN_CAPTURE_UNAVAILABLE', message: 'The current Linux desktop backend does not support screen capture.' });
	}
	const displays = dependencies.list_displays();
	if (!Array.isArray(displays) || displays.length === 0)
	{
		throw new ImageCatalogWatcherError({ code: 'DISPLAY_UNAVAILABLE', message: 'No displays are available for image catalog searching.' });
	}

	const generation = await BuildCatalogGeneration({ options: options, dependencies: dependencies, generation_id: 1 });
	const session = new ImageCatalogWatcherSession(options, dependencies, generation);
	return session.Start();
}

module.exports = {
	CONTINUE: CONTINUE,
	EXIT: EXIT,
	ImageCatalogWatcherError: ImageCatalogWatcherError,
	StartImageCatalogWatcher: StartImageCatalogWatcher,
	_testing: {
		BuildCatalogGeneration: BuildCatalogGeneration,
		BuildSweepMatches: BuildSweepMatches,
		HashBitmap: HashBitmap,
		NormalizeOptions: NormalizeOptions,
		ResolveImageSets: ResolveImageSets
	}
};
