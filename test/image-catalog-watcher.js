'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const native = require('../build/Release/robotjs.node');
const watcher_module = require('../lib/image_catalog_watcher.js');

function CreateBitmap(width, height, pixel_at)
{
	const byte_width = 4 + (((width * 3) - 1) & ~3);
	const image = Buffer.alloc(byte_width * height);
	for (let y = 0; y < height; y += 1)
	{
		for (let x = 0; x < width; x += 1)
		{
			const pixel = pixel_at(x, y);
			const offset = (y * byte_width) + (x * 3);
			image[offset] = pixel[2];
			image[offset + 1] = pixel[1];
			image[offset + 2] = pixel[0];
		}
	}
	return {
		width: width,
		height: height,
		byteWidth: byte_width,
		bitsPerPixel: 24,
		bytesPerPixel: 3,
		image: image,
		colorAt: function() { return '000000'; }
	};
}

function SolidBitmap(red, green, blue)
{
	return CreateBitmap(1, 1, function() { return [red, green, blue]; });
}

function CreateTempCatalog()
{
	return fs.mkdtempSync(path.join(os.tmpdir(), 'robotts-watcher-test-'));
}

function WriteCatalogFile(root, relative_path, data)
{
	const absolute_path = path.join(root, relative_path);
	fs.mkdirSync(path.dirname(absolute_path), { recursive: true });
	fs.writeFileSync(absolute_path, data || relative_path);
	return absolute_path;
}

function CreateDependencies(params)
{
	const settings = params || {};
	const dependencies = {
		robot: {},
		load_bitmap: settings.load_bitmap || function(png_path)
		{
			return settings.bitmaps[path.basename(png_path)] || SolidBitmap(1, 1, 1);
		},
		create_matcher: settings.create_matcher || function(bitmaps)
		{
			return {
				search: async function()
				{
					return {
						images: bitmaps.map(function(_, index) { return { image_index: index, occurrences: [] }; }),
						metrics: {
							catalog_images: bitmaps.length,
							fingerprint_entries: bitmaps.length,
							haystack_pixels_scanned: 1,
							index_buckets_visited: 1,
							candidate_offsets_generated: 0,
							candidate_offsets_verified: 0,
							verification_pixels_compared: 0,
							elapsed_ms: 0
						}
					};
				}
			};
		},
		list_displays: settings.list_displays || function()
		{
			return [{ id: 1, name: 'Synthetic', x: 10, y: 20, width: 100, height: 100, isPrimary: true }];
		},
		capture_display: settings.capture_display || function() { return SolidBitmap(0, 0, 0); },
		get_capabilities: function() { return { supportsScreenCapture: true }; }
	};
	if (settings.is_locked_window) dependencies.is_locked_window = settings.is_locked_window;
	if (settings.inspect_locked_window) dependencies.inspect_locked_window = settings.inspect_locked_window;
	if (settings.capture_locked_window) dependencies.capture_locked_window = settings.capture_locked_window;
	return dependencies;
}

function CreateLockedWindow()
{
	return {
		getTarget: function() { return { targetType: 'window', windowId: '42' }; },
		assert: function() { return this.getTarget(); },
		capture: function() { return SolidBitmap(0, 0, 0); }
	};
}

function LockedTarget(display_id)
{
	return {
		targetType: 'window',
		windowId: '42',
		title: 'Synthetic Window',
		className: 'Synthetic',
		instanceName: 'synthetic',
		pid: 1234,
		workspaceId: 0,
		displayId: display_id
	};
}

