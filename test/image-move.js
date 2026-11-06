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

function CreateDesktopState()
{
	return {
		session: {
			sessionType: 'x11',
			xDisplayName: ':0.0',
			waylandDisplayName: null
		},
		capabilities: {
			backend: 'x11',
			supportsGlobalInputInjection: true,
			supportsWindowDiscovery: true,
			supportsMonitorGeometry: true,
			supportsWorkspaceIdentity: true,
			supportsFocusChanges: true,
			supportsStrictTargetVerification: true
		},
		desktopBounds: {
			x: 0,
			y: 0,
			width: 1600,
			height: 900
		},
		displays: [{
			id: 0,
			name: 'display-0',
			x: 300,
			y: 400,
			width: 800,
			height: 600,
			isPrimary: true
		}],
		workspaces: [{
			id: 0,
			name: 'workspace-0',
			isCurrent: true
		}],
		currentWorkspaceId: 0,
		activeWindow: {
			windowId: '42',
			title: 'Test Window',
			className: 'test-class',
			instanceName: 'test-instance',
			pid: 1234,
			workspaceId: 0,
			geometry: {
				x: 300,
				y: 400,
				width: 4,
				height: 4
			},
			isActive: true,
			isVisible: true
		},
		windows: [{
			windowId: '42',
			title: 'Test Window',
			className: 'test-class',
			instanceName: 'test-instance',
			pid: 1234,
			workspaceId: 0,
			geometry: {
				x: 300,
				y: 400,
				width: 4,
				height: 4
			},
			isActive: true,
			isVisible: true
		}]
	};
}

