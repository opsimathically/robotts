export type point_t = {
	x: number;
	y: number;
};

export type size_t = {
	width: number;
	height: number;
};

export interface duration_i {
	hours?: number;
	minutes?: number;
	seconds?: number;
	milliseconds?: number;
}

export interface sleep_options_i extends duration_i {
	signal?: AbortSignal;
}

export interface random_sleep_options_i {
	minimum: duration_i;
	maximum: duration_i;
	signal?: AbortSignal;
}

export interface message_box_options_i {
	message: string;
	title?: string;
	signal?: AbortSignal;
}

export type confirmation_dialog_result_t = "confirm" | "cancel";
export type dialog_error_code_t = "DIALOG_UNAVAILABLE" | "DIALOG_FAILED";
export type hotkey_callback_mode_t = "serial" | "concurrent";
export type hotkey_callback_error_policy_t = "unregister" | "continue";
export type hotkey_completion_reason_t = "unregistered" | "aborted" | "callback_error";
export type hotkey_error_code_t =
	| "HOTKEY_BACKEND_UNAVAILABLE"
	| "HOTKEY_BACKEND_ERROR"
	| "HOTKEY_CONFLICT"
	| "HOTKEY_INVALID_KEY"
	| "HOTKEY_MANAGER_CLOSED"
	| "HOTKEY_NOT_FOUND"
	| "HOTKEY_CALLBACK_FAILED"
	| "HOTKEY_CALLBACK_QUEUE_FULL"
	| "HOTKEY_ERROR_CALLBACK_FAILED";

export type hotkey_pressed_event_t = {
	type: "hotkey_pressed";
	name: string;
	hotkey: string;
	sequence: number;
	pressed_at_ms: number;
	server_timestamp_ms: number;
};

export type hotkey_error_event_t = {
	type: "hotkey_error";
	name: string;
	hotkey: string;
	error: HotkeyError;
};

export type hotkey_callback_t<extra_t> = (
	event: hotkey_pressed_event_t,
	robot: robotts_api_t,
	extra: extra_t
) => Promise<void> | void;

export type hotkey_error_callback_t<extra_t> = (
	event: hotkey_error_event_t,
	robot: robotts_api_t,
	extra: extra_t
) => Promise<void> | void;

export interface register_hotkey_options_i<extra_t = unknown> {
	name: string;
	hotkey: string;
	extra?: extra_t;
	on_pressed: hotkey_callback_t<extra_t>;
	on_error?: hotkey_error_callback_t<extra_t>;
	signal?: AbortSignal;
	callback_mode?: hotkey_callback_mode_t;
	callback_error_policy?: hotkey_callback_error_policy_t;
	max_pending_callbacks?: number;
}

export type hotkey_completion_t = {
	reason: hotkey_completion_reason_t;
	name: string;
	hotkey: string;
	error: unknown | null;
};

export interface hotkey_registration_i {
	readonly name: string;
	readonly hotkey: string;
	readonly active: boolean;
	readonly pendingCallbacks: number;
	readonly lastError: HotkeyError | null;
	readonly completion: Promise<hotkey_completion_t>;
	unregister(): Promise<hotkey_completion_t>;
}

export type held_key_error_code_t =
	| "HELD_KEYS_ACQUIRE_FAILED"
	| "HELD_KEYS_RELEASE_FAILED"
	| "HELD_KEYS_CLEANUP_FAILED";

export type held_key_input_t = string | readonly string[];

export interface hold_keys_options_i {
	keys: held_key_input_t;
}

export interface locked_hold_keys_options_i extends hold_keys_options_i {
	require_active?: boolean;
}

export type held_key_release_result_t = {
	chord: string;
	released_keys: readonly string[];
	shared_keys: readonly string[];
};

export type held_key_cleanup_result_t = {
	released_keys: readonly string[];
	unreleased_keys: readonly string[];
};

