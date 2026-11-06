'use strict';

const package_manifest = require('../package.json');
const package_lock = require('../package-lock.json');
const robot = require('..');

const public_exports = [
	'DialogError',
	'HeldKeyError',
	'HotkeyError',
	'ImageCatalogWatcherError',
	'ScopedWindowError',
	'desktop',
	'doubleClickHumanized',
	'dragMouse',
	'focusWindow',
	'getDesktopState',
	'getMousePos',
	'getPixelColor',
	'getScreenSize',
	'image_search',
	'keyTap',
	'keyToggle',
	'mouseClick',
	'mouseToggle',
	'moveMouse',
	'moveMouseSmooth',
	'randomIntegerBetween',
	'registerHotkey',
	'screen',
	'scrollMouse',
	'setKeyboardDelay',
	'setMouseDelay',
	'showConfirmationDialog',
	'showMessageBox',
	'sleep',
	'sleepRandom',
	'typeString',
	'typeStringDelayed',
	'typeStringHumanized',
	'unicodeTap',
	'updateScreenMetrics'
];

describe('Package Surface', function()
{
	it('publishes a coherent Linux package manifest.', function()
	{
		expect(package_manifest.name).toEqual('@opsimathically/robotts');
		expect(package_lock.name).toEqual(package_manifest.name);
		expect(package_lock.packages[''].name).toEqual(package_manifest.name);
		expect(package_lock.version).toEqual(package_manifest.version);
		expect(package_lock.packages[''].version).toEqual(package_manifest.version);
		expect(package_manifest.os).toEqual(['linux']);
		expect(package_manifest.publishConfig.access).toEqual('public');
		expect(package_manifest.license).toEqual('MIT');
		expect(package_manifest.description).toContain('global hotkeys');
		expect(package_manifest.files).toContain('CHANGELOG.md');
		expect(package_manifest.files).toContain('LICENSE.md');
		expect(package_manifest.files).toContain('README.md');
	});

	it('exposes only the supported CommonJS API.', function()
	{
		expect(Object.keys(robot).sort()).toEqual(public_exports);
		expect(typeof robot.desktop.watchImageCatalog).toEqual('function');
		expect(typeof robot.image_search.findFuzzy).toEqual('function');
		expect(typeof robot.screen.captureDisplay).toEqual('function');
		expect(typeof robot.sleepRandom).toEqual('function');
		expect(typeof robot.showConfirmationDialog).toEqual('function');
		expect(typeof robot.registerHotkey).toEqual('function');
		expect(typeof robot.desktop.holdKeysDown).toEqual('function');
		expect(typeof robot.desktop.releaseAllHeldKeys).toEqual('function');
		expect(typeof robot.randomIntegerBetween).toEqual('function');
	});

	it('provides matching ESM named and default exports.', async function()
	{
		const esm = await import('../index.mjs');
		expect(esm.default).toBe(robot);
		expect(esm.desktop).toBe(robot.desktop);
		expect(esm.screen).toBe(robot.screen);
		expect(esm.image_search).toBe(robot.image_search);
		expect(esm.ImageCatalogWatcherError).toBe(robot.ImageCatalogWatcherError);
		expect(esm.DialogError).toBe(robot.DialogError);
		expect(esm.sleep).toBe(robot.sleep);
		expect(esm.showMessageBox).toBe(robot.showMessageBox);
		expect(esm.HotkeyError).toBe(robot.HotkeyError);
		expect(esm.HeldKeyError).toBe(robot.HeldKeyError);
		expect(esm.registerHotkey).toBe(robot.registerHotkey);
		expect(esm.randomIntegerBetween).toBe(robot.randomIntegerBetween);
	});
});
