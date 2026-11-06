import robot, {
	locked_window_geometry_result_t,
	locked_window_pixel_color_result_t,
	locked_window_point_result_t,
	locked_window_t
} from "../..";

function VerifyLockedWindowTypes(): void
{
	const locked_window: locked_window_t = robot.desktop.lockWindow({
		title_includes: "Text Editor"
	});
	const geometry: locked_window_geometry_result_t = locked_window.getGeometry();
	const active_geometry = locked_window.getGeometry({ require_active: true });
	const mouse_position: locked_window_point_result_t = locked_window.getMousePos();
	const active_mouse_position = locked_window.getMousePos({ require_active: true });
	const pixel: locked_window_pixel_color_result_t = locked_window.getPixelColor({
		x: 24,
		y: 36
	});
	const global_point: locked_window_point_result_t = locked_window.toGlobalPoint({
		x: -10,
		y: 50,
		require_active: false
	});
	const window_point: locked_window_point_result_t = locked_window.toWindowPoint({
		x: -900,
		y: 200
	});

	const window_id: string = geometry.target.windowId;
	const global_x: number = geometry.geometry.x;
	const local_width: number = geometry.window_bounds.width;
	const title: string | null = geometry.window.title;
	const local_mouse_x: number = mouse_position.window_position.x;
	const desktop_mouse_x: number = mouse_position.global_position.x;
	const inside_window: boolean = mouse_position.inside_window;
	const color: string = pixel.color;

	console.log(
		window_id,
		global_x,
		local_width,
		title,
		local_mouse_x,
		desktop_mouse_x,
		inside_window,
		color,
		active_geometry,
		active_mouse_position,
		global_point,
		window_point
	);
}

void VerifyLockedWindowTypes;