export interface held_key_handle_i {
	readonly chord: string;
	readonly keys: readonly string[];
	readonly target: window_target_t | null;
	readonly active: boolean;
	readonly pendingKeys: readonly string[];
	readonly lastError: HeldKeyError | null;
	releaseKeys(): held_key_release_result_t;
}

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
	supportsScreenCapture: boolean;
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
	| "WINDOW_IDENTITY_MISMATCH"
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
export type mouse_button_t = "left" | "middle" | "right";
export type input_toggle_state_t = "down" | "up";
export type key_modifier_t =
	| "alt"
	| "right_alt"
	| "command"
	| "control"
	| "left_control"
	| "right_control"
	| "shift"
	| "right_shift"
	| "none";
export type key_modifier_input_t = key_modifier_t | key_modifier_t[];

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
	button?: mouse_button_t;
	double?: boolean;
};

export type key_tap_target_params_t = window_target_query_t & {
	key: string;
	modifier?: key_modifier_input_t;
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
	button?: mouse_button_t;
	double?: boolean;
	require_active?: boolean;
};

export type mouse_click_path_params_t = mouse_path_target_params_t & {
	button?: mouse_button_t;
	double?: boolean;
};

export type locked_mouse_click_path_params_t = locked_mouse_path_params_t & {
	button?: mouse_button_t;
	double?: boolean;
};

