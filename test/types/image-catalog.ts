import robot, {
	ImageCatalogWatcherError,
	image_catalog_locked_window_occurrence_t,
	image_catalog_watch_options_t,
	image_catalog_watcher_i
} from "../..";

type watcher_extra_t = {
	request_id: string;
};

async function VerifyImageCatalogTypes(): Promise<void>
{
	const abort_controller = new AbortController();
	const options: image_catalog_watch_options_t<watcher_extra_t> = {
		image_dir: "./fixtures",
		matching: {
			mode: "fuzzy",
			threshold: 0.9,
			tolerance: 0.1,
			thread_count: "auto"
		},
		repeat: {
			mode: "changes_only"
		},
		image_sets: [{
			name: "dialog",
			members: ["dialog/title.png", "dialog/confirm.png"]
		}],
		extra: {
			request_id: "request-1"
		},
		signal: abort_controller.signal,
		on_matches_found: function(event, robot_instance, extra)
		{
			const content_id: string = event.matches[0].image.content_id;
			const global_x: number = event.matches[0].occurrences[0].global_position.x;
			const effective_threads: number = event.native_metrics.effective_thread_count;
			if (event.source.type === "displays")
			{
				const display_id: number = event.source.displays[0].id;
				console.log(display_id);
			}
			robot_instance.getScreenSize();
			console.log(content_id, global_x, effective_threads, extra.request_id);
			return "CONTINUE";
		},
		on_image_sets_found: async function(event)
		{
			const set_name: string = event.sets[0].name;
			console.log(set_name);
		},
		on_error: function(event)
		{
			const watcher_error: ImageCatalogWatcherError = event.error;
			console.log(watcher_error.code, watcher_error.recoverable);
			return "EXIT";
		}
	};
	const watcher: image_catalog_watcher_i = await robot.desktop.watchImageCatalog(options);
	const state = watcher.getState();
	console.log(state, watcher.getStatistics().catalog_images);
	abort_controller.abort();
	await watcher.completion;

	const locked_window = robot.desktop.lockWindow({ window_id: "42" });
	const locked_options: image_catalog_watch_options_t = {
		image_dir: "./fixtures",
		source: {
			type: "locked_window",
			locked_window: locked_window,
			require_active: false
		},
		on_before_sweep: function(event)
		{
			if (event.source.type === "locked_window")
			{
				const same_handle = event.source.locked_window;
				const window_id: string = same_handle.assert().windowId;
				const window_x: number = event.source.geometry.x;
				console.log(window_id, window_x);
			}
		},
		on_matches_found: function(event)
		{
			for (const match of event.matches)
			{
				for (const occurrence of match.occurrences)
				{
					if (occurrence.source_type === "locked_window")
					{
						const locked_occurrence: image_catalog_locked_window_occurrence_t = occurrence;
						console.log(locked_occurrence.window_position, locked_occurrence.global_position);
					}
				}
			}
			return "EXIT";
		}
	};
	const locked_watcher = await robot.desktop.watchImageCatalog(locked_options);
	await locked_watcher.completion;
}

void VerifyImageCatalogTypes;
