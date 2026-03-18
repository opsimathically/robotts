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
export type image_reference_t =
	| {
			bitmap: bitmap_t;
	  }
	| {
			png_path: string;
			use_cache?: boolean;
	  };

export type image_search_screen_source_t = {
	type: "screen";
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

export type image_search_display_source_t = {
	type: "display";
	display_id: number;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

export type image_search_region_source_t = {
	type: "region";
	x: number;
	y: number;
	width: number;
	height: number;
};

export type image_search_window_source_t = window_target_query_t & {
	type: "window";
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

export type image_search_bitmap_source_t = {
	type: "bitmap";
	bitmap: bitmap_t;
};

export type image_search_locked_window_source_t = {
	type: "locked_window";
	locked_window: locked_window_t;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	require_active?: boolean;
};

export type image_search_source_t =
	| image_search_screen_source_t
	| image_search_display_source_t
	| image_search_region_source_t
	| image_search_window_source_t
	| image_search_bitmap_source_t
	| image_search_locked_window_source_t;

export type scoped_window_error_code_t =
	| "WINDOW_VERIFICATION_UNSUPPORTED"
	| "WINDOW_DISCOVERY_UNSUPPORTED"
	| "WINDOW_NOT_FOUND"
	| "WINDOW_NOT_ACTIVE"
	| "WINDOW_FOCUS_FAILED"
	| "WINDOW_TARGET_NOT_FOUND"
	| "WINDOW_TARGET_AMBIGUOUS"
	| "WINDOW_GEOMETRY_UNAVAILABLE"
	| "CLIPBOARD_UNAVAILABLE"
	| "CLIPBOARD_TIMEOUT";

export type scoped_window_error_details_t = {
	target?: window_target_t | null;
	window?: window_t | null;
	active_window?: window_t | null;
	query?: window_target_query_t;
	match_count?: number;
	session?: desktop_session_t;
	capabilities?: desktop_capabilities_t;
	timeout_ms?: number;
	last_method?: string | null;
	native_error?: string | null;
};

export type mouse_path_style_t = "linear" | "wavy" | "human_like";
export type mouse_speed_profile_t = "constant" | "humanized";
export type typing_humanization_level_t = "low" | "medium" | "high";

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
	require_active?: boolean;
};

export type type_string_target_params_t = window_target_query_t & {
	text: string;
	require_active?: boolean;
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
	require_active?: boolean;
};

export type locked_type_string_params_t = {
	text: string;
	require_active?: boolean;
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

export type image_search_result_t = {
	found: boolean;
	score: number | null;
	location: point_t | null;
	size: size_t | null;
	overlap_ratio: number | null;
	global_location: point_t | null;
	source_type: string;
	reference_type: "bitmap" | "png_path";
	display_id: number | null;
	target: window_target_t | null;
};

export type image_search_params_t = {
	source: image_search_source_t;
	reference: image_reference_t;
	tolerance?: number;
};

export type image_search_all_params_t = image_search_params_t & {
	max_results?: number;
};

export type fuzzy_image_search_params_t = image_search_params_t & {
	threshold?: number;
	allow_partial_match?: boolean;
	minimum_overlap_ratio?: number;
	sample_step?: number;
};

export type image_match_anchor_t = "center" | "top_left";

export type image_match_move_options_t = {
	match_anchor?: image_match_anchor_t;
	offset_x?: number;
	offset_y?: number;
};

export type image_move_params_t = image_search_params_t & image_match_move_options_t;
export type image_move_path_params_t = image_move_params_t & mouse_path_options_t;
export type fuzzy_image_move_params_t = fuzzy_image_search_params_t & image_match_move_options_t;
export type fuzzy_image_move_path_params_t = fuzzy_image_move_params_t & mouse_path_options_t;

export type image_mouse_move_result_t = {
	found: boolean;
	moved: boolean;
	match: image_search_result_t;
	destination: point_t | null;
	effective_seed?: string | number;
};

export type locked_image_search_params_t = {
	reference: image_reference_t;
	tolerance?: number;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	require_active?: boolean;
};

export type locked_image_search_all_params_t = locked_image_search_params_t & {
	max_results?: number;
};

export type locked_fuzzy_image_search_params_t = locked_image_search_params_t & {
	threshold?: number;
	allow_partial_match?: boolean;
	minimum_overlap_ratio?: number;
	sample_step?: number;
};

export type locked_image_move_params_t = locked_image_search_params_t & image_match_move_options_t;
export type locked_image_move_path_params_t = locked_image_move_params_t & mouse_path_options_t;
export type locked_fuzzy_image_move_params_t = locked_fuzzy_image_search_params_t & image_match_move_options_t;
export type locked_fuzzy_image_move_path_params_t = locked_fuzzy_image_move_params_t & mouse_path_options_t;

export type load_image_reference_params_t = {
	png_path: string;
	use_cache?: boolean;
};

export type typing_humanized_params_t = {
	text: string;
	level?: typing_humanization_level_t;
	random_seed?: string | number;
	include_effective_seed?: boolean;
	min_delay_ms?: number;
	max_delay_ms?: number;
	mistake_probability?: number;
	require_active?: boolean;
};

export type typing_humanized_target_params_t = window_target_query_t & typing_humanized_params_t;

export type typing_result_t = {
	text: string;
	elapsed_ms: number;
	effective_seed?: string | number;
};

export type double_click_humanized_params_t = {
	button?: string;
	level?: typing_humanization_level_t;
	random_seed?: string | number;
	include_effective_seed?: boolean;
	min_interval_ms?: number;
	max_interval_ms?: number;
};

export type double_click_target_humanized_params_t = window_target_query_t & double_click_humanized_params_t & {
	x?: number;
	y?: number;
	relative_to?: "window" | "global";
	require_active?: boolean;
};

export type locked_double_click_humanized_params_t = double_click_humanized_params_t & {
	x?: number;
	y?: number;
	require_active?: boolean;
};

export type double_click_result_t = {
	interval_ms: number;
	effective_seed?: string | number;
};

export type clipboard_copy_context_t = {
	target: window_target_t;
	window: window_t;
	session: desktop_session_t;
	backend: string;
	timestamp: string;
	copy_method: string;
	clear_method: string | null;
	clipboard_format: "text/plain";
};

export type clipboard_copy_result_t = {
	data: string;
	context: clipboard_copy_context_t;
};

export type clipboard_copy_callback_t<return_t = unknown> = (result: clipboard_copy_result_t) => Promise<return_t> | return_t;

export type clipboard_copy_params_t<return_t = clipboard_copy_result_t> = window_target_query_t & {
	timeout_ms?: number;
	poll_interval_ms?: number;
	require_active?: boolean;
	clear_clipboard?: boolean;
	callback?: clipboard_copy_callback_t<return_t>;
};

export type locked_clipboard_copy_params_t<return_t = clipboard_copy_result_t> = {
	timeout_ms?: number;
	poll_interval_ms?: number;
	require_active?: boolean;
	clear_clipboard?: boolean;
	callback?: clipboard_copy_callback_t<return_t>;
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
	typeStringHumanized(params: typing_humanized_params_t): typing_result_t;
	doubleClickHumanized(params?: locked_double_click_humanized_params_t): double_click_result_t;
	copySelection<return_t = clipboard_copy_result_t>(params?: locked_clipboard_copy_params_t<return_t>): Promise<return_t | clipboard_copy_result_t>;
	findImage(params: locked_image_search_params_t): image_search_result_t;
	findAllImages(params: locked_image_search_all_params_t): image_search_result_t[];
	findImageFuzzy(params: locked_fuzzy_image_search_params_t): image_search_result_t;
	moveMouseToImage(params: locked_image_move_params_t): image_mouse_move_result_t;
	moveMousePathToImage(params: locked_image_move_path_params_t): image_mouse_move_result_t;
	moveMouseToImageFuzzy(params: locked_fuzzy_image_move_params_t): image_mouse_move_result_t;
	moveMousePathToImageFuzzy(params: locked_fuzzy_image_move_path_params_t): image_mouse_move_result_t;
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

export interface image_search_api_i {
	loadReference(params: load_image_reference_params_t): bitmap_t;
	find(params: image_search_params_t): image_search_result_t;
	findAll(params: image_search_all_params_t): image_search_result_t[];
	findFuzzy(params: fuzzy_image_search_params_t): image_search_result_t;
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
	moveMouseToImage(params: image_move_params_t): image_mouse_move_result_t;
	moveMousePathToImage(params: image_move_path_params_t): image_mouse_move_result_t;
	moveMouseToImageFuzzy(params: fuzzy_image_move_params_t): image_mouse_move_result_t;
	moveMousePathToImageFuzzy(params: fuzzy_image_move_path_params_t): image_mouse_move_result_t;
	mouseClickTarget(params: mouse_click_target_params_t): void;
	mouseClickPath(params: mouse_click_path_params_t): mouse_path_result_t;
	doubleClickTargetHumanized(params: double_click_target_humanized_params_t): double_click_result_t;
	keyTapTarget(params: key_tap_target_params_t): void;
	typeStringTarget(params: type_string_target_params_t): void;
	typeStringTargetHumanized(params: typing_humanized_target_params_t): typing_result_t;
	copySelectionFromTarget<return_t = clipboard_copy_result_t>(params: clipboard_copy_params_t<return_t>): Promise<return_t | clipboard_copy_result_t>;
}

export class ScopedWindowError extends Error {
	code: scoped_window_error_code_t;
	details: scoped_window_error_details_t | null;
}

export function setKeyboardDelay(ms: number): void;
export function keyTap(key: string, modifier?: string | string[]): void;
export function keyToggle(key: string, down: string, modifier?: string | string[]): void;
export function unicodeTap(value: number): void;
export function typeString(value: string): void;
export function typeStringDelayed(value: string, cpm: number): void;
export function typeStringHumanized(params: typing_humanized_params_t): typing_result_t;
export function setMouseDelay(delay: number): void;
export function updateScreenMetrics(): void;
export function moveMouse(x: number, y: number): void;
export function moveMouseSmooth(x: number, y: number, speed?: number): void;
export function mouseClick(button?: string, double?: boolean): void;
export function doubleClickHumanized(params?: double_click_humanized_params_t): double_click_result_t;
export function mouseToggle(down?: string, button?: string): void;
export function dragMouse(x: number, y: number): void;
export function scrollMouse(x: number, y: number): void;
export function getMousePos(): point_t;
export function getPixelColor(x: number, y: number): string;
export function getScreenSize(): size_t;
export function getDesktopState(): desktop_state_t;
export function focusWindow(window_id: string): void;

export const screen: screen_api_i;
export const image_search: image_search_api_i;
export const desktop: desktop_api_i;

export type Bitmap = bitmap_t;
export type ImageSearch = image_search_api_i;
export type Screen = screen_api_i;
export type LockedWindow = locked_window_t;

export type robotts_api_t = {
	ScopedWindowError: typeof ScopedWindowError;
	screen: screen_api_i;
	image_search: image_search_api_i;
	desktop: desktop_api_i;
	setKeyboardDelay(ms: number): void;
	keyTap(key: string, modifier?: string | string[]): void;
	keyToggle(key: string, down: string, modifier?: string | string[]): void;
	unicodeTap(value: number): void;
	typeString(value: string): void;
	typeStringDelayed(value: string, cpm: number): void;
	typeStringHumanized(params: typing_humanized_params_t): typing_result_t;
	setMouseDelay(delay: number): void;
	updateScreenMetrics(): void;
	moveMouse(x: number, y: number): void;
	moveMouseSmooth(x: number, y: number, speed?: number): void;
	mouseClick(button?: string, double?: boolean): void;
	doubleClickHumanized(params?: double_click_humanized_params_t): double_click_result_t;
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
