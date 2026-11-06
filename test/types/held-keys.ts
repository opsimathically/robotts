import robot, {
	HeldKeyError,
	held_key_cleanup_result_t,
	held_key_handle_i,
	held_key_release_result_t,
	hold_keys_options_i,
	locked_hold_keys_options_i,
	window_target_t
} from "../..";

function VerifyHeldKeyTypes(): void
{
	const desktop_options: hold_keys_options_i = {
		keys: ["ctrl", "shift"] as const
	};
	const desktop_hold: held_key_handle_i = robot.desktop.holdKeysDown(desktop_options);
	const chord: string = desktop_hold.chord;
	const normalized_keys: readonly string[] = desktop_hold.keys;
	const pending_keys: readonly string[] = desktop_hold.pendingKeys;
	const active: boolean = desktop_hold.active;
	const target_is_null: null | window_target_t = desktop_hold.target;
	const previous_error: HeldKeyError | null = desktop_hold.lastError;
	const release_result: held_key_release_result_t = desktop_hold.releaseKeys();

	const locked_window = robot.desktop.lockWindow({
		title_includes: "Text Editor"
	});
	const locked_options: locked_hold_keys_options_i = {
		keys: ["control", "alt", "a"],
		require_active: true
	};
	const locked_hold = locked_window.holdKeysDown(locked_options);
	const locked_target: window_target_t | null = locked_hold.target;
	const locked_release = locked_hold.releaseKeys();

	const cleanup_result: held_key_cleanup_result_t = robot.desktop.releaseAllHeldKeys();

	try
	{
		robot.desktop.holdKeysDown({ keys: "control+shift" });
	}
	catch (error)
	{
		if (error instanceof HeldKeyError)
		{
			console.error(error.code, error.details);
		}
	}

	console.log(
		chord,
		normalized_keys,
		pending_keys,
		active,
		target_is_null,
		previous_error,
		release_result,
		locked_target,
		locked_release,
		cleanup_result
	);
}

void VerifyHeldKeyTypes;
