export type point_t = {
	x: number;
	y: number;
};

export type size_t = {
	width: number;
	height: number;
};

export type rect_t = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type bitmap_t = {
	width: number;
	height: number;
	image: Buffer;
	byteWidth: number;
	bitsPerPixel: number;
	bytesPerPixel: number;
	colorAt(x: number, y: number): string;
};

export type display_t = rect_t & {
	id: number;
	name: string | null;
	isPrimary: boolean;
};

export type workspace_t = {
	id: number;
	name: string | null;
	isCurrent: boolean;
};

export type window_t = {
	windowId: string;
	title: string | null;
	className: string | null;
	instanceName: string | null;
	pid: number | null;
	workspaceId: number | null;
	geometry: rect_t;
	isActive: boolean;
	isVisible: boolean;
};

export type desktop_session_t = {
	sessionType: string;
	xDisplayName: string;
	waylandDisplayName: string | null;
};

export type desktop_capabilities_t = {
	backend: string;
	supportsGlobalInputInjection: boolean;
	supportsWindowDiscovery: boolean;
	supportsMonitorGeometry: boolean;
	supportsWorkspaceIdentity: boolean;
	supportsFocusChanges: boolean;
	supportsStrictTargetVerification: boolean;
};

export type desktop_state_t = {
	session: desktop_session_t;
	capabilities: desktop_capabilities_t;
	desktopBounds: rect_t;
	displays: display_t[];
	workspaces: workspace_t[];
	currentWorkspaceId: number | null;
	activeWindow: window_t | null;
	windows: window_t[];
};

export type window_target_t = {
	targetType: "window";
	windowId: string;
	title: string | null;
	className: string | null;
	instanceName: string | null;
	pid: number | null;
	workspaceId: number | null;
	displayId: number | null;
};

export type window_target_query_t = {
	window_id?: string;
	title?: string;
	title_includes?: string;
	class_name?: string;
	instance_name?: string;
	pid?: number;
	workspace_id?: number;
	monitor_id?: number;
	active_only?: boolean;
	require_active?: boolean;
	target?: window_target_t;
};

export type locked_window_options_t = window_target_query_t;

export type mouse_path_style_t = "linear" | "wavy" | "human_like";
export type mouse_speed_profile_t = "constant" | "humanized";

export type mouse_path_options_t = {
	style?: mouse_path_style_t;
	duration_ms?: number;
	steps?: number;
	random_seed?: string | number;
	include_effective_seed?: boolean;
	randomization_amount?: number;
	speed_profile?: mouse_speed_profile_t;
	speed_variation_amount?: number;
	min_step_delay_ms?: number;
	max_step_delay_ms?: number;
	wave_amplitude?: number;
	wave_frequency?: number;
	humanization_amount?: number;
};

export type target_point_params_t = window_target_query_t & {
	x: number;
	y: number;
	relative_to?: "window" | "global";
};

export type mouse_click_target_params_t = target_point_params_t & {
	button?: string;
	double?: boolean;
};

export type key_tap_target_params_t = window_target_query_t & {
	key: string;
	modifier?: string | string[];
};

export type type_string_target_params_t = window_target_query_t & {
	text: string;
};

export type locked_mouse_params_t = {
	x: number;
	y: number;
	require_active?: boolean;
};

export type mouse_path_target_params_t = window_target_query_t & mouse_path_options_t & {
	x: number;
	y: number;
	relative_to?: "window" | "global";
	require_active?: boolean;
};

export type locked_mouse_path_params_t = locked_mouse_params_t & mouse_path_options_t;

export type locked_mouse_click_params_t = {
	x?: number;
	y?: number;
	button?: string;
	double?: boolean;
	require_active?: boolean;
};

export type mouse_click_path_params_t = mouse_path_target_params_t & {
	button?: string;
	double?: boolean;
};

export type locked_mouse_click_path_params_t = locked_mouse_path_params_t & {
	button?: string;
	double?: boolean;
};

export type locked_key_tap_params_t = {
	key: string;
	modifier?: string | string[];
};

export type locked_type_string_params_t = {
	text: string;
};

export type locked_capture_params_t = {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	require_active?: boolean;
};

