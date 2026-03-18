var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var zlib = require('node:zlib');
var robot = require('..');

function CreateCrcTable()
{
	var table = new Array(256);
	var index;

	for (index = 0; index < 256; index += 1)
	{
		var value = index;
		var bit_index;

		for (bit_index = 0; bit_index < 8; bit_index += 1)
		{
			if ((value & 1) === 1)
			{
				value = 0xEDB88320 ^ (value >>> 1);
			}
			else
			{
				value >>>= 1;
			}
		}

		table[index] = value >>> 0;
	}

	return table;
}

var crc_table = CreateCrcTable();

function ComputeCrc(buffer)
{
	var crc = 0xFFFFFFFF;
	var index;

	for (index = 0; index < buffer.length; index += 1)
	{
		crc = crc_table[(crc ^ buffer[index]) & 0xFF] ^ (crc >>> 8);
	}

	return (crc ^ 0xFFFFFFFF) >>> 0;
}

function CreateChunk(type, data)
{
	var type_buffer = Buffer.from(type, 'ascii');
	var length_buffer = Buffer.alloc(4);
	var crc_buffer = Buffer.alloc(4);
	var crc = ComputeCrc(Buffer.concat([type_buffer, data]));

	length_buffer.writeUInt32BE(data.length, 0);
	crc_buffer.writeUInt32BE(crc >>> 0, 0);

	return Buffer.concat([length_buffer, type_buffer, data, crc_buffer]);
}

function WritePng(params)
{
	var width = params.width;
	var height = params.height;
	var pixels = params.pixels;
	var row_size = width * 3;
	var raw_rows = [];
	var y;
	var x;
	var output_path = params.output_path;
	var header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	var ihdr = Buffer.alloc(13);

	for (y = 0; y < height; y += 1)
	{
		var row = Buffer.alloc(1 + row_size);
		row[0] = 0;

		for (x = 0; x < width; x += 1)
		{
			var pixel = pixels[y][x];
			var offset = 1 + (x * 3);
			row[offset] = pixel[0];
			row[offset + 1] = pixel[1];
			row[offset + 2] = pixel[2];
		}

		raw_rows.push(row);
	}

	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	fs.writeFileSync(output_path, Buffer.concat([
		header,
		CreateChunk('IHDR', ihdr),
		CreateChunk('IDAT', zlib.deflateSync(Buffer.concat(raw_rows))),
		CreateChunk('IEND', Buffer.alloc(0))
	]));
}