describe('Image Catalog Matcher', function()
{
	it('searches one haystack traversal for multiple exact catalog images.', async function()
	{
		const red = SolidBitmap(255, 0, 0);
		const green = SolidBitmap(0, 255, 0);
		const haystack = CreateBitmap(4, 2, function(x, y)
		{
			if (x === 1 && y === 0) return [255, 0, 0];
			if (x === 3 && y === 1) return [0, 255, 0];
			return [0, 0, 0];
		});
		const matcher = new native.BitmapCatalogMatcher([red, green], {
			mode: 'exact',
			max_results_per_image: 10
		});
		const result = await matcher.search(haystack);

		expect(result.images[0].occurrences.map(function(item) { return [item.x, item.y]; })).toEqual([[1, 0]]);
		expect(result.images[1].occurrences.map(function(item) { return [item.x, item.y]; })).toEqual([[3, 1]]);
		expect(result.metrics.catalog_images).toEqual(2);
		expect(result.metrics.haystack_pixels_scanned).toEqual(8);
	});

	it('finds fuzzy catalog occurrences through the shared candidate index.', async function()
	{
		const reference = CreateBitmap(2, 1, function(x) { return x === 0 ? [200, 10, 10] : [10, 200, 10]; });
		const haystack = CreateBitmap(3, 1, function(x)
		{
			if (x === 1) return [210, 20, 20];
			if (x === 2) return [20, 210, 20];
			return [0, 0, 0];
		});
		const matcher = new native.BitmapCatalogMatcher([reference], {
			mode: 'fuzzy', threshold: 0.8, tolerance: 0.2,
			candidate_step: 1, max_results_per_image: 10
		});
		const result = await matcher.search(haystack);

		expect(result.images[0].occurrences.length).toEqual(1);
		expect(result.images[0].occurrences[0].x).toEqual(1);
		expect(result.images[0].occurrences[0].score).toBeGreaterThan(0.8);
		expect(result.metrics.haystack_pixels_scanned).toEqual(3);
	});

	it('returns deterministic fuzzy catalog results across thread counts.', async function()
	{
		const reference = CreateBitmap(8, 8, function(x, y)
		{
			return [(x * 31 + y * 7) % 256, (x * 13 + y * 29) % 256, (x * 19 + y * 23) % 256];
		});
		const haystack = CreateBitmap(320, 240, function(x, y)
		{
			if (x >= 211 && x < 219 && y >= 140 && y < 148)
			{
				return [
					((x - 211) * 31 + (y - 140) * 7) % 256,
					((x - 211) * 13 + (y - 140) * 29) % 256,
					((x - 211) * 19 + (y - 140) * 23) % 256
				];
			}
			return [(x * 17 + y * 3) % 256, (x * 5 + y * 11) % 256, (x * 7 + y * 13) % 256];
		});
		const matcher = new native.BitmapCatalogMatcher([reference], {
			mode: 'fuzzy',
			threshold: 0.99,
			tolerance: 0.01,
			candidate_step: 1,
			max_results_per_image: 10
		});
		const single = await matcher.search(haystack, 1);
		const parallel = await matcher.search(haystack, 4);

		expect(parallel.images).toEqual(single.images);
		expect(single.metrics.effective_thread_count).toEqual(1);
		expect(parallel.metrics.effective_thread_count).toEqual(4);
		expect(parallel.metrics.haystack_pixels_scanned)
			.toEqual(single.metrics.haystack_pixels_scanned);
		expect(parallel.metrics.candidate_offsets_generated)
			.toEqual(single.metrics.candidate_offsets_generated);
	});

	it('preserves fuzzy results across a threshold, tolerance, partial, and sampling matrix.', async function()
	{
		const reference = CreateBitmap(7, 6, function(x, y)
		{
			return [(x * 37 + y * 17) % 256, (x * 23 + y * 41) % 256, (x * 53 + y * 11) % 256];
		});
		const haystack = CreateBitmap(260, 260, function(x, y)
		{
			if (x >= 153 && x < 160 && y >= 117 && y < 123)
			{
				const local_x = x - 153;
				const local_y = y - 117;
				return [
					(local_x * 37 + local_y * 17 + ((x + y) % 3)) % 256,
					(local_x * 23 + local_y * 41 + ((x + y) % 2)) % 256,
					(local_x * 53 + local_y * 11) % 256
				];
			}
			return [
				(x * 29 + y * 31 + 7) % 256,
				(x * 43 + y * 19 + 13) % 256,
				(x * 17 + y * 47 + 23) % 256
			];
		});
		const option_matrix = [
			{ threshold: 0.8, tolerance: 0.2, allow_partial_match: false, candidate_step: 1 },
			{ threshold: 0.95, tolerance: 0.05, allow_partial_match: false, candidate_step: 2 },
			{ threshold: 0.8, tolerance: 0.2, allow_partial_match: true, candidate_step: 1 },
			{ threshold: 0.95, tolerance: 0.05, allow_partial_match: true, candidate_step: 2 }
		];

		for (const options of option_matrix)
		{
			const matcher = new native.BitmapCatalogMatcher([reference], Object.assign({
				mode: 'fuzzy',
				minimum_overlap_ratio: 0.6,
				max_results_per_image: 20,
				max_candidates_per_image: 100000
			}, options));
			const single = await matcher.search(haystack, 1);
			const parallel = await matcher.search(haystack, 4);
			expect(parallel.images).toEqual(single.images);
			expect(parallel.metrics.candidate_offsets_generated)
				.toEqual(single.metrics.candidate_offsets_generated);
			expect(parallel.metrics.candidate_offsets_verified)
				.toEqual(single.metrics.candidate_offsets_verified);
		}
	});

	it('supports concurrent searches on one immutable catalog matcher.', async function()
	{
		const reference = CreateBitmap(4, 4, function(x, y)
		{
			return [(x * 61 + y) % 256, (x + y * 59) % 256, (x * 17 + y * 23) % 256];
		});
		const haystack = CreateBitmap(300, 240, function(x, y)
		{
			if (x >= 125 && x < 129 && y >= 90 && y < 94)
			{
				return [
					((x - 125) * 61 + (y - 90)) % 256,
					((x - 125) + (y - 90) * 59) % 256,
					((x - 125) * 17 + (y - 90) * 23) % 256
				];
			}
			return [(x + y) % 256, (x * 3 + y * 5) % 256, (x * 7 + y * 11) % 256];
		});
		const matcher = new native.BitmapCatalogMatcher([reference], {
			mode: 'fuzzy',
			threshold: 0.99,
			tolerance: 0.01
		});
		const results = await Promise.all([
			matcher.search(haystack, 4),
			matcher.search(haystack, 4),
			matcher.search(haystack, 4)
		]);

		expect(results[1].images).toEqual(results[0].images);
		expect(results[2].images).toEqual(results[0].images);
		expect(results[0].images[0].occurrences.length).toEqual(1);
	});

	it('validates native catalog thread counts.', async function()
	{
		const matcher = new native.BitmapCatalogMatcher([SolidBitmap(1, 2, 3)], {
			mode: 'fuzzy'
		});
		for (const thread_count of [0, 1.5, 65])
		{
			let error = null;
			try
			{
				await matcher.search(SolidBitmap(1, 2, 3), thread_count);
			}
			catch (caught_error)
			{
				error = caught_error;
			}
			expect(error).not.toBeNull();
			expect(error.message).toMatch(/thread count/);
		}
	});

	it('filters incidental fuzzy pixel hits before applying the candidate limit.', async function()
	{
		const reference = CreateBitmap(20, 10, function(x, y)
		{
			const index = (y * 20) + x;
			if (index < 60) return [0, 0, 0];
			const unique_index = index - 60;
			return [
				128 + (unique_index % 128),
				128 + ((unique_index * 7) % 128),
				128 + ((unique_index * 13) % 128)
			];
		});
		const haystack = CreateBitmap(100, 60, function() { return [0, 0, 0]; });
		const matcher = new native.BitmapCatalogMatcher([reference], {
			mode: 'fuzzy',
			threshold: 0.9,
			tolerance: 0.1,
			candidate_step: 1,
			max_results_per_image: 10,
			max_candidates_per_image: 10
		});
		const result = await matcher.search(haystack);

		expect(result.images[0].occurrences.length).toEqual(0);
		expect(result.metrics.fingerprint_entries).toBeLessThan(reference.width * reference.height);
		expect(result.metrics.candidate_offsets_generated).toEqual(0);
	});

	it('does not treat clustered antialiasing shades as independent rare evidence.', async function()
	{
		function ReferencePixel(x, y)
		{
			const index = (y * 40) + x;
			if (index < 200) return [0, 0, 0];
			if (index < 272)
			{
				const shade = index - 200;
				return [
					shade % 20,
					Math.floor(shade / 20),
					(shade * 3) % 20
				];
			}
			return [200, 20, 20];
		}
		const reference = CreateBitmap(40, 10, ReferencePixel);
		const haystack = CreateBitmap(100, 60, function() { return [0, 0, 0]; });
		const matcher = new native.BitmapCatalogMatcher([reference], {
			mode: 'fuzzy',
			threshold: 0.9,
			tolerance: 0.1,
			candidate_step: 1,
			max_results_per_image: 10,
			max_candidates_per_image: 10
		});
		const result = await matcher.search(haystack);

		expect(result.images[0].occurrences.length).toEqual(0);
		expect(result.metrics.candidate_offsets_generated).toEqual(0);

		const matched_haystack = CreateBitmap(100, 60, function(x, y)
		{
			if (x >= 25 && x < 65 && y >= 20 && y < 30)
			{
				return ReferencePixel(x - 25, y - 20);
			}
			return [20, 180, 20];
		});
		const matched_matcher = new native.BitmapCatalogMatcher([reference], {
			mode: 'fuzzy',
			threshold: 0.9,
			tolerance: 0.1,
			candidate_step: 1,
			max_results_per_image: 10,
			max_candidates_per_image: 10000
		});
		const matched_result = await matched_matcher.search(matched_haystack);

		expect(matched_result.images[0].occurrences.some(function(occurrence)
		{
			return occurrence.x === 25 && occurrence.y === 20 &&
				occurrence.score === 1;
		})).toBeTruthy();
	});

	it('still enforces the candidate limit after fuzzy evidence qualification.', async function()
	{
		const reference = CreateBitmap(4, 4, function() { return [0, 0, 0]; });
		const haystack = CreateBitmap(20, 20, function() { return [0, 0, 0]; });
		const matcher = new native.BitmapCatalogMatcher([reference], {
			mode: 'fuzzy',
			threshold: 0.9,
			tolerance: 0.1,
			candidate_step: 1,
			max_results_per_image: 10,
			max_candidates_per_image: 10
		});
		let error = null;
		try
		{
			await matcher.search(haystack);
		}
		catch (caught_error)
		{
			error = caught_error;
		}

		expect(error).not.toBeNull();
		expect(error.message).toMatch(/candidate limit exceeded/);
	});

	it('supports configured partial fuzzy matches.', async function()
	{
		const reference = CreateBitmap(2, 1, function(x)
		{
			return x === 0 ? [10, 10, 200] : [20, 220, 20];
		});
		const haystack = SolidBitmap(20, 220, 20);
		const matcher = new native.BitmapCatalogMatcher([reference], {
			mode: 'fuzzy', threshold: 0.9, tolerance: 0.15,
			allow_partial_match: true, minimum_overlap_ratio: 0.5
		});
		const result = await matcher.search(haystack);

		expect(result.images[0].occurrences.length).toEqual(1);
		expect(result.images[0].occurrences[0].overlap_ratio).toEqual(0.5);
		expect(result.images[0].occurrences[0].width).toEqual(1);
	});

	it('preserves exhaustive threshold-zero fuzzy semantics.', async function()
	{
		const reference = SolidBitmap(255, 255, 255);
		const haystack = CreateBitmap(2, 2, function() { return [0, 0, 0]; });
		const matcher = new native.BitmapCatalogMatcher([reference], {
			mode: 'fuzzy',
			threshold: 0,
			tolerance: 0,
			max_results_per_image: 10,
			max_candidates_per_image: 10
		});
		const result = await matcher.search(haystack, 4);

		expect(result.images[0].occurrences.map(function(item) { return [item.x, item.y]; }))
			.toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
		expect(result.images[0].occurrences.every(function(item) { return item.score === 0; }))
			.toBeTruthy();
	});

	it('rejects bitmap buffers that do not match their declared dimensions.', function()
	{
		const malformed = Object.assign({}, SolidBitmap(255, 0, 0), { image: Buffer.alloc(1) });
		expect(function()
		{
			return new native.BitmapCatalogMatcher([malformed], { mode: 'exact' });
		}).toThrowError(/shorter than its declared dimensions/);
	});
});

