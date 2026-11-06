#!/usr/bin/env node
'use strict';

const os = require('node:os');
const {performance} = require('node:perf_hooks');
const native = require('../build/Release/robotjs.node');

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
		image: image
	};
}

function PixelForSeed(seed, x, y)
{
	let value = (seed * 2654435761) ^ (x * 2246822519) ^ (y * 3266489917);
	value ^= value >>> 15;
	value = Math.imul(value, 2246822519);
	value ^= value >>> 13;
	return [value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF];
}

function EmbedBitmap(haystack, needle, target_x, target_y, variance)
{
	for (let y = 0; y < needle.height; y += 1)
	{
		for (let x = 0; x < needle.width; x += 1)
		{
			const source_offset = (y * needle.byteWidth) + (x * needle.bytesPerPixel);
			const target_offset =
				((target_y + y) * haystack.byteWidth) +
				((target_x + x) * haystack.bytesPerPixel);
			for (let channel = 0; channel < 3; channel += 1)
			{
				const delta = ((x + y + channel) % ((variance * 2) + 1)) - variance;
				haystack.image[target_offset + channel] = Math.max(
					0,
					Math.min(255, needle.image[source_offset + channel] + delta)
				);
			}
		}
	}
}

function Percentile(values, fraction)
{
	const sorted = values.slice().sort(function(first, second) { return first - second; });
	return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function ParseThreadCounts(legacy)
{
	if (legacy)
	{
		return [{label: 'legacy', value: 1}];
	}
	const argument = process.argv.find(function(value) { return value.startsWith('--threads='); });
	const values = argument ? argument.slice('--threads='.length).split(',') : ['1', '2', '4', '8', 'auto'];
	return values.map(function(value)
	{
		if (value === 'auto')
		{
			return {
				label: 'auto',
				value: Math.max(1, Math.min(8, os.availableParallelism()))
			};
		}
		const thread_count = Number(value);
		if (!Number.isInteger(thread_count) || thread_count < 1)
		{
			throw new Error('Every --threads value must be a positive integer or auto.');
		}
		return {label: value, value: thread_count};
	});
}

function CreateFixture(params)
{
	const catalog = [];
	for (let index = 0; index < params.catalog_size; index += 1)
	{
		catalog.push(CreateBitmap(params.needle_width, params.needle_height, function(x, y)
		{
			return PixelForSeed(index + 1, x, y);
		}));
	}
	const haystack = CreateBitmap(params.width, params.height, function(x, y)
	{
		return PixelForSeed(100003, x, y);
	});
	EmbedBitmap(
		haystack,
		catalog[0],
		Math.floor(params.width * 0.63),
		Math.floor(params.height * 0.57),
		3
	);
	return {
		catalog: catalog,
		haystack: haystack
	};
}

async function RunCase(test_case, thread, iterations, legacy)
{
	const fixture = CreateFixture(test_case);
	const build_started_at = performance.now();
	const matcher = new native.BitmapCatalogMatcher(fixture.catalog, {
		mode: 'fuzzy',
		threshold: test_case.threshold,
		tolerance: test_case.tolerance,
		allow_partial_match: false,
		candidate_step: 1,
		max_results_per_image: 5,
		max_candidates_per_image: 1000000,
		thread_count: thread.value
	});
	const build_ms = performance.now() - build_started_at;
	const wall_times = [];
	const native_times = [];
	let latest_result = null;

	for (let iteration = 0; iteration < iterations; iteration += 1)
	{
		const started_at = performance.now();
		latest_result = legacy
			? await matcher.search(fixture.haystack)
			: await matcher.search(fixture.haystack, thread.value);
		wall_times.push(performance.now() - started_at);
		native_times.push(latest_result.metrics.elapsed_ms);
	}

	const occurrences = latest_result.images.reduce(function(total, image)
	{
		return total + image.occurrences.length;
	}, 0);
	if (latest_result.images[0].occurrences.length === 0)
	{
		throw new Error('The benchmark fixture did not preserve its expected fuzzy match.');
	}

	return {
		case: test_case.name,
		source: `${test_case.width}x${test_case.height}`,
		catalog_images: test_case.catalog_size,
		reference: `${test_case.needle_width}x${test_case.needle_height}`,
		thread_count: thread.label,
		requested_threads: thread.value,
		effective_threads: latest_result.metrics.effective_thread_count || 1,
		build_ms: Number(build_ms.toFixed(3)),
		wall_p50_ms: Number(Percentile(wall_times, 0.5).toFixed(3)),
		wall_p95_ms: Number(Percentile(wall_times, 0.95).toFixed(3)),
		native_p50_ms: Number(Percentile(native_times, 0.5).toFixed(3)),
		occurrences: occurrences,
		metrics: latest_result.metrics
	};
}

async function Main()
{
	const legacy = process.argv.includes('--legacy');
	const full = process.argv.includes('--full');
	const iterations = full ? 5 : 3;
	const cases = [{
		name: 'medium_high_entropy',
		width: 960,
		height: 540,
		catalog_size: 16,
		needle_width: 24,
		needle_height: 24,
		threshold: 0.9,
		tolerance: 0.08
	}];
	if (full)
	{
		cases.push({
			name: 'full_hd_catalog',
			width: 1920,
			height: 1080,
			catalog_size: 50,
			needle_width: 32,
			needle_height: 32,
			threshold: 0.9,
			tolerance: 0.08
		});
	}

	for (const test_case of cases)
	{
		for (const thread of ParseThreadCounts(legacy))
		{
			console.log(JSON.stringify(await RunCase(test_case, thread, iterations, legacy)));
		}
	}
}

Main().catch(function(error)
{
	console.error(error && error.stack ? error.stack : String(error));
	process.exitCode = 1;
});