export type locked_key_tap_params_t = {
	key: string;
	modifier?: key_modifier_input_t;
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

export type locked_window_observation_options_t = {
	require_active?: boolean;
};

export type locked_window_point_params_t = point_t & locked_window_observation_options_t;

export type locked_window_geometry_result_t = {
	target: window_target_t;
	window: window_t;
	geometry: rect_t;
	window_bounds: rect_t;
};

export type locked_window_point_result_t = {
	target: window_target_t;
	geometry: rect_t;
	window_position: point_t;
	global_position: point_t;
	inside_window: boolean;
};

export type locked_window_pixel_color_result_t = locked_window_point_result_t & {
	color: string;
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
	metrics?: fuzzy_image_search_metrics_t;
};

export type fuzzy_thread_count_t = number | "auto";

export type fuzzy_image_search_metrics_t = {
	candidate_offsets_evaluated: number;
	requested_thread_count: number;
	available_thread_count: number;
	effective_thread_count: number;
	candidate_scan_ms: number;
	verification_ms: number;
	thread_budget_wait_ms: number;
	elapsed_ms: number;
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
	thread_count?: fuzzy_thread_count_t;
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
	thread_count?: fuzzy_thread_count_t;
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
	button?: mouse_button_t;
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
	getGeometry(params?: locked_window_observation_options_t): locked_window_geometry_result_t;
	getMousePos(params?: locked_window_observation_options_t): locked_window_point_result_t;
	getPixelColor(params: locked_window_point_params_t): locked_window_pixel_color_result_t;
	toGlobalPoint(params: locked_window_point_params_t): locked_window_point_result_t;
	toWindowPoint(params: locked_window_point_params_t): locked_window_point_result_t;
	holdKeysDown(params: locked_hold_keys_options_i): held_key_handle_i;
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
	capture(): bitmap_t;
	capture(x: number, y: number, width: number, height: number): bitmap_t;
	captureWindow(params: capture_window_params_t): bitmap_t;
	captureDisplay(params: capture_display_params_t): bitmap_t;
}

export interface image_search_api_i {
	loadReference(params: load_image_reference_params_t): bitmap_t;
	find(params: image_search_params_t): image_search_result_t;
	findAll(params: image_search_all_params_t): image_search_result_t[];
	findFuzzy(params: fuzzy_image_search_params_t): image_search_result_t;
}

export type image_catalog_control_t = "CONTINUE" | "EXIT";
export type image_catalog_state_t = "starting" | "running" | "stopping" | "stopped";
export type image_catalog_match_mode_t = "exact" | "fuzzy";
export type image_catalog_callback_mode_t = "serial" | "concurrent";
export type image_catalog_repeat_mode_t = "every_sweep" | "changes_only" | "transition_only" | "throttled";
export type image_catalog_callback_error_policy_t = "stop" | "continue";

export type image_catalog_matching_options_t = {
	mode?: image_catalog_match_mode_t;
	threshold?: number;
	tolerance?: number;
	allow_partial_match?: boolean;
	minimum_overlap_ratio?: number;
	candidate_step?: number;
	max_results_per_image?: number;
	max_candidates_per_image?: number;
	thread_count?: fuzzy_thread_count_t;
};

export type image_catalog_repeat_options_t = {
	mode?: image_catalog_repeat_mode_t;
	interval_ms?: number;
};

export type image_catalog_set_options_t = {
	name: string;
	members: string[];
};

export type image_catalog_alias_t = {
	relative_path: string;
	absolute_path: string;
	file_sha256: string;
	file_size_bytes: number;
	mtime_ms: number;
};

export type image_catalog_image_t = {
	content_id: string;
	width: number;
	height: number;
	aliases: image_catalog_alias_t[];
};

export type image_catalog_display_t = rect_t & {
	id: number;
	name: string | null;
	is_primary: boolean;
};

export type image_catalog_display_source_t = {
	type: "displays";
	display_ids?: number[];
};

export type image_catalog_locked_window_source_t = {
	type: "locked_window";
	locked_window: locked_window_t;
	require_active?: boolean;
};

export type image_catalog_source_t =
	| image_catalog_display_source_t
	| image_catalog_locked_window_source_t;

export type image_catalog_display_event_source_t = {
	type: "displays";
	displays: image_catalog_display_t[];
};

export type image_catalog_locked_window_event_source_t = {
	type: "locked_window";
	locked_window: locked_window_t;
	require_active: boolean;
	target: window_target_t;
	geometry: rect_t;
};

export type image_catalog_event_source_t =
	| image_catalog_display_event_source_t
	| image_catalog_locked_window_event_source_t;

export type image_catalog_occurrence_base_t = {
	display: image_catalog_display_t;
	display_position: point_t;
	global_position: point_t;
	size: size_t;
	score: number;
	overlap_ratio: number;
};

export type image_catalog_display_occurrence_t = image_catalog_occurrence_base_t & {
	source_type: "display";
};

export type image_catalog_locked_window_occurrence_t = image_catalog_occurrence_base_t & {
	source_type: "locked_window";
	window_position: point_t;
};

export type image_catalog_occurrence_t =
	| image_catalog_display_occurrence_t
	| image_catalog_locked_window_occurrence_t;

export type image_catalog_match_t = {
	image: image_catalog_image_t;
	occurrences: image_catalog_occurrence_t[];
};

export type image_catalog_set_member_t = image_catalog_match_t;

export type image_catalog_set_match_t = {
	name: string;
	members: image_catalog_set_member_t[];
};

export type image_catalog_diagnostic_t = {
	code: string;
	message: string;
	path?: string;
	set_name?: string;
	member?: string;
};

export type image_catalog_native_metrics_t = {
	catalog_images: number;
	fingerprint_entries: number;
	haystack_pixels_scanned: number;
	index_buckets_visited: number;
	candidate_offsets_generated: number;
	candidate_offsets_verified: number;
	verification_pixels_compared: number;
	fingerprint_collisions_tested: number;
	candidate_votes_recorded: number;
	evidence_cells_initialized: number;
	evidence_cells_examined: number;
	workspace_bytes: number;
	requested_thread_count: number;
	available_thread_count: number;
	effective_thread_count: number;
	candidate_scan_ms: number;
	candidate_extraction_ms: number;
	verification_ms: number;
	bitmap_copy_ms: number;
	result_construction_ms: number;
	queue_ms: number;
	thread_budget_wait_ms: number;
	capture_ms: number;
	elapsed_ms: number;
};

export type image_catalog_statistics_t = {
	state: image_catalog_state_t;
	uptime_ms: number;
	catalog_generation: number;
	catalog_images: number;
	catalog_aliases: number;
	decoded_bytes: number;
	pending_callbacks: number;
	sweeps: number;
	match_sweeps: number;
	no_match_sweeps: number;
	match_occurrences: number;
	satisfied_image_sets: number;
	catalog_rebuilds: number;
	catalog_errors: number;
	operational_errors: number;
	callback_errors: number;
	captures: number;
	last_sweep_duration_ms: number | null;
	last_sweep_finished_at_ms: number | null;
	native: image_catalog_native_metrics_t;
};

export type image_catalog_before_sweep_event_t = {
	type: "before_sweep";
	generation: number;
	statistics: image_catalog_statistics_t;
	source: image_catalog_event_source_t;
};

export type image_catalog_matches_event_t = {
	type: "matches_found";
	generation: number;
	matches: image_catalog_match_t[];
	statistics: image_catalog_statistics_t;
	native_metrics: image_catalog_native_metrics_t;
	source: image_catalog_event_source_t;
};

export type image_catalog_no_matches_event_t = {
	type: "no_matches_found";
	reason: "empty_catalog" | "no_match";
	generation: number;
	statistics: image_catalog_statistics_t;
	native_metrics: image_catalog_native_metrics_t;
	source: image_catalog_event_source_t;
};

export type image_catalog_sets_event_t = {
	type: "image_sets_found";
	generation: number;
	sets: image_catalog_set_match_t[];
	statistics: image_catalog_statistics_t;
	source: image_catalog_event_source_t;
};

export type image_catalog_changed_event_t = {
	type: "catalog_changed";
	generation: number;
	images: image_catalog_image_t[];
	added_paths: string[];
	changed_paths: string[];
	deleted_paths: string[];
	diagnostics: image_catalog_diagnostic_t[];
	statistics: image_catalog_statistics_t;
	source: image_catalog_event_source_t;
};

export type image_catalog_error_event_t = {
	type: "error";
	error: ImageCatalogWatcherError;
	statistics: image_catalog_statistics_t;
	source: image_catalog_event_source_t;
};

export type image_catalog_callback_t<event_t, extra_t> = (
	event: event_t,
	robot: robotts_api_t,
	extra: extra_t
) => Promise<image_catalog_control_t | void> | image_catalog_control_t | void;

export type image_catalog_watch_base_options_t<extra_t = unknown> = {
	image_dir: string;
	check_period_ms?: number;
	catalog_debounce_ms?: number;
	max_file_size_bytes?: number;
	max_catalog_images?: number;
	max_total_decoded_bytes?: number;
	matching?: image_catalog_matching_options_t;
	repeat?: image_catalog_repeat_options_t;
	callback_mode?: image_catalog_callback_mode_t;
	max_pending_callbacks?: number;
	callback_error_policy?: image_catalog_callback_error_policy_t;
	max_consecutive_errors?: number;
	image_sets?: image_catalog_set_options_t[];
	extra?: extra_t;
	signal?: AbortSignal;
	on_before_sweep?: image_catalog_callback_t<image_catalog_before_sweep_event_t, extra_t>;
	on_matches_found: image_catalog_callback_t<image_catalog_matches_event_t, extra_t>;
	on_no_matches_found?: image_catalog_callback_t<image_catalog_no_matches_event_t, extra_t>;
	on_image_sets_found?: image_catalog_callback_t<image_catalog_sets_event_t, extra_t>;
	on_catalog_changed?: image_catalog_callback_t<image_catalog_changed_event_t, extra_t>;
	on_error?: image_catalog_callback_t<image_catalog_error_event_t, extra_t>;
};

export type image_catalog_watch_options_t<extra_t = unknown> =
	image_catalog_watch_base_options_t<extra_t> & (
		| {
			source?: undefined;
			display_ids?: number[];
		}
		| {
			source: image_catalog_source_t;
			display_ids?: never;
		}
	);

export type image_catalog_completion_t = {
	reason: "stopped" | "aborted" | "callback_exit";
	statistics: image_catalog_statistics_t;
};

export interface image_catalog_watcher_i {
	readonly completion: Promise<image_catalog_completion_t>;
	getState(): image_catalog_state_t;
	getStatistics(): image_catalog_statistics_t;
	stop(): Promise<image_catalog_completion_t>;
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
	holdKeysDown(params: hold_keys_options_i): held_key_handle_i;
	releaseAllHeldKeys(): held_key_cleanup_result_t;
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
	watchImageCatalog<extra_t = unknown>(params: image_catalog_watch_options_t<extra_t>): Promise<image_catalog_watcher_i>;
}

export class ScopedWindowError extends Error {
	code: scoped_window_error_code_t;
	details: scoped_window_error_details_t | null;
}

export class ImageCatalogWatcherError extends Error {
	code: string;
	details: Record<string, unknown> | null;
	recoverable: boolean;
}

export class DialogError extends Error {
	constructor(params: {
		message: string;
		code: dialog_error_code_t;
		details?: Record<string, unknown> | null;
	});
	code: dialog_error_code_t;
	details: Record<string, unknown> | null;
}

export class HotkeyError extends Error {
	constructor(params: {
		message: string;
		code: hotkey_error_code_t;
		details?: Record<string, unknown> | null;
		cause?: unknown;
	});
	code: hotkey_error_code_t;
	details: Record<string, unknown> | null;
}

export class HeldKeyError extends Error {
	constructor(params: {
		message: string;
		code: held_key_error_code_t;
		details?: Record<string, unknown> | null;
		cause?: unknown;
	});
	code: held_key_error_code_t;
	details: Record<string, unknown> | null;
}

export function registerHotkey<extra_t = unknown>(
	params: register_hotkey_options_i<extra_t>
): Promise<hotkey_registration_i>;
export function randomIntegerBetween(min_value: number, max_value: number): number;
export function sleep(params: sleep_options_i): Promise<void>;
export function sleepRandom(params: random_sleep_options_i): Promise<void>;
export function showMessageBox(params: message_box_options_i): Promise<void>;
export function showConfirmationDialog(params: message_box_options_i): Promise<confirmation_dialog_result_t>;
export function setKeyboardDelay(ms: number): void;
export function keyTap(key: string, modifier?: key_modifier_input_t): void;
export function keyToggle(key: string, down: input_toggle_state_t, modifier?: key_modifier_input_t): void;
export function unicodeTap(value: number): void;
export function typeString(value: string): void;
export function typeStringDelayed(value: string, cpm: number): void;
export function typeStringHumanized(params: typing_humanized_params_t): typing_result_t;
export function setMouseDelay(delay: number): void;
export function updateScreenMetrics(): void;
export function moveMouse(x: number, y: number): void;
export function moveMouseSmooth(x: number, y: number, speed?: number): void;
export function mouseClick(button?: mouse_button_t, double?: boolean): void;
export function doubleClickHumanized(params?: double_click_humanized_params_t): double_click_result_t;
export function mouseToggle(down?: input_toggle_state_t, button?: mouse_button_t): void;
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
export type ImageCatalogWatcher = image_catalog_watcher_i;

export type robotts_api_t = {
	ScopedWindowError: typeof ScopedWindowError;
	ImageCatalogWatcherError: typeof ImageCatalogWatcherError;
	DialogError: typeof DialogError;
	HotkeyError: typeof HotkeyError;
	HeldKeyError: typeof HeldKeyError;
	screen: screen_api_i;
	image_search: image_search_api_i;
	desktop: desktop_api_i;
	registerHotkey<extra_t = unknown>(
		params: register_hotkey_options_i<extra_t>
	): Promise<hotkey_registration_i>;
	randomIntegerBetween(min_value: number, max_value: number): number;
	sleep(params: sleep_options_i): Promise<void>;
	sleepRandom(params: random_sleep_options_i): Promise<void>;
	showMessageBox(params: message_box_options_i): Promise<void>;
	showConfirmationDialog(params: message_box_options_i): Promise<confirmation_dialog_result_t>;
	setKeyboardDelay(ms: number): void;
	keyTap(key: string, modifier?: key_modifier_input_t): void;
	keyToggle(key: string, down: input_toggle_state_t, modifier?: key_modifier_input_t): void;
	unicodeTap(value: number): void;
	typeString(value: string): void;
	typeStringDelayed(value: string, cpm: number): void;
	typeStringHumanized(params: typing_humanized_params_t): typing_result_t;
	setMouseDelay(delay: number): void;
	updateScreenMetrics(): void;
	moveMouse(x: number, y: number): void;
	moveMouseSmooth(x: number, y: number, speed?: number): void;
	mouseClick(button?: mouse_button_t, double?: boolean): void;
	doubleClickHumanized(params?: double_click_humanized_params_t): double_click_result_t;
	mouseToggle(down?: input_toggle_state_t, button?: mouse_button_t): void;
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