describe('Image Catalog Watcher', function()
{
	const temp_dirs = [];
	afterEach(async function()
	{
		for (const temp_dir of temp_dirs.splice(0))
		{
			fs.rmSync(temp_dir, { recursive: true, force: true });
		}
	});

	it('recursively discovers PNGs, deduplicates pixels, and resolves shared set members.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		WriteCatalogFile(root, 'first.png');
		WriteCatalogFile(root, 'nested/duplicate.png');
		WriteCatalogFile(root, 'nested/other.png');
		const generation = await watcher_module._testing.BuildCatalogGeneration({
			options: watcher_module._testing.NormalizeOptions({
				image_dir: root,
				image_sets: [{ name: 'complete', members: ['first.png', 'nested/other.png'] }],
				on_matches_found: function() {}
			}),
			dependencies: CreateDependencies({
				bitmaps: {
					'first.png': SolidBitmap(255, 0, 0),
					'duplicate.png': SolidBitmap(255, 0, 0),
					'other.png': SolidBitmap(0, 255, 0)
				}
			}),
			generation_id: 1
		});

		expect(generation.images.length).toEqual(2);
		expect(generation.images.some(function(image) { return image.aliases.length === 2; })).toBeTruthy();
		expect(generation.resolved_sets[0].valid).toBeTruthy();
		expect(generation.resolved_sets[0].images.length).toEqual(2);
	});

	it('retains the last valid image while a replacement PNG is malformed.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		const png_path = WriteCatalogFile(root, 'changing.png', 'valid');
		let malformed = false;
		const dependencies = CreateDependencies({
			load_bitmap: function()
			{
				if (malformed) throw new Error('partial PNG write');
				return SolidBitmap(10, 20, 30);
			}
		});
		const options = watcher_module._testing.NormalizeOptions({
			image_dir: root,
			on_matches_found: function() {}
		});
		const first = await watcher_module._testing.BuildCatalogGeneration({
			options: options, dependencies: dependencies, generation_id: 1
		});
		malformed = true;
		fs.writeFileSync(png_path, 'partial');
		const second = await watcher_module._testing.BuildCatalogGeneration({
			options: options, dependencies: dependencies, generation_id: 2,
			previous_generation: first
		});

		expect(second.images.length).toEqual(1);
		expect(second.images[0].content_id).toEqual(first.images[0].content_id);
		expect(second.images[0].aliases[0].file_sha256).toEqual(first.images[0].aliases[0].file_sha256);
		expect(second.diagnostics.some(function(item) { return item.code === 'PNG_LOAD_FAILED'; })).toBeTruthy();
		expect(Object.isFrozen(first)).toBeTruthy();
		expect(Object.isFrozen(second)).toBeTruthy();
		expect(first.diagnostics.length).toEqual(0);
	});

	it('captures each display once and reuses matches for overlapping image sets.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		WriteCatalogFile(root, 'red.png');
		WriteCatalogFile(root, 'green.png');
		let capture_count = 0;
		let search_count = 0;
		let found_event = null;
		let set_event = null;
		let catalog_event = null;
		const dependencies = CreateDependencies({
			bitmaps: { 'red.png': SolidBitmap(255, 0, 0), 'green.png': SolidBitmap(0, 255, 0) },
			list_displays: function()
			{
				return [
					{ id: 1, name: 'Left', x: -100, y: 0, width: 100, height: 100, isPrimary: false },
					{ id: 2, name: 'Right', x: 0, y: 0, width: 100, height: 100, isPrimary: true }
				];
			},
			capture_display: function() { capture_count += 1; return SolidBitmap(0, 0, 0); },
			create_matcher: function(bitmaps)
			{
				return { search: async function()
				{
					search_count += 1;
					return {
						images: bitmaps.map(function(_, index)
						{
							return { image_index: index, occurrences: [{ x: index + 2, y: 3, width: 1, height: 1, score: 1, overlap_ratio: 1 }] };
						}),
						metrics: Object.assign(EmptyMetrics(), { catalog_images: bitmaps.length, haystack_pixels_scanned: 10000 })
					};
				} };
			}
		});
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			check_period_ms: 10,
			image_sets: [
				{ name: 'both', members: ['red.png', 'green.png'] },
				{ name: 'red-only', members: ['red.png'] },
				{ name: 'partial', members: ['red.png', 'absent.png'] }
			],
			on_matches_found: function(event) { found_event = event; },
			on_image_sets_found: function(event) { set_event = event; return 'EXIT'; },
			on_catalog_changed: function(event) { catalog_event = event; }
		}, dependencies);
		await session.completion;

		expect(capture_count).toEqual(2);
		expect(search_count).toEqual(2);
		expect(found_event.matches.length).toEqual(2);
		expect(found_event.matches[0].occurrences.length).toEqual(2);
		expect(set_event.sets.map(function(item) { return item.name; })).toEqual(['both', 'red-only']);
		expect(found_event.matches[0].occurrences[0].global_position.x).toEqual(-98);
		expect(found_event.matches[0].occurrences[0].source_type).toEqual('display');
		expect(found_event.source.type).toEqual('displays');
		expect(found_event.source.displays.map(function(display) { return display.id; })).toEqual([1, 2]);
		expect(found_event.source.locked_window).toBeUndefined();
		expect(catalog_event.diagnostics.some(function(item) { return item.code === 'IMAGE_SET_MEMBER_MISSING'; })).toBeTruthy();
	});

	it('applies one thread budget sequentially across all displays in a sweep.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		WriteCatalogFile(root, 'match.png');
		const thread_counts = [];
		let active_searches = 0;
		let maximum_active_searches = 0;
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			matching: { mode: 'fuzzy', thread_count: 4 },
			on_matches_found: function() {},
			on_no_matches_found: function() { return 'EXIT'; }
		}, CreateDependencies({
			bitmaps: { 'match.png': SolidBitmap(1, 2, 3) },
			list_displays: function()
			{
				return [
					{ id: 1, name: 'One', x: 0, y: 0, width: 10, height: 10, isPrimary: true },
					{ id: 2, name: 'Two', x: 10, y: 0, width: 10, height: 10, isPrimary: false }
				];
			},
			create_matcher: function()
			{
				return { search: async function(_bitmap, thread_count)
				{
					thread_counts.push(thread_count);
					active_searches += 1;
					maximum_active_searches = Math.max(maximum_active_searches, active_searches);
					await new Promise(function(resolve) { setTimeout(resolve, 2); });
					active_searches -= 1;
					return {
						images: [{ image_index: 0, occurrences: [] }],
						metrics: EmptyMetrics()
					};
				} };
			}
		}));
		await session.completion;

		expect(thread_counts).toEqual([4, 4]);
		expect(maximum_active_searches).toEqual(1);
	});

	it('captures a locked window once and reports source, window, display, and global coordinates.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		WriteCatalogFile(root, 'match.png');
		WriteCatalogFile(root, 'duplicate.png');
		WriteCatalogFile(root, 'other.png');
		const locked_window = CreateLockedWindow();
		let display_capture_count = 0;
		let locked_capture_count = 0;
		let inspect_count = 0;
		let catalog_event = null;
		let before_event = null;
		let found_event = null;
		let set_event = null;
		const geometry = { x: 150, y: 240, width: 80, height: 60 };
		const dependencies = CreateDependencies({
			bitmaps: {
				'match.png': SolidBitmap(1, 2, 3),
				'duplicate.png': SolidBitmap(1, 2, 3),
				'other.png': SolidBitmap(4, 5, 6)
			},
			list_displays: function()
			{
				return [{ id: 7, name: 'Synthetic', x: 100, y: 200, width: 500, height: 400, isPrimary: true }];
			},
			capture_display: function()
			{
				display_capture_count += 1;
				return SolidBitmap(0, 0, 0);
			},
			is_locked_window: function(value) { return value === locked_window; },
			inspect_locked_window: function(value, require_active)
			{
				expect(value).toBe(locked_window);
				expect(require_active).toBeTruthy();
				inspect_count += 1;
				return { target: LockedTarget(7), geometry: geometry };
			},
			capture_locked_window: function(value, require_active)
			{
				expect(value).toBe(locked_window);
				expect(require_active).toBeTruthy();
				locked_capture_count += 1;
				return { target: LockedTarget(7), geometry: geometry, bitmap: SolidBitmap(0, 0, 0) };
			},
			create_matcher: function(bitmaps, matching)
			{
				expect(bitmaps.length).toEqual(2);
				expect(matching.mode).toEqual('fuzzy');
				return { search: async function()
				{
					return {
						images: bitmaps.map(function(_, image_index)
						{
							return {
								image_index: image_index,
								occurrences: [{ x: 7, y: 9, width: 1, height: 1, score: 0.99, overlap_ratio: 1 }]
							};
						}),
						metrics: EmptyMetrics()
					};
				} };
			}
		});
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			source: {
				type: 'locked_window',
				locked_window: locked_window,
				require_active: true
			},
			matching: { mode: 'fuzzy', threshold: 0.9, tolerance: 0.1 },
			image_sets: [{ name: 'complete', members: ['match.png', 'other.png'] }],
			on_catalog_changed: function(event) { catalog_event = event; },
			on_before_sweep: function(event) { before_event = event; },
			on_matches_found: function(event) { found_event = event; },
			on_image_sets_found: function(event)
			{
				set_event = event;
				return 'EXIT';
			}
		}, dependencies);
		await session.completion;

		expect(inspect_count).toEqual(2);
		expect(locked_capture_count).toEqual(1);
		expect(display_capture_count).toEqual(0);
		for (const event of [catalog_event, before_event, found_event, set_event])
		{
			expect(event.source.type).toEqual('locked_window');
			expect(event.source.locked_window).toBe(locked_window);
			expect(event.source.target.windowId).toEqual('42');
			expect(event.source.geometry).toEqual(geometry);
		}
		const occurrence = found_event.matches[0].occurrences[0];
		expect(catalog_event.images.length).toEqual(2);
		expect(catalog_event.images.some(function(image) { return image.aliases.length === 2; })).toBeTruthy();
		expect(found_event.matches.length).toEqual(2);
		expect(set_event.sets.map(function(item) { return item.name; })).toEqual(['complete']);
		expect(occurrence.source_type).toEqual('locked_window');
		expect(occurrence.window_position).toEqual({ x: 7, y: 9 });
		expect(occurrence.display_position).toEqual({ x: 57, y: 49 });
		expect(occurrence.global_position).toEqual({ x: 157, y: 249 });
		expect(occurrence.display.id).toEqual(7);
	});

	it('recomputes locked-window match coordinates from each capture geometry.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		WriteCatalogFile(root, 'match.png');
		const locked_window = CreateLockedWindow();
		let capture_count = 0;
		const global_positions = [];
		const dependencies = CreateDependencies({
			bitmaps: { 'match.png': SolidBitmap(1, 2, 3) },
			list_displays: function()
			{
				return [{ id: 1, name: 'Synthetic', x: 0, y: 0, width: 1000, height: 800, isPrimary: true }];
			},
			is_locked_window: function(value) { return value === locked_window; },
			inspect_locked_window: function()
			{
				return { target: LockedTarget(1), geometry: { x: 100, y: 80, width: 100, height: 100 } };
			},
			capture_locked_window: function()
			{
				capture_count += 1;
				return {
					target: LockedTarget(1),
					geometry: { x: capture_count === 1 ? 100 : 130, y: 80, width: 100, height: 100 },
					bitmap: SolidBitmap(0, 0, 0)
				};
			},
			create_matcher: function()
			{
				return { search: async function()
				{
					return {
						images: [{
							image_index: 0,
							occurrences: [{ x: 5, y: 6, width: 1, height: 1, score: 1, overlap_ratio: 1 }]
						}],
						metrics: EmptyMetrics()
					};
				} };
			}
		});
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			check_period_ms: 1,
			repeat: { mode: 'every_sweep' },
			source: { type: 'locked_window', locked_window: locked_window },
			on_matches_found: function(event)
			{
				global_positions.push(event.matches[0].occurrences[0].global_position);
				if (global_positions.length === 2) return 'EXIT';
			}
		}, dependencies);
		await session.completion;

		expect(capture_count).toEqual(2);
		expect(global_positions).toEqual([{ x: 105, y: 86 }, { x: 135, y: 86 }]);
	});

	it('revalidates an empty locked-window catalog without taking a capture.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		const locked_window = CreateLockedWindow();
		let inspect_count = 0;
		let capture_count = 0;
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			source: { type: 'locked_window', locked_window: locked_window },
			on_matches_found: function() {},
			on_no_matches_found: function(event)
			{
				expect(event.source.locked_window).toBe(locked_window);
				return 'EXIT';
			}
		}, CreateDependencies({
			is_locked_window: function(value) { return value === locked_window; },
			inspect_locked_window: function()
			{
				inspect_count += 1;
				return { target: LockedTarget(1), geometry: { x: 10, y: 20, width: 100, height: 100 } };
			},
			capture_locked_window: function()
			{
				capture_count += 1;
				throw new Error('empty catalogs must not capture');
			}
		}));
		await session.completion;

		expect(inspect_count).toEqual(2);
		expect(capture_count).toEqual(0);
	});

	it('reports no match only after searching the locked window against the active catalog.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		WriteCatalogFile(root, 'missing.png');
		const locked_window = CreateLockedWindow();
		let capture_count = 0;
		let no_match_event = null;
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			source: { type: 'locked_window', locked_window: locked_window },
			on_matches_found: function() {},
			on_no_matches_found: function(event)
			{
				no_match_event = event;
				return 'EXIT';
			}
		}, CreateDependencies({
			bitmaps: { 'missing.png': SolidBitmap(1, 2, 3) },
			is_locked_window: function(value) { return value === locked_window; },
			inspect_locked_window: function()
			{
				return { target: LockedTarget(1), geometry: { x: 10, y: 20, width: 100, height: 100 } };
			},
			capture_locked_window: function()
			{
				capture_count += 1;
				return {
					target: LockedTarget(1),
					geometry: { x: 10, y: 20, width: 100, height: 100 },
					bitmap: SolidBitmap(0, 0, 0)
				};
			}
		}));
		await session.completion;

		expect(capture_count).toEqual(1);
		expect(no_match_event.reason).toEqual('no_match');
		expect(no_match_event.source.locked_window).toBe(locked_window);
	});

	it('fails closed when a locked window disappears during a later sweep.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		WriteCatalogFile(root, 'match.png');
		const locked_window = CreateLockedWindow();
		let inspect_count = 0;
		let error_event = null;
		const missing_error = new Error('The locked window no longer exists.');
		missing_error.code = 'WINDOW_NOT_FOUND';
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			source: { type: 'locked_window', locked_window: locked_window },
			on_matches_found: function() {},
			on_error: function(event) { error_event = event; }
		}, CreateDependencies({
			bitmaps: { 'match.png': SolidBitmap(1, 2, 3) },
			is_locked_window: function(value) { return value === locked_window; },
			inspect_locked_window: function()
			{
				inspect_count += 1;
				if (inspect_count > 1) throw missing_error;
				return { target: LockedTarget(1), geometry: { x: 10, y: 20, width: 100, height: 100 } };
			},
			capture_locked_window: function()
			{
				throw new Error('capture should not run after verification fails');
			}
		}));
		let completion_error = null;
		try { await session.completion; } catch (error) { completion_error = error; }

		expect(completion_error).toBe(missing_error);
		expect(error_event.error.code).toEqual('LOCKED_WINDOW_UNAVAILABLE');
		expect(error_event.error.recoverable).toBeFalsy();
		expect(error_event.source.locked_window).toBe(locked_window);
		expect(inspect_count).toEqual(2);
	});

	it('rejects ambiguous source options and non-RobotTS locked-window handles.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		const locked_window = CreateLockedWindow();
		expect(function()
		{
			watcher_module._testing.NormalizeOptions({
				image_dir: root,
				display_ids: [1],
				source: { type: 'displays', display_ids: [1] },
				on_matches_found: function() {}
			});
		}).toThrowError(/cannot be combined/);
		expect(function()
		{
			watcher_module._testing.NormalizeOptions({
				image_dir: root,
				source: { type: 'locked_window', locked_window: locked_window, unsupported: true },
				on_matches_found: function() {}
			});
		}).toThrowError(/unsupported option/);

		let error = null;
		try
		{
			await watcher_module.StartImageCatalogWatcher({
				image_dir: root,
				source: { type: 'locked_window', locked_window: locked_window },
				on_matches_found: function() {}
			}, CreateDependencies({
				is_locked_window: function() { return false; },
				inspect_locked_window: function() {},
				capture_locked_window: function() {}
			}));
		}
		catch (caught_error)
		{
			error = caught_error;
		}
		expect(error).not.toBeNull();
		expect(error.message).toMatch(/RobotTS locked window handle/);
	});

	it('distinguishes an empty catalog without capturing displays.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		let capture_count = 0;
		let no_match_event = null;
		const dependencies = CreateDependencies({
			capture_display: function() { capture_count += 1; return SolidBitmap(0, 0, 0); }
		});
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			on_matches_found: function() {},
			on_no_matches_found: function(event) { no_match_event = event; return 'EXIT'; }
		}, dependencies);
		const summary = await session.completion;

		expect(summary.reason).toEqual('callback_exit');
		expect(no_match_event.reason).toEqual('empty_catalog');
		expect(capture_count).toEqual(0);
	});

	it('emits unchanged no-match results only once by default.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		WriteCatalogFile(root, 'missing.png');
		let before_count = 0;
		let no_match_count = 0;
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			check_period_ms: 1,
			on_matches_found: function() {},
			on_no_matches_found: function() { no_match_count += 1; },
			on_before_sweep: function()
			{
				before_count += 1;
				if (before_count === 3) return 'EXIT';
			}
		}, CreateDependencies({ bitmaps: { 'missing.png': SolidBitmap(1, 2, 3) } }));
		await session.completion;
		expect(no_match_count).toEqual(1);
	});

	it('implements every-sweep, transition-only, and throttled repeat policies.', async function()
	{
		async function CountEvents(repeat)
		{
			const root = CreateTempCatalog();
			temp_dirs.push(root);
			WriteCatalogFile(root, 'missing.png');
			let before_count = 0;
			let event_count = 0;
			const session = await watcher_module.StartImageCatalogWatcher({
				image_dir: root,
				check_period_ms: 5,
				repeat: repeat,
				on_matches_found: function() {},
				on_no_matches_found: function() { event_count += 1; },
				on_before_sweep: function()
				{
					before_count += 1;
					if (before_count === 4) return 'EXIT';
				}
			}, CreateDependencies({ bitmaps: { 'missing.png': SolidBitmap(1, 2, 3) } }));
			await session.completion;
			return event_count;
		}

		expect(await CountEvents({ mode: 'every_sweep' })).toEqual(3);
		expect(await CountEvents({ mode: 'transition_only' })).toEqual(1);
		expect(await CountEvents({ mode: 'throttled', interval_ms: 1 })).toEqual(3);
	});

	it('reports recursive catalog additions, changes, and deletions without restarting.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		WriteCatalogFile(root, 'changed.png', 'before');
		WriteCatalogFile(root, 'deleted.png', 'delete');
		let catalog_event_count = 0;
		let update_event = null;
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			check_period_ms: 10,
			catalog_debounce_ms: 10,
			on_matches_found: function() {},
			on_catalog_changed: function(event)
			{
				catalog_event_count += 1;
				if (catalog_event_count === 1)
				{
					fs.writeFileSync(path.join(root, 'changed.png'), 'after');
					fs.rmSync(path.join(root, 'deleted.png'));
					WriteCatalogFile(root, 'nested/added.png', 'added');
					return;
				}
				update_event = event;
				return 'EXIT';
			}
		}, CreateDependencies({
			load_bitmap: function(png_path)
			{
				const value = fs.readFileSync(png_path, 'utf8');
				return SolidBitmap(value.charCodeAt(0), value.length, 1);
			}
		}));
		await session.completion;

		expect(update_event.added_paths).toEqual(['nested/added.png']);
		expect(update_event.changed_paths).toEqual(['changed.png']);
		expect(update_event.deleted_paths).toEqual(['deleted.png']);
		expect(update_event.generation).toEqual(2);
	});

	it('quarantines malformed PNGs and diagnoses ambiguous set filenames.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		WriteCatalogFile(root, 'bad.png');
		WriteCatalogFile(root, 'first/shared.png');
		WriteCatalogFile(root, 'second/shared.png');
		let initial_catalog_event = null;
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			check_period_ms: 1,
			image_sets: [{ name: 'ambiguous', members: ['shared.png'] }],
			on_matches_found: function() {},
			on_no_matches_found: function() { return 'EXIT'; },
			on_catalog_changed: function(event) { initial_catalog_event = event; }
		}, CreateDependencies({
			load_bitmap: function(png_path)
			{
				if (path.basename(png_path) === 'bad.png') throw new Error('invalid PNG');
				return png_path.includes('/first/') ? SolidBitmap(1, 2, 3) : SolidBitmap(4, 5, 6);
			}
		}));
		await session.completion;

		expect(initial_catalog_event.images.length).toEqual(2);
		expect(initial_catalog_event.diagnostics.some(function(item) { return item.code === 'PNG_LOAD_FAILED'; })).toBeTruthy();
		expect(initial_catalog_event.diagnostics.some(function(item) { return item.code === 'IMAGE_SET_MEMBER_AMBIGUOUS'; })).toBeTruthy();
	});

	it('bounds concurrent callbacks and retries transient sweep failures.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		WriteCatalogFile(root, 'match.png');
		let capture_attempts = 0;
		let errors = 0;
		let active_callbacks = 0;
		let maximum_active_callbacks = 0;
		let before_count = 0;
		const dependencies = CreateDependencies({
			bitmaps: { 'match.png': SolidBitmap(1, 2, 3) },
			capture_display: function()
			{
				capture_attempts += 1;
				if (capture_attempts <= 2) throw new Error('temporary capture failure');
				return SolidBitmap(1, 2, 3);
			},
			create_matcher: function()
			{
				return { search: async function()
				{
					return {
						images: [{ image_index: 0, occurrences: [{ x: 0, y: 0, width: 1, height: 1, score: 1, overlap_ratio: 1 }] }],
						metrics: EmptyMetrics()
					};
				} };
			}
		});
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			check_period_ms: 1,
			callback_mode: 'concurrent',
			max_pending_callbacks: 2,
			repeat: { mode: 'every_sweep' },
			on_before_sweep: function()
			{
				before_count += 1;
				if (before_count === 6) return 'EXIT';
			},
			on_matches_found: async function()
			{
				active_callbacks += 1;
				maximum_active_callbacks = Math.max(maximum_active_callbacks, active_callbacks);
				await new Promise(function(resolve) { setTimeout(resolve, 10); });
				active_callbacks -= 1;
			},
			on_error: function(event)
			{
				if (event.error.code === 'SWEEP_FAILED') errors += 1;
			}
		}, dependencies);
		await session.completion;
		await new Promise(function(resolve) { setTimeout(resolve, 20); });

		expect(capture_attempts).toBeGreaterThan(2);
		expect(errors).toEqual(2);
		expect(maximum_active_callbacks).toBeLessThanOrEqual(2);
	});

	it('supports AbortSignal cancellation and rejects callback failures by default.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		const controller = new AbortController();
		const aborted = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			check_period_ms: 100,
			signal: controller.signal,
			on_matches_found: function() {},
			on_no_matches_found: function() { controller.abort(); }
		}, CreateDependencies());
		const abort_summary = await aborted.completion;
		expect(abort_summary.reason).toEqual('aborted');

		const failed = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			check_period_ms: 1,
			on_matches_found: function() {},
			on_no_matches_found: function() { throw new Error('callback exploded'); }
		}, CreateDependencies());
		let failure = null;
		try { await failed.completion; } catch (error) { failure = error; }
		expect(failure).not.toBeNull();
		expect(failure.message).toMatch(/callback exploded/);
	});

	it('supports idempotent explicit session cancellation.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		const session = await watcher_module.StartImageCatalogWatcher({
			image_dir: root,
			check_period_ms: 1000,
			on_matches_found: function() {}
		}, CreateDependencies());
		const first_completion = session.stop();
		const second_completion = session.stop();

		expect(first_completion).toBe(second_completion);
		expect((await first_completion).reason).toEqual('stopped');
		expect(session.getState()).toEqual('stopped');
	});

	it('validates fuzzy controls at startup.', async function()
	{
		const root = CreateTempCatalog();
		temp_dirs.push(root);
		let error = null;
		try
		{
			await watcher_module.StartImageCatalogWatcher({
				image_dir: root,
				matching: { mode: 'fuzzy', threshold: 1.1 },
				on_matches_found: function() {}
			}, CreateDependencies());
		}
		catch (caught_error)
		{
			error = caught_error;
		}
		expect(error).not.toBeNull();
		expect(error.message).toMatch(/matching.threshold/);

		for (const thread_count of [0, 1.5, 65, 'many'])
		{
			expect(function()
			{
				watcher_module._testing.NormalizeOptions({
					image_dir: root,
					matching: { mode: 'fuzzy', thread_count: thread_count },
					on_matches_found: function() {}
				});
			}).toThrowError(/matching.thread_count/);
		}
	});
});

function EmptyMetrics()
{
	return {
		catalog_images: 0,
		fingerprint_entries: 0,
		haystack_pixels_scanned: 0,
		index_buckets_visited: 0,
		candidate_offsets_generated: 0,
		candidate_offsets_verified: 0,
		verification_pixels_compared: 0,
		elapsed_ms: 0
	};
}