describe('Image Search', () => {
	var temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robotts-image-search-'));
	var haystack_path = path.join(temp_dir, 'haystack.png');
	var reference_path = path.join(temp_dir, 'reference.png');
	var repeated_haystack_path = path.join(temp_dir, 'repeated.png');
	var single_pixel_reference_path = path.join(temp_dir, 'single-pixel.png');
	var fuzzy_haystack_path = path.join(temp_dir, 'fuzzy.png');
	var partial_haystack_path = path.join(temp_dir, 'partial.png');
	var dual_fuzzy_haystack_path = path.join(temp_dir, 'dual-fuzzy.png');

	beforeAll(function()
	{
		WritePng({
			output_path: haystack_path,
			width: 4,
			height: 4,
			pixels: [
				[[5, 5, 5], [10, 10, 10], [20, 20, 20], [30, 30, 30]],
				[[40, 40, 40], [200, 10, 10], [10, 200, 10], [50, 50, 50]],
				[[60, 60, 60], [10, 10, 200], [220, 220, 40], [70, 70, 70]],
				[[80, 80, 80], [90, 90, 90], [100, 100, 100], [110, 110, 110]]
			]
		});

		WritePng({
			output_path: reference_path,
			width: 2,
			height: 2,
			pixels: [
				[[200, 10, 10], [10, 200, 10]],
				[[10, 10, 200], [220, 220, 40]]
			]
		});

		WritePng({
			output_path: repeated_haystack_path,
			width: 3,
			height: 1,
			pixels: [
				[[255, 0, 0], [0, 0, 0], [255, 0, 0]]
			]
		});

		WritePng({
			output_path: single_pixel_reference_path,
			width: 1,
			height: 1,
			pixels: [
				[[255, 0, 0]]
			]
		});

		WritePng({
			output_path: fuzzy_haystack_path,
			width: 2,
			height: 2,
			pixels: [
				[[210, 20, 20], [20, 210, 20]],
				[[20, 20, 210], [210, 210, 60]]
			]
		});

		WritePng({
			output_path: partial_haystack_path,
			width: 1,
			height: 2,
			pixels: [
				[[200, 10, 10]],
				[[10, 10, 200]]
			]
		});

		WritePng({
			output_path: dual_fuzzy_haystack_path,
			width: 4,
			height: 2,
			pixels: [
				[[170, 40, 40], [40, 170, 40], [200, 10, 10], [10, 200, 10]],
				[[40, 40, 170], [180, 180, 80], [10, 10, 200], [220, 220, 40]]
			]
		});
	});

	it('finds an exact bitmap match from a bitmap source and bitmap reference.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: haystack_path
		});
		var reference = robot.image_search.loadReference({
			png_path: reference_path
		});
		var result = robot.image_search.find({
			source: {
				type: 'bitmap',
				bitmap: haystack
			},
			reference: {
				bitmap: reference
			}
		});

		expect(result.found).toBeTruthy();
		expect(result.location).toEqual({ x: 1, y: 1 });
		expect(result.reference_type).toEqual('bitmap');
	});

	it('finds an exact match from a PNG reference path.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: haystack_path
		});
		var result = robot.image_search.find({
			source: {
				type: 'bitmap',
				bitmap: haystack
			},
			reference: {
				png_path: reference_path
			}
		});

		expect(result.found).toBeTruthy();
		expect(result.location).toEqual({ x: 1, y: 1 });
		expect(result.reference_type).toEqual('png_path');
	});

	it('returns all exact matches.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: repeated_haystack_path
		});
		var results = robot.image_search.findAll({
			source: {
				type: 'bitmap',
				bitmap: haystack
			},
			reference: {
				png_path: single_pixel_reference_path
			}
		});

		expect(results.length).toEqual(2);
		expect(results[0].location).toEqual({ x: 0, y: 0 });
		expect(results[1].location).toEqual({ x: 2, y: 0 });
	});

	it('returns the top-left exact match first.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: repeated_haystack_path
		});
		var result = robot.image_search.find({
			source: {
				type: 'bitmap',
				bitmap: haystack
			},
			reference: {
				png_path: single_pixel_reference_path
			}
		});

		expect(result.found).toBeTruthy();
		expect(result.location).toEqual({ x: 0, y: 0 });
		expect(result.overlap_ratio).toEqual(1);
	});

	it('returns a typed no-match result when no exact match exists.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: haystack_path
		});
		var result = robot.image_search.find({
			source: {
				type: 'bitmap',
				bitmap: haystack
			},
			reference: {
				png_path: single_pixel_reference_path
			},
			tolerance: 0
		});

		expect(result.found).toBeFalsy();
		expect(result.location).toBeNull();
	});

	it('throws for invalid exact-search tolerance values.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: haystack_path
		});

		expect(function()
		{
			robot.image_search.find({
				source: {
					type: 'bitmap',
					bitmap: haystack
				},
				reference: {
					png_path: reference_path
				},
				tolerance: -0.01
			});
		}).toThrowError(/between 0 and 1/);
	});

	it('finds a fuzzy match with small color variance.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: fuzzy_haystack_path
		});
		var result = robot.image_search.findFuzzy({
			source: {
				type: 'bitmap',
				bitmap: haystack
			},
			reference: {
				png_path: reference_path
			},
			threshold: 0.7,
			tolerance: 0.2
		});

		expect(result.found).toBeTruthy();
		expect(result.score).toBeGreaterThan(0.7);
		expect(result.location).toEqual({ x: 0, y: 0 });
		expect(result.size).toEqual({ width: 2, height: 2 });
		expect(result.overlap_ratio).toEqual(1);
	});

	it('returns the best fuzzy score instead of the earliest acceptable match.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: dual_fuzzy_haystack_path
		});
		var result = robot.image_search.findFuzzy({
			source: {
				type: 'bitmap',
				bitmap: haystack
			},
			reference: {
				png_path: reference_path
			},
			threshold: 0.7,
			tolerance: 0.2
		});

		expect(result.found).toBeTruthy();
		expect(result.location).toEqual({ x: 2, y: 0 });
		expect(result.score).toEqual(1);
	});

	it('returns fuzzy near-miss details when the best candidate misses the threshold.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: fuzzy_haystack_path
		});
		var result = robot.image_search.findFuzzy({
			source: {
				type: 'bitmap',
				bitmap: haystack
			},
			reference: {
				png_path: reference_path
			},
			threshold: 0.99,
			tolerance: 0.2
		});

		expect(result.found).toBeFalsy();
		expect(result.score).not.toBeNull();
		expect(result.score).toBeGreaterThan(0.9);
		expect(result.location).toEqual({ x: 0, y: 0 });
		expect(result.size).toEqual({ width: 2, height: 2 });
		expect(result.overlap_ratio).toEqual(1);
	});

	it('throws for invalid fuzzy-search bounds.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: fuzzy_haystack_path
		});

		expect(function()
		{
			robot.image_search.findFuzzy({
				source: {
					type: 'bitmap',
					bitmap: haystack
				},
				reference: {
					png_path: reference_path
				},
				threshold: 1.01
			});
		}).toThrowError(/threshold|bounds/);

		expect(function()
		{
			robot.image_search.findFuzzy({
				source: {
					type: 'bitmap',
					bitmap: haystack
				},
				reference: {
					png_path: reference_path
				},
				sample_step: 1.5
			});
		}).toThrowError(/sample_step|bounds/);
	});

	it('finds a fuzzy partial match when partial matching is enabled.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: partial_haystack_path
		});
		var result = robot.image_search.findFuzzy({
			source: {
				type: 'bitmap',
				bitmap: haystack
			},
			reference: {
				png_path: reference_path
			},
			threshold: 0.95,
			tolerance: 0.05,
			allow_partial_match: true,
			minimum_overlap_ratio: 0.5
		});

		expect(result.found).toBeTruthy();
		expect(result.score).toBeGreaterThan(0.95);
		expect(result.location).toEqual({ x: 0, y: 0 });
		expect(result.size).toEqual({ width: 1, height: 2 });
		expect(result.overlap_ratio).toEqual(0.5);
	});

	it('returns the same final fuzzy score for automatic and explicit sample steps on stable fixtures.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: fuzzy_haystack_path
		});
		var automatic = robot.image_search.findFuzzy({
			source: {
				type: 'bitmap',
				bitmap: haystack
			},
			reference: {
				png_path: reference_path
			},
			threshold: 0.7,
			tolerance: 0.2
		});
		var explicit = robot.image_search.findFuzzy({
			source: {
				type: 'bitmap',
				bitmap: haystack
			},
			reference: {
				png_path: reference_path
			},
			threshold: 0.7,
			tolerance: 0.2,
			sample_step: 2
		});

		expect(automatic.location).toEqual(explicit.location);
		expect(automatic.score).toEqual(explicit.score);
	});

	it('throws cleanly for an invalid PNG reference path.', function()
	{
		expect(function()
		{
			robot.image_search.loadReference({
				png_path: path.join(temp_dir, 'missing.png')
			});
		}).toThrowError(/does not exist|Could not open file/);
	});
});
