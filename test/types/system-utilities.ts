import robot, {
	DialogError,
	type confirmation_dialog_result_t,
	type duration_i,
	showConfirmationDialog,
	showMessageBox,
	randomIntegerBetween,
	sleep,
	sleepRandom
} from "@opsimathically/robotts";

const duration: duration_i = {
	hours: 0,
	minutes: 1,
	seconds: 2,
	milliseconds: 300
};

async function UseSystemUtilities(): Promise<void>
{
	const signed_random_value: number = randomIntegerBetween(-10, 10);
	const fixed_random_value: number = robot.randomIntegerBetween(7, 7);
	console.log(signed_random_value, fixed_random_value);

	await sleep({...duration});
	await robot.sleep({
		seconds: 1,
		signal: new AbortController().signal
	});
	await sleepRandom({
		minimum: {seconds: 1},
		maximum: {seconds: 2, milliseconds: 500}
	});
	await showMessageBox({
		title: "RobotTS",
		message: "The operation completed."
	});

	const result: confirmation_dialog_result_t = await showConfirmationDialog({
		message: "Continue?"
	});

	if (result === "confirm")
	{
		await robot.showMessageBox({message: "Confirmed."});
	}
}

const dialog_error: DialogError = new DialogError({
	message: "Unavailable",
	code: "DIALOG_UNAVAILABLE"
});
void dialog_error.code;
void UseSystemUtilities;
