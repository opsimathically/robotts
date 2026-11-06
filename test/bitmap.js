var robot = require('..');

describe('Bitmap', () => {
  var params = {
		'width': 'number',
		'height': 'number',
		'byteWidth': 'number',
		'bitsPerPixel': 'number',
		'bytesPerPixel': 'number',
		'image': 'object'
	};

	it('Get a bitmap and check the parameters.', function() {
		var img = robot.screen.capture();

		for (var x in params)
		{
			expect(typeof img[x]).toEqual(params[x]);
		}
	});

	it('Get a bitmap of a specific size.', function()
	{
		var size = 10;
		var img = robot.screen.capture(0, 0, size, size);

		// Support for higher density screens.
		var multi = img.width / size;
		var size = size * multi;
		expect(img.height).toEqual(size);
		expect(img.width).toEqual(size);
	});

	it('Rejects invalid capture regions without entering X11 capture code.', function()
	{
		var screen_size = robot.getScreenSize();
		expect(function() { robot.screen.capture(-1, 0, 1, 1); }).toThrowError(/non-negative/);
		expect(function() { robot.screen.capture(0, 0, 0, 1); }).toThrowError(/positive/);
		expect(function() { robot.screen.capture(0, 0, 1); }).toThrowError(/zero arguments or x, y, width, and height/);
		expect(function()
		{
			robot.screen.capture(screen_size.width, 0, 1, 1);
		}).toThrowError(/outside the desktop bounds/);
	});

	it('Get a bitmap and make sure the colorAt works as expected.', function()
	{
		var img = robot.screen.capture();
		var hex = img.colorAt(0, 0);

		// t.ok(.it(hex), "colorAt returned valid hex.");
		expect(hex).toMatch(/^[0-9A-F]{6}$/i);

		var screenSize = robot.getScreenSize();
		var width = screenSize.width;
		var height = screenSize.height;

		// Support for higher density screens.
		var multi = img.width / width;
		width = width * multi;
		height = height * multi;
		expect(() => img.colorAt(0, height)).toThrowError(/are outside the bitmap/);
		expect(() => img.colorAt(0, height-1)).not.toThrow();
		expect(() => img.colorAt(width, 0)).toThrowError(/are outside the bitmap/);
		expect(() => img.colorAt(9999999999999, 0)).toThrowError(/are outside the bitmap/);
		expect(() => img.colorAt(0, 9999999999999)).toThrowError(/are outside the bitmap/);
	});
});
