#!/usr/bin/env node
'use strict';

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
	return [
		(seed * 47 + x * 29 + y * 11) & 0xFF,
		(seed * 83 + x * 17 + y * 31) & 0xFF,
		(seed * 19 + x * 43 + y * 23) & 0xFF
	];
}

async function RunBenchmark()
{
	const width = 320;
	const height = 180;
	const haystack = CreateBitmap(width, height, function(x, y) { return PixelForSeed(997, x, y); });
	const catalog_sizes = [1, 10, 100];
	let expected_scan_pixels = null;

	for (const catalog_size of catalog_sizes)
	{
		const catalog = [];
		for (let index = 0; index < catalog_size; index += 1)
		{
			catalog.push(CreateBitmap(5, 5, function(x, y) { return PixelForSeed(index + 1, x, y); }));
		}
		const matcher = new native.BitmapCatalogMatcher(catalog, {
			mode: 'exact',
			max_results_per_image: 5
		});
		const result = await matcher.search(haystack);
		if (expected_scan_pixels === null) expected_scan_pixels = result.metrics.haystack_pixels_scanned;
		if (result.metrics.haystack_pixels_scanned !== expected_scan_pixels)
		{
			throw new Error('Catalog matcher multiplied the haystack traversal by catalog size.');
		}
		console.log(JSON.stringify({
			catalog_images: catalog_size,
			haystack_pixels: width * height,
			haystack_pixels_scanned: result.metrics.haystack_pixels_scanned,
			fingerprint_entries: result.metrics.fingerprint_entries,
			candidate_offsets_verified: result.metrics.candidate_offsets_verified,
			verification_pixels_compared: result.metrics.verification_pixels_compared,
			elapsed_ms: Number(result.metrics.elapsed_ms.toFixed(3))
		}));
	}
}

RunBenchmark().catch(function(error)
{
	console.error(error && error.stack ? error.stack : String(error));
	process.exit(1);
});
