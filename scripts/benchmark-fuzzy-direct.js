#!/usr/bin/env node
'use strict';

const os = require('node:os');
const {performance} = require('node:perf_hooks');
const robot = require('..');

function CreateBitmap(width, height, seed)
{
	const byte_width = 4 + (((width * 3) - 1) & ~3);
	const image = Buffer.alloc(byte_width * height);
	for (let y = 0; y < height; y += 1)
	{
		for (let x = 0; x < width; x += 1)
		{
			let value = (seed * 2654435761) ^ (x * 2246822519) ^ (y * 3266489917);
			value ^= value >>> 15;
			value = Math.imul(value, 2246822519);
			value ^= value >>> 13;
			const offset = (y * byte_width) + (x * 3);
			image[offset] = value & 0xFF;
			image[offset + 1] = (value >>> 8) & 0xFF;
			image[offset + 2] = (value >>> 16) & 0xFF;
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

function EmbedBitmap(haystack, needle, target_x, target_y)
{
	for (let y = 0; y < needle.height; y += 1)
	{
		needle.image.copy(
			haystack.image,
			((target_y + y) * haystack.byteWidth) + (target_x * haystack.bytesPerPixel),
			y * needle.byteWidth,
			(y * needle.byteWidth) + (needle.width * needle.bytesPerPixel)
		);
	}
}

function ParseThreadCounts()
{
	const argument = process.argv.find(function(value) { return value.startsWith('--threads='); });
	const values = argument ? argument.slice('--threads='.length).split(',') : ['1', '2', '4', '8', 'auto'];
	return values.map(function(value)
	{
		if (value === 'auto') return {label: value, value: 'auto'};
		const parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < 1 || parsed > 64)
		{
			throw new Error('Every --threads value must be auto or an integer from 1 to 64.');
		}
		return {label: value, value: parsed};
	});
}

function Percentile(values, fraction)
{
	const sorted = values.slice().sort(function(first, second) { return first - second; });
	return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function Main()
{
	const haystack = CreateBitmap(960, 540, 100003);
	const reference = CreateBitmap(32, 32, 7);
	EmbedBitmap(haystack, reference, 611, 307);

	for (const thread_count of ParseThreadCounts())
	{
		const wall_times = [];
		let result = null;
		for (let iteration = 0; iteration < 3; iteration += 1)
		{
			const started_at = performance.now();
			result = robot.image_search.findFuzzy({
				source: {type: 'bitmap', bitmap: haystack},
				reference: {bitmap: reference},
				threshold: 0.95,
				tolerance: 0.05,
				sample_step: 2,
				thread_count: thread_count.value
			});
			wall_times.push(performance.now() - started_at);
		}
		if (!result.found || result.location.x !== 611 || result.location.y !== 307)
		{
			throw new Error('The direct fuzzy benchmark did not preserve its expected match.');
		}
		console.log(JSON.stringify({
			source: '960x540',
			reference: '32x32',
			thread_count: thread_count.label,
			available_parallelism: os.availableParallelism(),
			effective_threads: result.metrics.effective_thread_count,
			wall_p50_ms: Number(Percentile(wall_times, 0.5).toFixed(3)),
			wall_p95_ms: Number(Percentile(wall_times, 0.95).toFixed(3)),
			metrics: result.metrics
		}));
	}
}

try
{
	Main();
}
catch (error)
{
	console.error(error && error.stack ? error.stack : String(error));
	process.exitCode = 1;
}
