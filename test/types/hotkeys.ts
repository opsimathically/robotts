import robot, {
	HotkeyError,
	registerHotkey,
	type hotkey_completion_t,
	type hotkey_pressed_event_t,
	type hotkey_registration_i
} from "@opsimathically/robotts";

type application_context_t = {
	workflow_id: string;
	attempt: number;
};

async function UseGlobalHotkeys(): Promise<void>
{
	const registration: hotkey_registration_i = await registerHotkey<application_context_t>({
		name: "checkout.confirm",
		hotkey: "ctrl+j",
		extra: {
			workflow_id: "checkout",
			attempt: 1
		},
		callback_mode: "serial",
		callback_error_policy: "unregister",
		max_pending_callbacks: 8,
		async on_pressed(event, robot_instance, extra)
		{
			const typed_event: hotkey_pressed_event_t = event;
			console.log(typed_event.name, typed_event.hotkey, typed_event.sequence);
			console.log(extra.workflow_id, extra.attempt);
			await robot_instance.sleep({milliseconds: 1});
		},
		on_error(event, _robot_instance, extra)
		{
			const error: HotkeyError = event.error;
			console.error(extra.workflow_id, error.code);
		}
	});

	console.log(registration.name, registration.hotkey, registration.active);
	const completion: hotkey_completion_t = await registration.unregister();
	console.log(completion.reason);

	const controller = new AbortController();
	const abortable = await robot.registerHotkey({
		name: "abortable",
		hotkey: "super+f9",
		signal: controller.signal,
		on_pressed()
		{
			console.log("pressed");
		}
	});
	controller.abort();
	await abortable.completion;
}

void UseGlobalHotkeys;