export type mouse_path_result_t = point_t & {
	effective_seed?: string | number;
};

export type locked_window_t = {
	getTarget(): window_target_t;
	assert(): window_target_t;
	focus(): window_target_t;
	moveMouse(params: locked_mouse_params_t): void;
	moveMousePath(params: locked_mouse_path_params_t): mouse_path_result_t;
	mouseClick(params?: locked_mouse_click_params_t): void;
	mouseClickPath(params: locked_mouse_click_path_params_t): mouse_path_result_t;
	keyTap(params: locked_key_tap_params_t): void;
	typeString(params: locked_type_string_params_t): void;
	capture(params?: locked_capture_params_t): bitmap_t;
};

export type capture_window_params_t = window_target_query_t & {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

export type capture_display_params_t = {
	display_id: number;
};

export interface screen_api_i {
	capture(x?: number, y?: number, width?: number, height?: number): bitmap_t;
	captureWindow(params: capture_window_params_t): bitmap_t;
	captureDisplay(params: capture_display_params_t): bitmap_t;
}

export interface desktop_api_i {
	getState(): desktop_state_t;
	getCapabilities(): desktop_capabilities_t;
	listDisplays(): display_t[];
	listWorkspaces(): workspace_t[];
	listWindows(): window_t[];
	getActiveWindow(): window_t | null;
	resolveWindowTarget(params: window_target_query_t): window_target_t;
	assertWindowTarget(params: window_target_query_t): window_target_t;
	lockWindow(params: locked_window_options_t): locked_window_t;
	focusWindow(params: window_target_query_t): window_target_t;
	moveMouseTarget(params: target_point_params_t): void;
	moveMousePath(params: mouse_path_target_params_t): mouse_path_result_t;
	mouseClickTarget(params: mouse_click_target_params_t): void;
	mouseClickPath(params: mouse_click_path_params_t): mouse_path_result_t;
	keyTapTarget(params: key_tap_target_params_t): void;
	typeStringTarget(params: type_string_target_params_t): void;
}

export function setKeyboardDelay(ms: number): void;
export function keyTap(key: string, modifier?: string | string[]): void;
export function keyToggle(key: string, down: string, modifier?: string | string[]): void;
export function unicodeTap(value: number): void;
export function typeString(value: string): void;
export function typeStringDelayed(value: string, cpm: number): void;
export function setMouseDelay(delay: number): void;
export function updateScreenMetrics(): void;
export function moveMouse(x: number, y: number): void;
export function moveMouseSmooth(x: number, y: number, speed?: number): void;
export function mouseClick(button?: string, double?: boolean): void;
export function mouseToggle(down?: string, button?: string): void;
export function dragMouse(x: number, y: number): void;
export function scrollMouse(x: number, y: number): void;
export function getMousePos(): point_t;
export function getPixelColor(x: number, y: number): string;
export function getScreenSize(): size_t;
export function getDesktopState(): desktop_state_t;
export function focusWindow(window_id: string): void;

export const screen: screen_api_i;
export const desktop: desktop_api_i;

export type Bitmap = bitmap_t;
export type Screen = screen_api_i;
export type LockedWindow = locked_window_t;

export type robotts_api_t = {
	screen: screen_api_i;
	desktop: desktop_api_i;
	setKeyboardDelay(ms: number): void;
	keyTap(key: string, modifier?: string | string[]): void;
	keyToggle(key: string, down: string, modifier?: string | string[]): void;
	unicodeTap(value: number): void;
	typeString(value: string): void;
	typeStringDelayed(value: string, cpm: number): void;
	setMouseDelay(delay: number): void;
	updateScreenMetrics(): void;
	moveMouse(x: number, y: number): void;
	moveMouseSmooth(x: number, y: number, speed?: number): void;
	mouseClick(button?: string, double?: boolean): void;
	mouseToggle(down?: string, button?: string): void;
	dragMouse(x: number, y: number): void;
	scrollMouse(x: number, y: number): void;
	getMousePos(): point_t;
	getPixelColor(x: number, y: number): string;
	getScreenSize(): size_t;
	getDesktopState(): desktop_state_t;
	focusWindow(window_id: string): void;
};

declare const robot: robotts_api_t;

export default robot;
