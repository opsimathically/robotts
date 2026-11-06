#!/usr/bin/env node
'use strict';

const native = require('../build/Release/robotjs.node');
const robot = require('..');

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
	return { width: width, height: height, byteWidth: byte_width, bitsPerPixel: 24, bytesPerPixel: 3, image: image };
}

function Assert(condition, message)
{
	if (!condition) throw new Error(message);
}

async function Main()
{
	const red = CreateBitmap(2, 2, function() { return [255, 0, 0]; });
	const green = CreateBitmap(2, 2, function() { return [0, 255, 0]; });
	const haystack = CreateBitmap(64, 48, function(x, y)
	{
		if (x >= 4 && x < 6 && y >= 5 && y < 7) return [255, 0, 0];
		if (x >= 30 && x < 32 && y >= 20 && y < 22) return [0, 255, 0];
		return [(x * 3 + y) & 0x7F, (x + y * 5) & 0x7F, (x * 7 + y * 11) & 0x7F];
	});
	const matcher = new native.BitmapCatalogMatcher([red, green], {
		mode: 'exact',
		max_results_per_image: 10
	});
	const searches = [];
	for (let index = 0; index < 8; index += 1)
	{
		searches.push(matcher.search(haystack));
	}
	const results = await Promise.all(searches);
	for (const result of results)
	{
		Assert(result.images[0].occurrences.some(function(item) { return item.x === 4 && item.y === 5; }), 'red occurrence missing');
		Assert(result.images[1].occurrences.some(function(item) { return item.x === 30 && item.y === 20; }), 'green occurrence missing');
		Assert(result.metrics.haystack_pixels_scanned === 64 * 48, 'haystack traversal count is invalid');
	}

	const fuzzy = new native.BitmapCatalogMatcher([red], {
		mode: 'fuzzy',
		threshold: 0.8,
		tolerance: 0.2,
		candidate_step: 1,
		max_results_per_image: 10
	});
	const fuzzy_result = await fuzzy.search(haystack);
	Assert(fuzzy_result.images[0].occurrences.length > 0, 'fuzzy occurrence missing');

	const noisy_reference = CreateBitmap(20, 10, function(x, y)
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
	const noisy_haystack = CreateBitmap(100, 60, function() { return [0, 0, 0]; });
	const evidence_matcher = new native.BitmapCatalogMatcher([noisy_reference], {
		mode: 'fuzzy',
		threshold: 0.9,
		tolerance: 0.1,
		candidate_step: 1,
		max_results_per_image: 10,
		max_candidates_per_image: 10
	});
	const evidence_searches = [];
	for (let index = 0; index < 4; index += 1)
	{
		evidence_searches.push(evidence_matcher.search(noisy_haystack));
	}
	for (const evidence_result of await Promise.all(evidence_searches))
	{
		Assert(evidence_result.images[0].occurrences.length === 0,
			'incidental fuzzy pixel hits produced an occurrence');
		Assert(evidence_result.metrics.candidate_offsets_generated === 0,
			'incidental fuzzy pixel hits consumed the qualified candidate budget');
	}

	const parallel_reference = CreateBitmap(8, 8, function(x, y)
	{
		return [(x * 31 + y * 7) & 0xFF, (x * 13 + y * 29) & 0xFF, (x * 19 + y * 23) & 0xFF];
	});
	const parallel_haystack = CreateBitmap(260, 260, function(x, y)
	{
		if (x >= 170 && x < 178 && y >= 130 && y < 138)
		{
			return [
				((x - 170) * 31 + (y - 130) * 7) & 0xFF,
				((x - 170) * 13 + (y - 130) * 29) & 0xFF,
				((x - 170) * 19 + (y - 130) * 23) & 0xFF
			];
		}
		return [(x * 17 + y * 3) & 0xFF, (x * 5 + y * 11) & 0xFF, (x * 7 + y * 13) & 0xFF];
	});
	const parallel_matcher = new native.BitmapCatalogMatcher([parallel_reference], {
		mode: 'fuzzy',
		threshold: 0.99,
		tolerance: 0.01,
		candidate_step: 1,
		max_results_per_image: 10
	});
	const single_result = await parallel_matcher.search(parallel_haystack, 1);
	const parallel_results = await Promise.all([
		parallel_matcher.search(parallel_haystack, 4),
		parallel_matcher.search(parallel_haystack, 4)
	]);
	for (const parallel_result of parallel_results)
	{
		Assert(JSON.stringify(parallel_result.images) === JSON.stringify(single_result.images),
			'parallel fuzzy search changed deterministic results');
		Assert(parallel_result.metrics.effective_thread_count >= 1 &&
			parallel_result.metrics.effective_thread_count <= 4,
			'parallel fuzzy search reported an invalid effective thread count');
	}

	parallel_haystack.colorAt = function() { return '000000'; };
	parallel_reference.colorAt = function() { return '000000'; };
	const direct_single = robot.image_search.findFuzzy({
		source: { type: 'bitmap', bitmap: parallel_haystack },
		reference: { bitmap: parallel_reference },
		threshold: 0.99,
		tolerance: 0.01,
		thread_count: 1
	});
	const direct_parallel = robot.image_search.findFuzzy({
		source: { type: 'bitmap', bitmap: parallel_haystack },
		reference: { bitmap: parallel_reference },
		threshold: 0.99,
		tolerance: 0.01,
		thread_count: 4
	});
	Assert(JSON.stringify(direct_parallel.location) === JSON.stringify(direct_single.location) &&
		direct_parallel.score === direct_single.score,
		'parallel direct fuzzy search changed deterministic results');

	if (typeof global.gc === 'function')
	{
		global.gc();
		await new Promise(function(resolve) { setImmediate(resolve); });
		global.gc();
	}
	console.log('native image catalog verification passed');
}

Main().catch(function(error)
{
	console.error(error && error.stack ? error.stack : String(error));
	process.exit(1);
});
