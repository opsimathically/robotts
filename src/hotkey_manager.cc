#include "hotkey_manager.h"

#include <X11/XKBlib.h>
#include <X11/Xlib.h>
#include <X11/keysym.h>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <climits>
#include <cstring>
#include <deque>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace
{
constexpr unsigned int kLogicalControl = 1U << 0;
constexpr unsigned int kLogicalAlt = 1U << 1;
constexpr unsigned int kLogicalShift = 1U << 2;
constexpr unsigned int kLogicalSuper = 1U << 3;
constexpr unsigned int kAllLogicalModifiers =
	kLogicalControl | kLogicalAlt | kLogicalShift | kLogicalSuper;
constexpr unsigned int kKeyboardModifierMask =
	ShiftMask | LockMask | ControlMask | Mod1Mask | Mod2Mask |
	Mod3Mask | Mod4Mask | Mod5Mask;

std::atomic<bool> hotkey_threading_initialized(false);
std::mutex x_error_handler_mutex;
thread_local Display *captured_error_display = nullptr;
thread_local int captured_x_error = Success;
std::atomic<XErrorHandler> previous_x_error_handler(nullptr);

int CaptureXError(Display *display, XErrorEvent *event)
{
	if (display == captured_error_display)
	{
		captured_x_error = event->error_code;
		return 0;
	}

	const XErrorHandler previous_handler = previous_x_error_handler.load();
	if (previous_handler != nullptr)
	{
		return previous_handler(display, event);
	}

	return 0;
}

enum class CommandType
{
	Register,
	Unregister,
	Stop
};

struct HotkeyCommand
{
	CommandType type;
	uint32_t registrationId = 0;
	std::string key;
	unsigned int logicalModifiers = 0;
	bool completed = false;
	bool succeeded = false;
	std::string errorCode;
	std::string errorMessage;
	std::mutex mutex;
	std::condition_variable condition;
};

struct NativeHotkeyEvent
{
	uint32_t registrationId;
	uint32_t serverTimestampMs;
};

struct HotkeyRegistration
{
	uint32_t registrationId;
	KeyCode keycode;
	unsigned int modifiers;
	std::vector<unsigned int> grabModifiers;
	bool pressed;
};

unsigned int FindModifierMask(Display *display, const std::vector<KeySym>& symbols)
{
	XModifierKeymap *modifier_map = XGetModifierMapping(display);
	if (modifier_map == nullptr)
	{
		return 0;
	}

	unsigned int result = 0;
	for (int modifier_index = 0; modifier_index < 8; ++modifier_index)
	{
		for (int key_index = 0; key_index < modifier_map->max_keypermod; ++key_index)
		{
			const int offset = modifier_index * modifier_map->max_keypermod + key_index;
			const KeyCode keycode = modifier_map->modifiermap[offset];
			if (keycode == 0)
			{
				continue;
			}

			const KeySym keysym = XkbKeycodeToKeysym(display, keycode, 0, 0);
			for (KeySym expected : symbols)
			{
				if (keysym == expected)
				{
					result |= 1U << modifier_index;
				}
			}
		}
	}

	XFreeModifiermap(modifier_map);
	return result;
}

std::vector<unsigned int> BuildIgnoredModifierCombinations(
	unsigned int number_lock_mask,
	unsigned int scroll_lock_mask)
{
	std::vector<unsigned int> lock_masks = {LockMask};
	if (number_lock_mask != 0 && number_lock_mask != LockMask)
	{
		lock_masks.push_back(number_lock_mask);
	}
	if (
		scroll_lock_mask != 0 &&
		std::find(lock_masks.begin(), lock_masks.end(), scroll_lock_mask) == lock_masks.end()
	)
	{
		lock_masks.push_back(scroll_lock_mask);
	}

	std::set<unsigned int> combinations;
	const size_t combination_count = static_cast<size_t>(1) << lock_masks.size();
	for (size_t combination_index = 0; combination_index < combination_count; ++combination_index)
	{
		unsigned int mask = 0;
		for (size_t mask_index = 0; mask_index < lock_masks.size(); ++mask_index)
		{
			if ((combination_index & (static_cast<size_t>(1) << mask_index)) != 0)
			{
				mask |= lock_masks[mask_index];
			}
		}
		combinations.insert(mask);
	}

	return std::vector<unsigned int>(combinations.begin(), combinations.end());
}

class NativeHotkeyManager : public Napi::ObjectWrap<NativeHotkeyManager>
{
public:
	static void Init(Napi::Env env, Napi::Object exports)
	{
		Napi::Function constructor = DefineClass(env, "NativeHotkeyManager", {
			InstanceMethod("registerHotkey", &NativeHotkeyManager::RegisterHotkey),
			InstanceMethod("unregisterHotkey", &NativeHotkeyManager::UnregisterHotkey),
			InstanceMethod("close", &NativeHotkeyManager::Close)
		});
		exports.Set("NativeHotkeyManager", constructor);
	}

	explicit NativeHotkeyManager(const Napi::CallbackInfo& info)
		: Napi::ObjectWrap<NativeHotkeyManager>(info),
		  env_(info.Env()),
		  wake_read_fd_(-1),
		  wake_write_fd_(-1),
		  initialized_(false),
		  initialization_succeeded_(false),
		  running_(false),
		  closed_(false),
		  cleanup_hook_registered_(false)
	{
		Napi::Env env = info.Env();
		if (info.Length() != 1 || !info[0].IsFunction())
		{
			Napi::TypeError::New(env, "NativeHotkeyManager requires one event callback.")
				.ThrowAsJavaScriptException();
			return;
		}
		if (!hotkey_threading_initialized.load())
		{
			Napi::Error::New(env, "X11 threading support is unavailable for global hotkeys.")
				.ThrowAsJavaScriptException();
			return;
		}

		int wake_pipe[2] = {-1, -1};
		if (pipe(wake_pipe) != 0)
		{
			Napi::Error::New(env, "Could not create the global hotkey command pipe.")
				.ThrowAsJavaScriptException();
			return;
		}
		wake_read_fd_ = wake_pipe[0];
		wake_write_fd_ = wake_pipe[1];
		SetNonBlocking(wake_read_fd_);
		SetNonBlocking(wake_write_fd_);

		event_callback_ = Napi::ThreadSafeFunction::New(
			env,
			info[0].As<Napi::Function>(),
			"RobotTS global hotkey listener",
			0,
			1
		);

		const napi_status cleanup_status = napi_add_env_cleanup_hook(
			env_,
			&NativeHotkeyManager::EnvironmentCleanup,
			this
		);
		if (cleanup_status == napi_ok)
		{
			cleanup_hook_registered_ = true;
		}
		else
		{
			event_callback_.Release();
			close(wake_read_fd_);
			close(wake_write_fd_);
			wake_read_fd_ = -1;
			wake_write_fd_ = -1;
			closed_ = true;
			Napi::Error::New(env, "Could not register global hotkey environment cleanup.")
				.ThrowAsJavaScriptException();
			return;
		}

		listener_thread_ = std::thread(&NativeHotkeyManager::ListenerMain, this);

		std::unique_lock<std::mutex> initialization_lock(initialization_mutex_);
		initialization_condition_.wait(initialization_lock, [this]()
		{
			return initialized_;
		});

		if (!initialization_succeeded_)
		{
			initialization_lock.unlock();
			CloseInternal();
			Napi::Error error = Napi::Error::New(env, initialization_error_);
			error.Set("code", "HOTKEY_BACKEND_UNAVAILABLE");
			error.ThrowAsJavaScriptException();
		}
	}

	~NativeHotkeyManager() override
	{
		if (cleanup_hook_registered_)
		{
			napi_remove_env_cleanup_hook(
				env_,
				&NativeHotkeyManager::EnvironmentCleanup,
				this
			);
			cleanup_hook_registered_ = false;
		}
		CloseInternal();
	}

private:
	static void SetNonBlocking(int file_descriptor)
	{
		const int flags = fcntl(file_descriptor, F_GETFL, 0);
		if (flags >= 0)
		{
			fcntl(file_descriptor, F_SETFL, flags | O_NONBLOCK);
		}
		const int descriptor_flags = fcntl(file_descriptor, F_GETFD, 0);
		if (descriptor_flags >= 0)
		{
			fcntl(file_descriptor, F_SETFD, descriptor_flags | FD_CLOEXEC);
		}
	}

	static void EnvironmentCleanup(void *data)
	{
		NativeHotkeyManager *manager = static_cast<NativeHotkeyManager *>(data);
		manager->cleanup_hook_registered_ = false;
		manager->CloseInternal();
	}

	Napi::Value RegisterHotkey(const Napi::CallbackInfo& info)
	{
		Napi::Env env = info.Env();
		if (
			info.Length() != 3 ||
			!info[0].IsNumber() ||
			!info[1].IsString() ||
			!info[2].IsNumber()
		)
		{
			Napi::TypeError::New(env, "registerHotkey requires an id, key, and modifier mask.")
				.ThrowAsJavaScriptException();
			return env.Undefined();
		}

		const double registration_id_value = info[0].As<Napi::Number>().DoubleValue();
		const double modifier_value = info[2].As<Napi::Number>().DoubleValue();
		if (
			registration_id_value < 1 ||
			registration_id_value > UINT32_MAX ||
			std::floor(registration_id_value) != registration_id_value ||
			modifier_value < 0 ||
			modifier_value > kAllLogicalModifiers ||
			std::floor(modifier_value) != modifier_value
		)
		{
			Napi::RangeError::New(env, "The native hotkey id or modifier mask is invalid.")
				.ThrowAsJavaScriptException();
			return env.Undefined();
		}

		HotkeyCommand command;
		command.type = CommandType::Register;
		command.registrationId = static_cast<uint32_t>(registration_id_value);
		command.key = info[1].As<Napi::String>().Utf8Value();
		command.logicalModifiers = static_cast<unsigned int>(modifier_value);
		SubmitCommand(&command);

		if (!command.succeeded)
		{
			Napi::Error error = Napi::Error::New(env, command.errorMessage);
			error.Set("code", command.errorCode);
			error.ThrowAsJavaScriptException();
		}
		return env.Undefined();
	}

	Napi::Value UnregisterHotkey(const Napi::CallbackInfo& info)
	{
		Napi::Env env = info.Env();
		if (info.Length() != 1 || !info[0].IsNumber())
		{
			Napi::TypeError::New(env, "unregisterHotkey requires one registration id.")
				.ThrowAsJavaScriptException();
			return env.Undefined();
		}

		const double registration_id_value = info[0].As<Napi::Number>().DoubleValue();
		if (
			registration_id_value < 1 ||
			registration_id_value > UINT32_MAX ||
			std::floor(registration_id_value) != registration_id_value
		)
		{
			Napi::RangeError::New(env, "The native hotkey registration id is invalid.")
				.ThrowAsJavaScriptException();
			return env.Undefined();
		}

		HotkeyCommand command;
		command.type = CommandType::Unregister;
		command.registrationId = static_cast<uint32_t>(registration_id_value);
		SubmitCommand(&command);
		if (!command.succeeded)
		{
			Napi::Error error = Napi::Error::New(env, command.errorMessage);
			error.Set("code", command.errorCode);
			error.ThrowAsJavaScriptException();
		}
		return env.Undefined();
	}

	Napi::Value Close(const Napi::CallbackInfo& info)
	{
		CloseInternal();
		return info.Env().Undefined();
	}

	void SubmitCommand(HotkeyCommand *command)
	{
		if (!running_.load())
		{
			command->succeeded = false;
			command->errorCode = "HOTKEY_MANAGER_CLOSED";
			command->errorMessage = "The global hotkey manager is not running.";
			command->completed = true;
			return;
		}

		{
			std::lock_guard<std::mutex> command_lock(command_queue_mutex_);
			command_queue_.push_back(command);
		}
		WakeListener();

		std::unique_lock<std::mutex> completion_lock(command->mutex);
		command->condition.wait(completion_lock, [&command]()
		{
			return command->completed;
		});
	}

	void CompleteCommand(
		HotkeyCommand *command,
		bool succeeded,
		const std::string& error_code = std::string(),
		const std::string& error_message = std::string())
	{
		{
			std::lock_guard<std::mutex> completion_lock(command->mutex);
			command->succeeded = succeeded;
			command->errorCode = error_code;
			command->errorMessage = error_message;
			command->completed = true;
			command->condition.notify_one();
		}
	}

	void WakeListener()
	{
		if (wake_write_fd_ < 0)
		{
			return;
		}
		const uint8_t wake_byte = 1;
		const ssize_t ignored = write(wake_write_fd_, &wake_byte, sizeof(wake_byte));
		(void)ignored;
	}

	void DrainWakePipe()
	{
		uint8_t buffer[64];
		while (read(wake_read_fd_, buffer, sizeof(buffer)) > 0)
		{
		}
	}

	void CloseInternal()
	{
		std::lock_guard<std::mutex> close_lock(close_mutex_);
		if (closed_)
		{
			return;
		}
		closed_ = true;

		if (running_.load())
		{
			HotkeyCommand command;
			command.type = CommandType::Stop;
			SubmitCommand(&command);
		}
		if (listener_thread_.joinable())
		{
			listener_thread_.join();
		}
		if (wake_read_fd_ >= 0)
		{
			close(wake_read_fd_);
			wake_read_fd_ = -1;
		}
		if (wake_write_fd_ >= 0)
		{
			close(wake_write_fd_);
			wake_write_fd_ = -1;
		}
	}

	void ListenerMain()
	{
		Display *display = XOpenDisplay(nullptr);
		if (display == nullptr)
		{
			FinishInitialization(false, "Could not open the X11 display for global hotkeys.");
			event_callback_.Release();
			return;
		}

		std::vector<Window> roots;
		for (int screen_index = 0; screen_index < ScreenCount(display); ++screen_index)
		{
			const Window root = RootWindow(display, screen_index);
			XSelectInput(display, root, KeyPressMask | KeyReleaseMask);
			roots.push_back(root);
		}
		if (roots.empty())
		{
			XCloseDisplay(display);
			FinishInitialization(false, "The X11 display does not expose a root window.");
			event_callback_.Release();
			return;
		}

		const unsigned int alt_mask = FindModifierMask(
			display,
			{XK_Alt_L, XK_Alt_R, XK_Meta_L, XK_Meta_R}
		);
		const unsigned int super_mask = FindModifierMask(
			display,
			{XK_Super_L, XK_Super_R, XK_Hyper_L, XK_Hyper_R}
		);
		const unsigned int number_lock_mask = FindModifierMask(display, {XK_Num_Lock});
		const unsigned int scroll_lock_mask = FindModifierMask(display, {XK_Scroll_Lock});
		const unsigned int ignored_modifier_mask =
			LockMask | number_lock_mask | scroll_lock_mask;
		const std::vector<unsigned int> ignored_combinations =
			BuildIgnoredModifierCombinations(number_lock_mask, scroll_lock_mask);

		Bool detectable_repeat_supported = False;
		XkbSetDetectableAutoRepeat(display, True, &detectable_repeat_supported);

		running_.store(true);
		FinishInitialization(true, std::string());

		std::map<uint32_t, HotkeyRegistration> registrations;
		const int x_connection_fd = ConnectionNumber(display);
		bool stop_requested = false;

		while (!stop_requested)
		{
			pollfd descriptors[2];
			descriptors[0].fd = x_connection_fd;
			descriptors[0].events = POLLIN;
			descriptors[0].revents = 0;
			descriptors[1].fd = wake_read_fd_;
			descriptors[1].events = POLLIN;
			descriptors[1].revents = 0;

			const int poll_result = poll(descriptors, 2, -1);
			if (poll_result < 0 && errno == EINTR)
			{
				continue;
			}
			if (poll_result < 0)
			{
				break;
			}

			if ((descriptors[1].revents & POLLIN) != 0)
			{
				DrainWakePipe();
				ProcessCommands(
					display,
					roots,
					alt_mask != 0 ? alt_mask : Mod1Mask,
					super_mask != 0 ? super_mask : Mod4Mask,
					ignored_combinations,
					registrations,
					stop_requested
				);
			}

			while (!stop_requested && XPending(display) > 0)
			{
				XEvent event;
				XNextEvent(display, &event);

				if (event.type == MappingNotify)
				{
					XRefreshKeyboardMapping(&event.xmapping);
					continue;
				}
				if (event.type != KeyPress && event.type != KeyRelease)
				{
					continue;
				}

				const KeyCode event_keycode = event.xkey.keycode;
				if (event.type == KeyRelease)
				{
					bool is_repeat_release = false;
					if (!detectable_repeat_supported && XPending(display) > 0)
					{
						XEvent next_event;
						XPeekEvent(display, &next_event);
						is_repeat_release =
							next_event.type == KeyPress &&
							next_event.xkey.keycode == event_keycode &&
							next_event.xkey.time == event.xkey.time;
					}
					if (!is_repeat_release)
					{
						for (auto& registration_entry : registrations)
						{
							if (registration_entry.second.keycode == event_keycode)
							{
								registration_entry.second.pressed = false;
							}
						}
					}
					continue;
				}

				const unsigned int event_modifiers =
					(event.xkey.state & kKeyboardModifierMask) & ~ignored_modifier_mask;
				for (auto& registration_entry : registrations)
				{
					HotkeyRegistration& registration = registration_entry.second;
					if (
						registration.keycode == event_keycode &&
						registration.modifiers == event_modifiers &&
						!registration.pressed
					)
					{
						registration.pressed = true;
						DispatchEvent(registration.registrationId, event.xkey.time);
						break;
					}
				}
			}
		}

		for (const auto& registration_entry : registrations)
		{
			UngrabRegistration(display, roots, registration_entry.second);
		}
		XSync(display, False);
		XCloseDisplay(display);
		running_.store(false);
		FailQueuedCommands();
		event_callback_.Release();
	}

	void FinishInitialization(bool succeeded, const std::string& error_message)
	{
		{
			std::lock_guard<std::mutex> initialization_lock(initialization_mutex_);
			initialization_succeeded_ = succeeded;
			initialization_error_ = error_message;
			initialized_ = true;
			initialization_condition_.notify_one();
		}
	}

	void ProcessCommands(
		Display *display,
		const std::vector<Window>& roots,
		unsigned int alt_mask,
		unsigned int super_mask,
		const std::vector<unsigned int>& ignored_combinations,
		std::map<uint32_t, HotkeyRegistration>& registrations,
		bool& stop_requested)
	{
		std::deque<HotkeyCommand *> commands;
		{
			std::lock_guard<std::mutex> command_lock(command_queue_mutex_);
			commands.swap(command_queue_);
		}

		for (HotkeyCommand *command : commands)
		{
			if (stop_requested)
			{
				CompleteCommand(
					command,
					false,
					"HOTKEY_MANAGER_CLOSED",
					"The global hotkey manager is closing."
				);
				continue;
			}

			if (command->type == CommandType::Stop)
			{
				stop_requested = true;
				CompleteCommand(command, true);
				continue;
			}
			if (command->type == CommandType::Unregister)
			{
				const auto registration = registrations.find(command->registrationId);
				if (registration == registrations.end())
				{
					CompleteCommand(
						command,
						false,
						"HOTKEY_NOT_FOUND",
						"The global hotkey registration does not exist."
					);
					continue;
				}
				UngrabRegistration(display, roots, registration->second);
				XSync(display, False);
				registrations.erase(registration);
				CompleteCommand(command, true);
				continue;
			}

			RegisterCommand(
				display,
				roots,
				alt_mask,
				super_mask,
				ignored_combinations,
				registrations,
				command
			);
		}
	}

	void RegisterCommand(
		Display *display,
		const std::vector<Window>& roots,
		unsigned int alt_mask,
		unsigned int super_mask,
		const std::vector<unsigned int>& ignored_combinations,
		std::map<uint32_t, HotkeyRegistration>& registrations,
		HotkeyCommand *command)
	{
		if (registrations.find(command->registrationId) != registrations.end())
		{
			CompleteCommand(
				command,
				false,
				"HOTKEY_CONFLICT",
				"The global hotkey registration id is already in use."
			);
			return;
		}

		const KeySym keysym = XStringToKeysym(command->key.c_str());
		if (keysym == NoSymbol)
		{
			CompleteCommand(
				command,
				false,
				"HOTKEY_INVALID_KEY",
				"The requested key is not recognized by X11."
			);
			return;
		}
		const KeyCode keycode = XKeysymToKeycode(display, keysym);
		if (keycode == 0)
		{
			CompleteCommand(
				command,
				false,
				"HOTKEY_INVALID_KEY",
				"The requested key is not available in the current X11 keymap."
			);
			return;
		}

		unsigned int modifiers = 0;
		if ((command->logicalModifiers & kLogicalControl) != 0)
		{
			modifiers |= ControlMask;
		}
		if ((command->logicalModifiers & kLogicalAlt) != 0)
		{
			modifiers |= alt_mask;
		}
		if ((command->logicalModifiers & kLogicalShift) != 0)
		{
			modifiers |= ShiftMask;
		}
		if ((command->logicalModifiers & kLogicalSuper) != 0)
		{
			modifiers |= super_mask;
		}

		for (const auto& registration_entry : registrations)
		{
			if (
				registration_entry.second.keycode == keycode &&
				registration_entry.second.modifiers == modifiers
			)
			{
				CompleteCommand(
					command,
					false,
					"HOTKEY_CONFLICT",
					"The requested global hotkey is already registered by this process."
				);
				return;
			}
		}

		HotkeyRegistration registration;
		registration.registrationId = command->registrationId;
		registration.keycode = keycode;
		registration.modifiers = modifiers;
		registration.pressed = false;

		for (unsigned int ignored_modifiers : ignored_combinations)
		{
			registration.grabModifiers.push_back(modifiers | ignored_modifiers);
		}

		int x_error = Success;
		{
			std::lock_guard<std::mutex> error_handler_lock(x_error_handler_mutex);
			XSync(display, False);
			captured_error_display = display;
			captured_x_error = Success;
			previous_x_error_handler.store(XSetErrorHandler(CaptureXError));

			for (Window root : roots)
			{
				for (unsigned int grab_modifiers : registration.grabModifiers)
				{
					XGrabKey(
						display,
						keycode,
						grab_modifiers,
						root,
						False,
						GrabModeAsync,
						GrabModeAsync
					);
				}
			}
			XSync(display, False);
			x_error = captured_x_error;
			XSetErrorHandler(previous_x_error_handler.load());
			previous_x_error_handler.store(nullptr);
			captured_error_display = nullptr;
			captured_x_error = Success;
		}

		if (x_error != Success)
		{
			UngrabRegistration(display, roots, registration);
			XSync(display, False);
			CompleteCommand(
				command,
				false,
				x_error == BadAccess ? "HOTKEY_CONFLICT" : "HOTKEY_BACKEND_ERROR",
				x_error == BadAccess
					? "The requested global hotkey is already owned by another X11 client."
					: "X11 rejected the requested global hotkey registration."
			);
			return;
		}

		registrations.emplace(command->registrationId, std::move(registration));
		CompleteCommand(command, true);
	}

	static void UngrabRegistration(
		Display *display,
		const std::vector<Window>& roots,
		const HotkeyRegistration& registration)
	{
		for (Window root : roots)
		{
			for (unsigned int grab_modifiers : registration.grabModifiers)
			{
				XUngrabKey(display, registration.keycode, grab_modifiers, root);
			}
		}
	}

	void DispatchEvent(uint32_t registration_id, uint32_t server_timestamp_ms)
	{
		NativeHotkeyEvent *event = new NativeHotkeyEvent{
			registration_id,
			server_timestamp_ms
		};
		const napi_status status = event_callback_.NonBlockingCall(
			event,
			[](Napi::Env env, Napi::Function callback, NativeHotkeyEvent *native_event)
			{
				std::unique_ptr<NativeHotkeyEvent> event_owner(native_event);
				Napi::Object event_value = Napi::Object::New(env);
				event_value.Set(
					"registration_id",
					Napi::Number::New(env, native_event->registrationId)
				);
				event_value.Set(
					"server_timestamp_ms",
					Napi::Number::New(env, native_event->serverTimestampMs)
				);
				callback.Call({event_value});
			}
		);
		if (status != napi_ok)
		{
			delete event;
		}
	}

	void FailQueuedCommands()
	{
		std::deque<HotkeyCommand *> commands;
		{
			std::lock_guard<std::mutex> command_lock(command_queue_mutex_);
			commands.swap(command_queue_);
		}
		for (HotkeyCommand *command : commands)
		{
			CompleteCommand(
				command,
				false,
				"HOTKEY_MANAGER_CLOSED",
				"The global hotkey manager stopped before processing the command."
			);
		}
	}

	napi_env env_;
	int wake_read_fd_;
	int wake_write_fd_;
	Napi::ThreadSafeFunction event_callback_;
	std::thread listener_thread_;
	std::mutex initialization_mutex_;
	std::condition_variable initialization_condition_;
	bool initialized_;
	bool initialization_succeeded_;
	std::string initialization_error_;
	std::atomic<bool> running_;
	std::mutex command_queue_mutex_;
	std::deque<HotkeyCommand *> command_queue_;
	std::mutex close_mutex_;
	bool closed_;
	bool cleanup_hook_registered_;
};
}

bool InitializeHotkeyThreading()
{
	const bool initialized = XInitThreads() != 0;
	hotkey_threading_initialized.store(initialized);
	return initialized;
}

void InitNativeHotkeyManager(Napi::Env env, Napi::Object exports)
{
	NativeHotkeyManager::Init(env, exports);
}
