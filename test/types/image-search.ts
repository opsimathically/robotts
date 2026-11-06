import robot, { bitmap_t, image_search_result_t } from "../..";

function VerifyFuzzyImageSearchTypes(bitmap: bitmap_t): void
{
	const result: image_search_result_t = robot.image_search.findFuzzy({
		source: {
			type: "bitmap",
			bitmap: bitmap
		},
		reference: {
			bitmap: bitmap
		},
		threshold: 0.9,
		tolerance: 0.1,
		thread_count: 4
	});

	const automatic = robot.image_search.findFuzzy({
		source: {
			type: "bitmap",
			bitmap: bitmap
		},
		reference: {
			bitmap: bitmap
		},
		thread_count: "auto"
	});

	console.log(
		result.metrics?.effective_thread_count,
		automatic.metrics?.candidate_offsets_evaluated
	);
}

void VerifyFuzzyImageSearchTypes;