describe('Image Move', function()
{
	var temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robotts-image-move-'));
	var haystack_path = path.join(temp_dir, 'haystack.png');
	var reference_path = path.join(temp_dir, 'reference.png');
	var fuzzy_haystack_path = path.join(temp_dir, 'fuzzy.png');
	var original_move_mouse;
	var original_get_mouse_pos;
	var original_capture;
	var original_capture_window;
	var original_get_desktop_state;
	var move_calls;
	var capture_window_params;

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
			output_path: fuzzy_haystack_path,
			width: 2,
			height: 2,
			pixels: [
				[[210, 20, 20], [20, 210, 20]],
				[[20, 20, 210], [210, 210, 60]]
			]
		});
	});

	beforeEach(function()
	{
		original_move_mouse = robot.moveMouse;
		original_get_mouse_pos = robot.getMousePos;
		original_capture = robot.screen.capture;
		original_capture_window = robot.screen.captureWindow;
		original_get_desktop_state = robot.getDesktopState;
		move_calls = [];
		capture_window_params = null;

		robot.moveMouse = function(x, y)
		{
			move_calls.push({
				x: x,
				y: y
			});

			return 1;
		};

		robot.getMousePos = function()
		{
			return {
				x: 0,
				y: 0
			};
		};
	});

	afterEach(function()
	{
		robot.moveMouse = original_move_mouse;
		robot.getMousePos = original_get_mouse_pos;
		robot.screen.capture = original_capture;
		robot.screen.captureWindow = original_capture_window;
		robot.getDesktopState = original_get_desktop_state;
	});

	it('moves to an exact image match using the center anchor by default.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: haystack_path
		});
		var result;

		robot.screen.capture = function()
		{
			return haystack;
		};

		result = robot.desktop.moveMouseToImage({
			source: {
				type: 'region',
				x: 100,
				y: 200,
				width: 4,
				height: 4
			},
			reference: {
				png_path: reference_path
			}
		});

		expect(result.found).toBeTruthy();
		expect(result.moved).toBeTruthy();
		expect(result.destination).toEqual({ x: 102, y: 202 });
		expect(result.match.location).toEqual({ x: 1, y: 1 });
		expect(result.match.global_location).toEqual({ x: 101, y: 201 });
		expect(move_calls).toEqual([{ x: 102, y: 202 }]);
	});

	it('supports top-left anchoring and offsets for exact image moves.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: haystack_path
		});
		var result;

		robot.screen.capture = function()
		{
			return haystack;
		};

		result = robot.desktop.moveMouseToImage({
			source: {
				type: 'region',
				x: 100,
				y: 200,
				width: 4,
				height: 4
			},
			reference: {
				png_path: reference_path
			},
			match_anchor: 'top_left',
			offset_x: 5,
			offset_y: -3
		});

		expect(result.moved).toBeTruthy();
		expect(result.destination).toEqual({ x: 106, y: 198 });
		expect(move_calls).toEqual([{ x: 106, y: 198 }]);
	});

	it('moves to accepted fuzzy matches and respects fuzzy thresholds.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: fuzzy_haystack_path
		});
		var result;

		robot.screen.capture = function()
		{
			return haystack;
		};

		result = robot.desktop.moveMouseToImageFuzzy({
			source: {
				type: 'region',
				x: 50,
				y: 60,
				width: 2,
				height: 2
			},
			reference: {
				png_path: reference_path
			},
			threshold: 0.7,
			tolerance: 0.2
		});

		expect(result.found).toBeTruthy();
		expect(result.moved).toBeTruthy();
		expect(result.destination).toEqual({ x: 51, y: 61 });
		expect(move_calls).toEqual([{ x: 51, y: 61 }]);
	});

	it('does not move for fuzzy near misses and preserves the match details.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: fuzzy_haystack_path
		});
		var result;

		robot.screen.capture = function()
		{
			return haystack;
		};

		result = robot.desktop.moveMouseToImageFuzzy({
			source: {
				type: 'region',
				x: 50,
				y: 60,
				width: 2,
				height: 2
			},
			reference: {
				png_path: reference_path
			},
			threshold: 0.99,
			tolerance: 0.2
		});

		expect(result.found).toBeFalsy();
		expect(result.moved).toBeFalsy();
		expect(result.destination).toBeNull();
		expect(result.match.score).toBeGreaterThan(0.9);
		expect(result.match.global_location).toEqual({ x: 50, y: 60 });
		expect(move_calls.length).toEqual(0);
	});

	it('moves along a path to exact image matches and returns the effective seed.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: haystack_path
		});
		var result;

		robot.screen.capture = function()
		{
			return haystack;
		};

		result = robot.desktop.moveMousePathToImage({
			source: {
				type: 'region',
				x: 100,
				y: 200,
				width: 4,
				height: 4
			},
			reference: {
				png_path: reference_path
			},
			style: 'linear',
			steps: 2,
			duration_ms: 0,
			random_seed: 'path-seed',
			include_effective_seed: true
		});

		expect(result.found).toBeTruthy();
		expect(result.moved).toBeTruthy();
		expect(result.destination).toEqual({ x: 102, y: 202 });
		expect(result.effective_seed).toEqual('path-seed');
		expect(move_calls[move_calls.length - 1]).toEqual({ x: 102, y: 202 });
	});

	it('rejects bitmap-only image move sources.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: haystack_path
		});

		expect(function()
		{
			robot.desktop.moveMouseToImage({
				source: {
					type: 'bitmap',
					bitmap: haystack
				},
				reference: {
					png_path: reference_path
				}
			});
		}).toThrowError(/coordinate-bearing image search source/);
	});

	it('moves to image matches inside locked windows using absolute desktop coordinates.', function()
	{
		var haystack = robot.image_search.loadReference({
			png_path: haystack_path
		});
		var locked_window;
		var result;

		robot.getDesktopState = function()
		{
			return CreateDesktopState();
		};

		robot.screen.captureWindow = function(params)
		{
			capture_window_params = params;
			return haystack;
		};

		locked_window = robot.desktop.lockWindow({
			title: 'Test Window'
		});

		result = locked_window.moveMouseToImage({
			reference: {
				png_path: reference_path
			}
		});

		expect(result.found).toBeTruthy();
		expect(result.moved).toBeTruthy();
		expect(result.destination).toEqual({ x: 302, y: 402 });
		expect(capture_window_params.target.windowId).toEqual('42');
		expect(move_calls).toEqual([{ x: 302, y: 402 }]);
	});
});
