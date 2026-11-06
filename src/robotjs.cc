#include <napi.h>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <limits>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <vector>
#include "mouse.h"
#include "deadbeef_rand.h"
#include "keypress.h"
#include "screen.h"
#include "screengrab.h"
#include "MMBitmap.h"
#include "bitmap_find.h"
#include "bitmap_catalog.h"
#include "native_thread_budget.h"
#include "hotkey_manager.h"
#include "io.h"
#include "snprintf.h"
#include "microsleep.h"
#include "rgb.h"
#if defined(USE_X11)
	#include "xdisplay.h"
	#include <X11/Xatom.h>
	#include <X11/Xutil.h>
	#include <X11/extensions/Xrandr.h>
#endif

//Global delays.
int mouseDelay = 10;
int keyboardDelay = 10;

static Napi::Object BuildBitmapObject(Napi::Env env, MMBitmapRef bitmap);

#if defined(USE_X11)
static Napi::Value NullableString(Napi::Env env, const std::string& value)
{
	if (value.empty())
	{
		return env.Null();
	}

	return Napi::String::New(env, value);
}

static Napi::Value NullableNumber(Napi::Env env, long value, bool hasValue)
{
	if (!hasValue)
	{
		return env.Null();
	}

	return Napi::Number::New(env, value);
}

static std::string WindowIdToString(Window window)
{
	std::ostringstream stream;
	stream << static_cast<unsigned long>(window);
	return stream.str();
}

static Atom GetOptionalAtom(Display *display, const char *name)
{
	return XInternAtom(display, name, True);
}

static bool GetPropertyData(Display *display,
	                       Window window,
	                       Atom property,
	                       Atom requestedType,
	                       unsigned char **data,
	                       unsigned long *itemCount,
	                       Atom *actualTypeOut = NULL,
	                       int *actualFormatOut = NULL)
{
	if (!data || !itemCount || property == None)
	{
		return false;
	}

	Atom actualType;
	int actualFormat;
	unsigned long bytesAfter;
	unsigned char *propertyValue = NULL;
	const int status = XGetWindowProperty(display,
	                                      window,
	                                      property,
	                                      0,
	                                      (~0L),
	                                      False,
	                                      requestedType,
	                                      &actualType,
	                                      &actualFormat,
	                                      itemCount,
	                                      &bytesAfter,
	                                      &propertyValue);

	if (status != Success || propertyValue == NULL)
	{
		return false;
	}

	if (actualTypeOut != NULL)
	{
		*actualTypeOut = actualType;
	}

	if (actualFormatOut != NULL)
	{
		*actualFormatOut = actualFormat;
	}

	*data = propertyValue;
	return true;
}

static bool GetCardinalProperty(Display *display, Window window, const char *propertyName, unsigned long *value)
{
	if (!value)
	{
		return false;
	}

	Atom property = GetOptionalAtom(display, propertyName);
	unsigned char *data = NULL;
	unsigned long itemCount = 0;
	Atom actualType = None;
	int actualFormat = 0;

	if (!GetPropertyData(display, window, property, XA_CARDINAL, &data, &itemCount, &actualType, &actualFormat))
	{
		return false;
	}

	const bool hasValue = actualType == XA_CARDINAL && actualFormat == 32 && itemCount > 0;
	if (hasValue)
	{
		*value = reinterpret_cast<unsigned long *>(data)[0];
	}

	XFree(data);
	return hasValue;
}

static bool GetWindowProperty(Display *display, Window window, const char *propertyName, Window *value)
{
	if (!value)
	{
		return false;
	}

	Atom property = GetOptionalAtom(display, propertyName);
	unsigned char *data = NULL;
	unsigned long itemCount = 0;
	Atom actualType = None;
	int actualFormat = 0;

	if (!GetPropertyData(display, window, property, XA_WINDOW, &data, &itemCount, &actualType, &actualFormat))
	{
		return false;
	}

	const bool hasValue = actualType == XA_WINDOW && actualFormat == 32 && itemCount > 0 &&
		reinterpret_cast<Window *>(data)[0] != None;
	if (hasValue)
	{
		*value = reinterpret_cast<Window *>(data)[0];
	}

	XFree(data);
	return hasValue;
}

static std::vector<Window> GetWindowListProperty(Display *display, Window window, const char *propertyName)
{
	std::vector<Window> windows;
	Atom property = GetOptionalAtom(display, propertyName);
	unsigned char *data = NULL;
	unsigned long itemCount = 0;
	Atom actualType = None;
	int actualFormat = 0;

	if (!GetPropertyData(display, window, property, XA_WINDOW, &data, &itemCount, &actualType, &actualFormat))
	{
		return windows;
	}

	if (actualType == XA_WINDOW && actualFormat == 32)
	{
		Window *windowItems = reinterpret_cast<Window *>(data);
		for (unsigned long index = 0; index < itemCount; ++index)
		{
			if (windowItems[index] != None)
			{
				windows.push_back(windowItems[index]);
			}
		}
	}

	XFree(data);
	return windows;
}

static std::vector<std::string> GetNullSeparatedStrings(Display *display, Window window, const char *propertyName)
{
	std::vector<std::string> values;
	Atom property = GetOptionalAtom(display, propertyName);
	Atom utf8String = XInternAtom(display, "UTF8_STRING", False);
	unsigned char *data = NULL;
	unsigned long itemCount = 0;
	Atom actualType = None;
	int actualFormat = 0;

	if (!GetPropertyData(display, window, property, utf8String, &data, &itemCount, &actualType, &actualFormat))
	{
		return values;
	}

	if (actualFormat == 8 && itemCount > 0)
	{
		std::string current;
		for (unsigned long index = 0; index < itemCount; ++index)
		{
			const char value = reinterpret_cast<char *>(data)[index];
			if (value == '\0')
			{
				values.push_back(current);
				current.clear();
			}
			else
			{
				current.push_back(value);
			}
		}

		if (!current.empty())
		{
			values.push_back(current);
		}
	}

	XFree(data);
	return values;
}

static std::string GetStringProperty(Display *display, Window window, const char *propertyName)
{
	Atom property = GetOptionalAtom(display, propertyName);
	if (property != None)
	{
		Atom utf8String = XInternAtom(display, "UTF8_STRING", False);
		unsigned char *data = NULL;
		unsigned long itemCount = 0;
		Atom actualType = None;
		int actualFormat = 0;

		if (GetPropertyData(display, window, property, utf8String, &data, &itemCount, &actualType, &actualFormat))
		{
			std::string value;
			if (actualFormat == 8)
			{
				value.assign(reinterpret_cast<char *>(data), itemCount);
			}

			XFree(data);
			if (!value.empty())
			{
				return value;
			}
		}

		if (GetPropertyData(display, window, property, XA_STRING, &data, &itemCount, &actualType, &actualFormat))
		{
			std::string value;
			if (actualFormat == 8)
			{
				value.assign(reinterpret_cast<char *>(data), itemCount);
			}

			XFree(data);
			if (!value.empty())
			{
				return value;
			}
		}
	}

	if (strcmp(propertyName, "_NET_WM_NAME") == 0)
	{
		char *windowName = NULL;
		if (XFetchName(display, window, &windowName) > 0 && windowName != NULL)
		{
			std::string value(windowName);
			XFree(windowName);
			return value;
		}
	}

	return "";
}

static void GetWindowClassHint(Display *display,
	                          Window window,
	                          std::string *instanceName,
	                          std::string *className)
{
	XClassHint classHint;
	if (!XGetClassHint(display, window, &classHint))
	{
		return;
	}

	if (instanceName != NULL && classHint.res_name != NULL)
	{
		*instanceName = classHint.res_name;
	}

	if (className != NULL && classHint.res_class != NULL)
	{
		*className = classHint.res_class;
	}

	if (classHint.res_name != NULL)
	{
		XFree(classHint.res_name);
	}

	if (classHint.res_class != NULL)
	{
		XFree(classHint.res_class);
	}
}

static Napi::Object BuildGeometryObject(Napi::Env env, int x, int y, unsigned int width, unsigned int height)
{
	Napi::Object geometry = Napi::Object::New(env);
	geometry.Set("x", Napi::Number::New(env, x));
	geometry.Set("y", Napi::Number::New(env, y));
	geometry.Set("width", Napi::Number::New(env, width));
	geometry.Set("height", Napi::Number::New(env, height));
	return geometry;
}

static Napi::Object BuildWindowObject(Napi::Env env, Display *display, Window window, Window activeWindow)
{
	Napi::Object result = Napi::Object::New(env);
	result.Set("windowId", Napi::String::New(env, WindowIdToString(window)));

	std::string title = GetStringProperty(display, window, "_NET_WM_NAME");
	std::string instanceName;
	std::string className;
	GetWindowClassHint(display, window, &instanceName, &className);

	unsigned long pid = 0;
	unsigned long workspaceId = 0;
	const bool hasPid = GetCardinalProperty(display, window, "_NET_WM_PID", &pid);
	const bool hasWorkspaceId = GetCardinalProperty(display, window, "_NET_WM_DESKTOP", &workspaceId);

	XWindowAttributes attributes;
	const bool hasAttributes = XGetWindowAttributes(display, window, &attributes) != 0;
	int absoluteX = 0;
	int absoluteY = 0;
	Window child;
	if (hasAttributes)
	{
		XTranslateCoordinates(display,
		                      window,
		                      DefaultRootWindow(display),
		                      0,
		                      0,
		                      &absoluteX,
		                      &absoluteY,
		                      &child);
	}

	result.Set("title", NullableString(env, title));
	result.Set("className", NullableString(env, className));
	result.Set("instanceName", NullableString(env, instanceName));
	result.Set("pid", NullableNumber(env, static_cast<long>(pid), hasPid));
	result.Set("workspaceId", NullableNumber(env, static_cast<long>(workspaceId), hasWorkspaceId));
	result.Set("isActive", Napi::Boolean::New(env, window == activeWindow));
	result.Set("isVisible", Napi::Boolean::New(env, hasAttributes && attributes.map_state == IsViewable));
	result.Set("geometry", BuildGeometryObject(env,
	                                           absoluteX,
	                                           absoluteY,
	                                           hasAttributes ? static_cast<unsigned int>(attributes.width) : 0,
	                                           hasAttributes ? static_cast<unsigned int>(attributes.height) : 0));

	return result;
}

static Window ParseWindowId(const Napi::Value& value)
{
	if (value.IsString())
	{
		std::string windowId = value.As<Napi::String>().Utf8Value();
		return static_cast<Window>(strtoul(windowId.c_str(), NULL, 0));
	}

	return static_cast<Window>(value.As<Napi::Number>().Uint32Value());
}
#endif

/*
 __  __
|  \/  | ___  _   _ ___  ___
| |\/| |/ _ \| | | / __|/ _ \
| |  | | (_) | |_| \__ \  __/
|_|  |_|\___/ \__,_|___/\___|

*/

int CheckMouseButton(const char * const b, MMMouseButton * const button)
{
	if (!button) return -1;

	if (strcmp(b, "left") == 0)
	{
		*button = LEFT_BUTTON;
	}
	else if (strcmp(b, "right") == 0)
	{
		*button = RIGHT_BUTTON;
	}
	else if (strcmp(b, "middle") == 0)
	{
		*button = CENTER_BUTTON;
	}
	else
	{
		return -2;
	}

	return 0;
}

Napi::Value dragMouseWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() < 2 || info.Length() > 3)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}

	const int32_t x = info[0].As<Napi::Number>().Int32Value();
	const int32_t y = info[1].As<Napi::Number>().Int32Value();
	MMMouseButton button = LEFT_BUTTON;

	if (info.Length() == 3)
	{
		std::string bstr = info[2].As<Napi::String>().Utf8Value();
		const char * const b = bstr.c_str();

		switch (CheckMouseButton(b, &button))
		{
			case -1:
				Napi::Error::New(env, "Null pointer in mouse button code.").ThrowAsJavaScriptException();
return env.Null();
				break;
			case -2:
				Napi::Error::New(env, "Invalid mouse button specified.").ThrowAsJavaScriptException();
return env.Null();
				break;
		}
	}

	MMSignedPoint point;
	point = MMSignedPointMake(x, y);
	dragMouse(point, button);
	microsleep(mouseDelay);

	return Napi::Number::New(env, 1);
}

Napi::Value updateScreenMetricsWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	updateScreenMetrics();

	return Napi::Number::New(env, 1);
}

Napi::Value moveMouseWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() != 2)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}

	int32_t x = info[0].As<Napi::Number>().Int32Value();
	int32_t y = info[1].As<Napi::Number>().Int32Value();

	MMSignedPoint point;
	point = MMSignedPointMake(x, y);
	moveMouse(point);
	microsleep(mouseDelay);

	return Napi::Number::New(env, 1);
}

Napi::Value moveMouseSmoothWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() > 3 || info.Length() < 2 )
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}
	size_t x = info[0].As<Napi::Number>().Int32Value();
	size_t y = info[1].As<Napi::Number>().Int32Value();

	MMPoint point;
	point = MMPointMake(x, y);
	if (info.Length() == 3)
	{
		size_t speed = info[2].As<Napi::Number>().Int32Value();
		smoothlyMoveMouse(point, speed);
	}
	else
	{
		smoothlyMoveMouse(point, 3.0);
	}
	microsleep(mouseDelay);

	return Napi::Number::New(env, 1);
}

Napi::Value getMousePosWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	MMSignedPoint pos = getMousePos();

	//Return object with .x and .y.
	Napi::Object obj = Napi::Object::New(env);
	obj.Set(Napi::String::New(env, "x"), Napi::Number::New(env, (int)pos.x));
	obj.Set(Napi::String::New(env, "y"), Napi::Number::New(env, (int)pos.y));
	return obj;
}

Napi::Value mouseClickWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	MMMouseButton button = LEFT_BUTTON;
	bool doubleC = false;

	if (info.Length() > 0)
	{
		std::string bstr = info[0].As<Napi::String>().Utf8Value();
		const char * const b = bstr.c_str();

		switch (CheckMouseButton(b, &button))
		{
			case -1:
				Napi::Error::New(env, "Null pointer in mouse button code.").ThrowAsJavaScriptException();
return env.Null();
				break;
			case -2:
				Napi::Error::New(env, "Invalid mouse button specified.").ThrowAsJavaScriptException();
return env.Null();
				break;
		}
	}

	if (info.Length() == 2)
	{
		doubleC = info[1].As<Napi::Boolean>().Value();
	}
	else if (info.Length() > 2)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}

	if (!doubleC)
	{
		clickMouse(button);
	}
	else
	{
		doubleClick(button);
	}

	microsleep(mouseDelay);

	return Napi::Number::New(env, 1);
}

Napi::Value mouseToggleWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	MMMouseButton button = LEFT_BUTTON;
	bool down = false;

	if (info.Length() > 0)
	{
		const char *d;

		std::string dstr = info[0].As<Napi::String>();
		d = dstr.c_str();

		if (strcmp(d, "down") == 0)
		{
			down = true;
		}
		else if (strcmp(d, "up") == 0)
		{
			down = false;
		}
		else
		{
			Napi::Error::New(env, "Invalid mouse button state specified.").ThrowAsJavaScriptException();
return env.Null();
		}
	}

	if (info.Length() == 2)
	{
		std::string bstr = info[1].As<Napi::String>();
		const char * const b = bstr.c_str();

		switch (CheckMouseButton(b, &button))
		{
			case -1:
				Napi::Error::New(env, "Null pointer in mouse button code.").ThrowAsJavaScriptException();
return env.Null();
				break;
			case -2:
				Napi::Error::New(env, "Invalid mouse button specified.").ThrowAsJavaScriptException();
return env.Null();
				break;
		}
	}
	else if (info.Length() > 2)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}

	toggleMouse(down, button);
	microsleep(mouseDelay);

	return Napi::Number::New(env, 1);
}

Napi::Value setMouseDelayWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() != 1)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}

	mouseDelay = info[0].As<Napi::Number>().Int32Value();

	return Napi::Number::New(env, 1);
}

Napi::Value scrollMouseWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() != 2)
	{
    	Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}

	int x = info[0].As<Napi::Number>().Int32Value();
	int y = info[1].As<Napi::Number>().Int32Value();

	scrollMouse(x, y);
	microsleep(mouseDelay);

	return Napi::Number::New(env, 1);
}
/*
 _  __          _                         _
| |/ /___ _   _| |__   ___   __ _ _ __ __| |
| ' // _ \ | | | '_ \ / _ \ / _` | '__/ _` |
| . \  __/ |_| | |_) | (_) | (_| | | | (_| |
|_|\_\___|\__, |_.__/ \___/ \__,_|_|  \__,_|
          |___/
*/
struct KeyNames
{
	const char* name;
	MMKeyCode   key;
};

static KeyNames key_names[] =
{
	{ "backspace",      K_BACKSPACE },
	{ "delete",         K_DELETE },
	{ "enter",          K_RETURN },
	{ "tab",            K_TAB },
	{ "escape",         K_ESCAPE },
	{ "up",             K_UP },
	{ "down",           K_DOWN },
	{ "right",          K_RIGHT },
	{ "left",           K_LEFT },
	{ "home",           K_HOME },
	{ "end",            K_END },
	{ "pageup",         K_PAGEUP },
	{ "pagedown",       K_PAGEDOWN },
	{ "f1",             K_F1 },
	{ "f2",             K_F2 },
	{ "f3",             K_F3 },
	{ "f4",             K_F4 },
	{ "f5",             K_F5 },
	{ "f6",             K_F6 },
	{ "f7",             K_F7 },
	{ "f8",             K_F8 },
	{ "f9",             K_F9 },
	{ "f10",            K_F10 },
	{ "f11",            K_F11 },
	{ "f12",            K_F12 },
	{ "f13",            K_F13 },
	{ "f14",            K_F14 },
	{ "f15",            K_F15 },
	{ "f16",            K_F16 },
	{ "f17",            K_F17 },
	{ "f18",            K_F18 },
	{ "f19",            K_F19 },
	{ "f20",            K_F20 },
	{ "f21",            K_F21 },
	{ "f22",            K_F22 },
	{ "f23",            K_F23 },
	{ "f24",            K_F24 },
	{ "capslock",       K_CAPSLOCK },
	{ "command",        K_META },
	{ "alt",            K_ALT },
	{ "right_alt",      K_RIGHT_ALT },
	{ "control",        K_CONTROL },
	{ "left_control",   K_LEFT_CONTROL },
	{ "right_control",  K_RIGHT_CONTROL },
	{ "shift",          K_SHIFT },
	{ "right_shift",    K_RIGHTSHIFT },
	{ "space",          K_SPACE },
	{ "printscreen",    K_PRINTSCREEN },
	{ "insert",         K_INSERT },
	{ "menu",           K_MENU },

	{ "audio_mute",     K_AUDIO_VOLUME_MUTE },
	{ "audio_vol_down", K_AUDIO_VOLUME_DOWN },
	{ "audio_vol_up",   K_AUDIO_VOLUME_UP },
	{ "audio_play",     K_AUDIO_PLAY },
	{ "audio_stop",     K_AUDIO_STOP },
	{ "audio_pause",    K_AUDIO_PAUSE },
	{ "audio_prev",     K_AUDIO_PREV },
	{ "audio_next",     K_AUDIO_NEXT },
	{ "audio_rewind",   K_AUDIO_REWIND },
	{ "audio_forward",  K_AUDIO_FORWARD },
	{ "audio_repeat",   K_AUDIO_REPEAT },
	{ "audio_random",   K_AUDIO_RANDOM },

	{ "numpad_lock",	K_NUMPAD_LOCK },
	{ "numpad_0",		K_NUMPAD_0 },
	{ "numpad_0",		K_NUMPAD_0 },
	{ "numpad_1",		K_NUMPAD_1 },
	{ "numpad_2",		K_NUMPAD_2 },
	{ "numpad_3",		K_NUMPAD_3 },
	{ "numpad_4",		K_NUMPAD_4 },
	{ "numpad_5",		K_NUMPAD_5 },
	{ "numpad_6",		K_NUMPAD_6 },
	{ "numpad_7",		K_NUMPAD_7 },
	{ "numpad_8",		K_NUMPAD_8 },
	{ "numpad_9",		K_NUMPAD_9 },
	{ "numpad_+",		K_NUMPAD_PLUS },
	{ "numpad_-",		K_NUMPAD_MINUS },
	{ "numpad_*",		K_NUMPAD_MULTIPLY },
	{ "numpad_/",		K_NUMPAD_DIVIDE },
	{ "numpad_.",		K_NUMPAD_DECIMAL },

	{ "lights_mon_up",    K_LIGHTS_MON_UP },
	{ "lights_mon_down",  K_LIGHTS_MON_DOWN },
	{ "lights_kbd_toggle",K_LIGHTS_KBD_TOGGLE },
	{ "lights_kbd_up",    K_LIGHTS_KBD_UP },
	{ "lights_kbd_down",  K_LIGHTS_KBD_DOWN },

	{ NULL,               K_NOT_A_KEY } /* end marker */
};

int CheckKeyCodes(const char* k, MMKeyCode *key)
{
	if (!key) return -1;

	if (strlen(k) == 1)
	{
		*key = keyCodeForChar(*k);
		return 0;
	}

	*key = K_NOT_A_KEY;

	KeyNames* kn = key_names;
	while (kn->name)
	{
		if (strcmp(k, kn->name) == 0)
		{
			*key = kn->key;
			break;
		}
		kn++;
	}

	if (*key == K_NOT_A_KEY)
	{
		return -2;
	}

	return 0;
}

int CheckKeyFlags(const char* f, MMKeyFlags* flags)
{
	if (!flags) return -1;

	if (strcmp(f, "alt") == 0 || strcmp(f, "right_alt") == 0)
	{
		*flags = MOD_ALT;
	}
	else if(strcmp(f, "command") == 0)
	{
		*flags = MOD_META;
	}
	else if(strcmp(f, "control") == 0 || strcmp(f, "right_control") == 0 || strcmp(f, "left_control") == 0)
	{
		*flags = MOD_CONTROL;
	}
	else if(strcmp(f, "shift") == 0 || strcmp(f, "right_shift") == 0)
	{
		*flags = MOD_SHIFT;
	}
	else if(strcmp(f, "none") == 0)
	{
		*flags = MOD_NONE;
	}
	else
	{
		return -2;
	}

	return 0;
}

int GetFlagsFromString(Napi::Value value, MMKeyFlags* flags) {
	Napi::Env env = value.Env();
	Napi::String fstr(env, value.ToString());
	return CheckKeyFlags(fstr.Utf8Value().c_str(), flags);
}

int GetFlagsFromValue(Napi::Value value, MMKeyFlags* flags) {
	if (!flags) return -1;

	//Optionally allow an array of flag strings to be passed.
	if (value.IsArray())
	{
		Napi::Array a = value.As<Napi::Array>();
		for (uint32_t i = 0; i < a.Length(); i++)
		{
		  if ((a).Has(i)) {
                Napi::Value v((a).Get(i));
                if (!v.IsString()) return -2;

                MMKeyFlags f = MOD_NONE;
                const int rv = GetFlagsFromString(v, &f);
                if (rv) return rv;

                *flags = (MMKeyFlags)(*flags | f);
			}
		}
		return 0;
	}

	//If it's not an array, it should be a single string value.
	return GetFlagsFromString(value, flags);
}

Napi::Value keyTapWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	MMKeyFlags flags = MOD_NONE;
	MMKeyCode key;
	const char *k;

	Napi::String kstr(env, info[0].ToString());
	k = kstr.Utf8Value().c_str();

	switch (info.Length())
	{
		case 2:
			switch (GetFlagsFromValue(info[1], &flags))
			{
				case -1:
					Napi::Error::New(env, "Null pointer in key flag.").ThrowAsJavaScriptException();
return env.Null();
					break;
				case -2:
					Napi::Error::New(env, "Invalid key flag specified.").ThrowAsJavaScriptException();
return env.Null();
					break;
			}
			break;
		case 1:
			break;
		default:
			Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}

	switch(CheckKeyCodes(k, &key))
	{
		case -1:
			Napi::Error::New(env, "Null pointer in key code.").ThrowAsJavaScriptException();
return env.Null();
			break;
		case -2:
			Napi::Error::New(env, "Invalid key code specified.").ThrowAsJavaScriptException();
return env.Null();
			break;
		default:
			toggleKeyCode(key, true, flags);
			microsleep(keyboardDelay);
			toggleKeyCode(key, false, flags);
			microsleep(keyboardDelay);
			break;
	}

	return Napi::Number::New(env, 1);
}


Napi::Value keyToggleWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	MMKeyFlags flags = MOD_NONE;
	MMKeyCode key;

	bool down = false;
	const char *k;

	//Get arguments from JavaScript.
	std::string kstr = info[0].As<Napi::String>();

	//Convert arguments to chars.
	k = kstr.c_str();

	//Check and confirm number of arguments.
	switch (info.Length())
	{
		case 3:
			//Get key modifier.
			switch (GetFlagsFromValue(info[2], &flags))
			{
				case -1:
					Napi::Error::New(env, "Null pointer in key flag.").ThrowAsJavaScriptException();
return env.Null();
					break;
				case -2:
					Napi::Error::New(env, "Invalid key flag specified.").ThrowAsJavaScriptException();
return env.Null();
					break;
			}
			break;
		case 2:
			break;
		default:
			Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}

	//Get down value if provided.
	if (info.Length() > 1)
	{
		const char *d;

		std::string dstr = info[1].As<Napi::String>();
		d = dstr.c_str();

		if (strcmp(d, "down") == 0)
		{
			down = true;
		}
		else if (strcmp(d, "up") == 0)
		{
			down = false;
		}
		else
		{
			Napi::Error::New(env, "Invalid key state specified.").ThrowAsJavaScriptException();
return env.Null();
		}
	}

	//Get the actual key.
	switch(CheckKeyCodes(k, &key))
	{
		case -1:
			Napi::Error::New(env, "Null pointer in key code.").ThrowAsJavaScriptException();
return env.Null();
			break;
		case -2:
			Napi::Error::New(env, "Invalid key code specified.").ThrowAsJavaScriptException();
return env.Null();
			break;
		default:
			toggleKeyCode(key, down, flags);
			microsleep(keyboardDelay);
	}

	return Napi::Number::New(env, 1);
}

Napi::Value unicodeTapWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	size_t value = info[0].As<Napi::Number>().Int32Value();

	if (value != 0) {
		unicodeTap(value);

		return Napi::Number::New(env, 1);
	} else {
		Napi::Error::New(env, "Invalid character typed.").ThrowAsJavaScriptException();
return env.Null();
	}
}

Napi::Value typeStringWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() > 0) {
		const char *s;
		std::string str = info[0].As<Napi::String>();

		s = str.c_str();

		typeStringDelayed(s, 0);

		return Napi::Number::New(env, 1);
	} else {
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}
}

Napi::Value typeStringDelayedWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() > 0) {
		const char *s;
		std::string str = info[0].As<Napi::String>();

		s = str.c_str();

	size_t cpm = info[1].As<Napi::Number>().Int32Value();

		typeStringDelayed(s, cpm);

		return Napi::Number::New(env, 1);
	} else {
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}
}

Napi::Value setKeyboardDelayWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() != 1)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}

	keyboardDelay = info[0].As<Napi::Number>().Int32Value();

	return Napi::Number::New(env, 1);
}

/*
  ____
 / ___|  ___ _ __ ___  ___ _ __
 \___ \ / __| '__/ _ \/ _ \ '_ \
  ___) | (__| | |  __/  __/ | | |
 |____/ \___|_|  \___|\___|_| |_|

*/

/**
 * Pad hex color code with leading zeros.
 * @param color Hex value to pad.
 * @param hex   Hex value to output.
 */
void padHex(MMRGBHex color, char* hex)
{
	//Length needs to be 7 because snprintf includes a terminating null.
	//Use %06x to pad hex value with leading 0s.
	snprintf(hex, 7, "%06x", color);
}

Napi::Value getPixelColorWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() != 2)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}

	MMBitmapRef bitmap;
	MMRGBHex color;

	size_t x = info[0].As<Napi::Number>().Int32Value();
	size_t y = info[1].As<Napi::Number>().Int32Value();

	if (!pointVisibleOnMainDisplay(MMPointMake(x, y)))
	{
		Napi::Error::New(env, "Requested coordinates are outside the main screen's dimensions.").ThrowAsJavaScriptException();
return env.Null();
	}

	bitmap = copyMMBitmapFromDisplayInRect(MMRectMake(x, y, 1, 1));

	color = MMRGBHexAtPoint(bitmap, 0, 0);

	char hex[7];

	padHex(color, hex);

	destroyMMBitmap(bitmap);

	return Napi::String::New(env, hex);
}

Napi::Value getScreenSizeWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	//Get display size.
	MMSize displaySize = getMainDisplaySize();

	//Create our return object.
	Napi::Object obj = Napi::Object::New(env);
	obj.Set(Napi::String::New(env, "width"), Napi::Number::New(env, displaySize.width));
	obj.Set(Napi::String::New(env, "height"), Napi::Number::New(env, displaySize.height));

	//Return our object with .width and .height.
	return obj;
}

Napi::Value getDesktopStateWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();
	Napi::Object state = Napi::Object::New(env);
	Napi::Object session = Napi::Object::New(env);
	Napi::Object capabilities = Napi::Object::New(env);
	Napi::Array displays = Napi::Array::New(env);
	Napi::Array workspaces = Napi::Array::New(env);
	Napi::Array windows = Napi::Array::New(env);

	const char *sessionTypeEnv = getenv("XDG_SESSION_TYPE");
	const char *waylandDisplayEnv = getenv("WAYLAND_DISPLAY");
	const std::string sessionType = sessionTypeEnv != NULL ? sessionTypeEnv : "unknown";
	const std::string waylandDisplayName = waylandDisplayEnv != NULL ? waylandDisplayEnv : "";

	session.Set("sessionType", Napi::String::New(env, sessionType));
	session.Set("xDisplayName", Napi::String::New(env, getXDisplay()));
	session.Set("waylandDisplayName", NullableString(env, waylandDisplayName));

	Display *display = XGetMainDisplay();
	const bool hasDisplay = display != NULL;
	const bool x11Session = sessionType == "x11" || sessionType.empty() || sessionType == "unknown";
	const bool strictTargetingSupported = hasDisplay && x11Session;

	capabilities.Set("backend", Napi::String::New(env, hasDisplay ? "x11" : "unavailable"));
	capabilities.Set("supportsGlobalInputInjection", Napi::Boolean::New(env, strictTargetingSupported));
	capabilities.Set("supportsWindowDiscovery", Napi::Boolean::New(env, hasDisplay));
	capabilities.Set("supportsMonitorGeometry", Napi::Boolean::New(env, hasDisplay));
	capabilities.Set("supportsScreenCapture", Napi::Boolean::New(env, hasDisplay));
	capabilities.Set("supportsWorkspaceIdentity", Napi::Boolean::New(env, hasDisplay));
	capabilities.Set("supportsFocusChanges", Napi::Boolean::New(env, strictTargetingSupported));
	capabilities.Set("supportsStrictTargetVerification", Napi::Boolean::New(env, strictTargetingSupported));

	state.Set("session", session);
	state.Set("capabilities", capabilities);
	state.Set("displays", displays);
	state.Set("workspaces", workspaces);
	state.Set("windows", windows);
	state.Set("activeWindow", env.Null());
	state.Set("currentWorkspaceId", env.Null());
	state.Set("desktopBounds", BuildGeometryObject(env, 0, 0, 0, 0));

	if (!hasDisplay)
	{
		return state;
	}

	Window rootWindow = DefaultRootWindow(display);
	XWindowAttributes rootAttributes;
	XGetWindowAttributes(display, rootWindow, &rootAttributes);
	state.Set("desktopBounds",
	          BuildGeometryObject(env,
	                              0,
	                              0,
	                              static_cast<unsigned int>(rootAttributes.width),
	                              static_cast<unsigned int>(rootAttributes.height)));

	int monitorCount = 0;
	XRRMonitorInfo *monitorInfo = XRRGetMonitors(display, rootWindow, True, &monitorCount);
	if (monitorInfo != NULL && monitorCount > 0)
	{
		for (int index = 0; index < monitorCount; ++index)
		{
			Napi::Object displayItem = Napi::Object::New(env);
			std::string monitorName;
			if (monitorInfo[index].name != None)
			{
				char *atomName = XGetAtomName(display, monitorInfo[index].name);
				if (atomName != NULL)
				{
					monitorName = atomName;
					XFree(atomName);
				}
			}
			displayItem.Set("id", Napi::Number::New(env, index));
			displayItem.Set("name", NullableString(env, monitorName));
			displayItem.Set("x", Napi::Number::New(env, monitorInfo[index].x));
			displayItem.Set("y", Napi::Number::New(env, monitorInfo[index].y));
			displayItem.Set("width", Napi::Number::New(env, monitorInfo[index].width));
			displayItem.Set("height", Napi::Number::New(env, monitorInfo[index].height));
			displayItem.Set("isPrimary", Napi::Boolean::New(env, monitorInfo[index].primary));
			displays.Set(index, displayItem);
		}

		XRRFreeMonitors(monitorInfo);
	}
	else
	{
		Napi::Object displayItem = Napi::Object::New(env);
		displayItem.Set("id", Napi::Number::New(env, 0));
		displayItem.Set("name", NullableString(env, "root"));
		displayItem.Set("x", Napi::Number::New(env, 0));
		displayItem.Set("y", Napi::Number::New(env, 0));
		displayItem.Set("width", Napi::Number::New(env, rootAttributes.width));
		displayItem.Set("height", Napi::Number::New(env, rootAttributes.height));
		displayItem.Set("isPrimary", Napi::Boolean::New(env, true));
		displays.Set(uint32_t(0), displayItem);
	}

	unsigned long numberOfDesktops = 0;
	unsigned long currentDesktop = 0;
	const bool hasNumberOfDesktops = GetCardinalProperty(display, rootWindow, "_NET_NUMBER_OF_DESKTOPS", &numberOfDesktops);
	const bool hasCurrentDesktop = GetCardinalProperty(display, rootWindow, "_NET_CURRENT_DESKTOP", &currentDesktop);
	const std::vector<std::string> desktopNames = GetNullSeparatedStrings(display, rootWindow, "_NET_DESKTOP_NAMES");

	if (hasCurrentDesktop)
	{
		state.Set("currentWorkspaceId", Napi::Number::New(env, currentDesktop));
	}

	if (hasNumberOfDesktops)
	{
		for (unsigned long index = 0; index < numberOfDesktops; ++index)
		{
			Napi::Object workspace = Napi::Object::New(env);
			workspace.Set("id", Napi::Number::New(env, index));
			workspace.Set("name", NullableString(env, index < desktopNames.size() ? desktopNames[index] : ""));
			workspace.Set("isCurrent", Napi::Boolean::New(env, hasCurrentDesktop && currentDesktop == index));
			workspaces.Set(index, workspace);
		}
	}

	Window activeWindow = None;
	if (GetWindowProperty(display, rootWindow, "_NET_ACTIVE_WINDOW", &activeWindow))
	{
		state.Set("activeWindow", BuildWindowObject(env, display, activeWindow, activeWindow));
	}

	const std::vector<Window> clientWindows = GetWindowListProperty(display, rootWindow, "_NET_CLIENT_LIST");
	for (size_t index = 0; index < clientWindows.size(); ++index)
	{
		windows.Set(index, BuildWindowObject(env, display, clientWindows[index], activeWindow));
	}

	return state;
}

Napi::Value focusWindowWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() != 1)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
return env.Null();
	}

	Display *display = XGetMainDisplay();
	if (display == NULL)
	{
		Napi::Error::New(env, "Could not open X11 display for focus request.").ThrowAsJavaScriptException();
return env.Null();
	}

	Window window = ParseWindowId(info[0]);
	Window rootWindow = DefaultRootWindow(display);
	Atom activeWindowAtom = XInternAtom(display, "_NET_ACTIVE_WINDOW", False);
	XEvent event;
	memset(&event, 0, sizeof(event));
	event.xclient.type = ClientMessage;
	event.xclient.message_type = activeWindowAtom;
	event.xclient.display = display;
	event.xclient.window = window;
	event.xclient.format = 32;
	event.xclient.data.l[0] = 1;
	event.xclient.data.l[1] = CurrentTime;

	XSendEvent(display,
	           rootWindow,
	           False,
	           SubstructureRedirectMask | SubstructureNotifyMask,
	           &event);
	XFlush(display);

	return Napi::Number::New(env, 1);
}

Napi::Value getClipboardTextWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	#if defined(USE_X11)
	char *clipboardText = NULL;
	char *errorMessage = NULL;

	if (!XGetClipboardText(&clipboardText, &errorMessage))
	{
		const char *message = errorMessage != NULL ? errorMessage : "Could not read clipboard text.";
		Napi::Error::New(env, message).ThrowAsJavaScriptException();
		if (clipboardText != NULL)
		{
			free(clipboardText);
		}
		if (errorMessage != NULL)
		{
			free(errorMessage);
		}
		return env.Null();
	}

	Napi::Value result = Napi::String::New(env, clipboardText != NULL ? clipboardText : "");

	if (clipboardText != NULL)
	{
		free(clipboardText);
	}

	if (errorMessage != NULL)
	{
		free(errorMessage);
	}

	return result;
	#else
	Napi::Error::New(env, "Clipboard text is only supported on Linux X11 sessions.").ThrowAsJavaScriptException();
	return env.Null();
	#endif
}

Napi::Value clearClipboardTextWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	#if defined(USE_X11)
	char *errorMessage = NULL;

	if (!XClearClipboardText(&errorMessage))
	{
		const char *message = errorMessage != NULL ? errorMessage : "Could not clear clipboard text.";
		Napi::Error::New(env, message).ThrowAsJavaScriptException();
		if (errorMessage != NULL)
		{
			free(errorMessage);
		}
		return env.Null();
	}

	if (errorMessage != NULL)
	{
		free(errorMessage);
	}

	return Napi::Number::New(env, 1);
	#else
	Napi::Error::New(env, "Clipboard text is only supported on Linux X11 sessions.").ThrowAsJavaScriptException();
	return env.Null();
	#endif
}

Napi::Value getXDisplayNameWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	#if defined(USE_X11)
	const char* display = getXDisplay();
	return Napi::String::New(env, display);
	#else
	Napi::Error::New(env, "getXDisplayName is only supported on Linux").ThrowAsJavaScriptException();
	return env.Null();
	#endif
}

Napi::Value setXDisplayNameWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	#if defined(USE_X11)
	std::string string = info[0].As<Napi::String>();
	setXDisplay(string.c_str());
	return Napi::Number::New(env, 1);
	#else
	Napi::Error::New(env, "setXDisplayName is only supported on Linux").ThrowAsJavaScriptException();
	return env.Null();
	#endif
}

Napi::Value captureScreenWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();
	size_t x;
	size_t y;
	size_t w;
	size_t h;
	const MMSize displaySize = getMainDisplaySize();

	if (info.Length() == 4)
	{
		double values[4];
		for (size_t index = 0; index < 4; ++index)
		{
			if (!info[index].IsNumber())
			{
				Napi::TypeError::New(env, "Screen capture coordinates and dimensions must be integers.")
					.ThrowAsJavaScriptException();
				return env.Null();
			}
			values[index] = info[index].As<Napi::Number>().DoubleValue();
			if (!std::isfinite(values[index]) || std::floor(values[index]) != values[index])
			{
				Napi::TypeError::New(env, "Screen capture coordinates and dimensions must be finite integers.")
					.ThrowAsJavaScriptException();
				return env.Null();
			}
		}
		if (values[0] < 0.0 || values[1] < 0.0 || values[2] < 1.0 || values[3] < 1.0 ||
			values[0] > static_cast<double>(std::numeric_limits<int32_t>::max()) ||
			values[1] > static_cast<double>(std::numeric_limits<int32_t>::max()) ||
			values[2] > static_cast<double>(std::numeric_limits<uint32_t>::max()) ||
			values[3] > static_cast<double>(std::numeric_limits<uint32_t>::max()))
		{
			Napi::RangeError::New(env, "Screen capture origin must be non-negative and dimensions must be positive.")
				.ThrowAsJavaScriptException();
			return env.Null();
		}

		x = static_cast<size_t>(values[0]);
		y = static_cast<size_t>(values[1]);
		w = static_cast<size_t>(values[2]);
		h = static_cast<size_t>(values[3]);
		if (x > displaySize.width || y > displaySize.height ||
			w > displaySize.width - x || h > displaySize.height - y)
		{
			Napi::RangeError::New(env, "Requested screen capture is outside the desktop bounds.")
				.ThrowAsJavaScriptException();
			return env.Null();
		}
	}
	else if (info.Length() == 0)
	{
		x = 0;
		y = 0;
		w = displaySize.width;
		h = displaySize.height;
	}
	else
	{
		Napi::TypeError::New(env, "Screen capture requires either zero arguments or x, y, width, and height.")
			.ThrowAsJavaScriptException();
		return env.Null();
	}

	if (w == 0 || h == 0)
	{
		Napi::Error::New(env, "Screen capture is unavailable because the X11 desktop has no usable bounds.")
			.ThrowAsJavaScriptException();
		return env.Null();
	}

	MMBitmapRef bitmap = copyMMBitmapFromDisplayInRect(MMRectMake(x, y, w, h));
	if (bitmap == NULL)
	{
		Napi::Error::New(env, "X11 screen capture failed for the requested region.")
			.ThrowAsJavaScriptException();
		return env.Null();
	}
	Napi::Object obj = BuildBitmapObject(env, bitmap);
	destroyMMBitmap(bitmap);
	return obj;
}

/*
 ____  _ _
| __ )(_) |_ _ __ ___   __ _ _ __
|  _ \| | __| '_ ` _ \ / _` | '_ \
| |_) | | |_| | | | | | (_| | |_) |
|____/|_|\__|_| |_| |_|\__,_| .__/
                            |_|
 */

class BMP
{
	public:
		size_t width;
		size_t height;
		size_t byteWidth;
		uint8_t bitsPerPixel;
		uint8_t bytesPerPixel;
		uint8_t *image;
};

static Napi::Object BuildBitmapObject(Napi::Env env, MMBitmapRef bitmap);

static Napi::Object BuildBitmapObject(Napi::Env env, MMBitmapRef bitmap)
{
	const uint32_t bufferSize = bitmap->bytewidth * bitmap->height;
	Napi::Object buffer = Napi::Buffer<char>::Copy(env, (char*)bitmap->imageBuffer, bufferSize);
	Napi::Object obj = Napi::Object::New(env);
	obj.Set("width", Napi::Number::New(env, bitmap->width));
	obj.Set("height", Napi::Number::New(env, bitmap->height));
	obj.Set("byteWidth", Napi::Number::New(env, bitmap->bytewidth));
	obj.Set("bitsPerPixel", Napi::Number::New(env, bitmap->bitsPerPixel));
	obj.Set("bytesPerPixel", Napi::Number::New(env, bitmap->bytesPerPixel));
	obj.Set("image", buffer);
	return obj;
}

//Convert object from Javascript to a C++ class (BMP).
BMP buildBMP(Napi::Object obj)
{
	BMP img;
	auto ReadPositiveUint32 = [&obj](const char *name) -> uint32_t
	{
		const Napi::Value value = obj.Get(name);
		if (!value.IsNumber())
		{
			throw std::invalid_argument(std::string("Bitmap ") + name + " must be a positive integer.");
		}
		const double number = value.As<Napi::Number>().DoubleValue();
		if (!std::isfinite(number) || number < 1.0 || std::floor(number) != number ||
			number > static_cast<double>(std::numeric_limits<uint32_t>::max()))
		{
			throw std::invalid_argument(std::string("Bitmap ") + name + " must be a positive 32-bit integer.");
		}
		return static_cast<uint32_t>(number);
	};

	img.width = ReadPositiveUint32("width");
	img.height = ReadPositiveUint32("height");
	img.byteWidth = ReadPositiveUint32("byteWidth");
	img.bitsPerPixel = ReadPositiveUint32("bitsPerPixel");
	img.bytesPerPixel = ReadPositiveUint32("bytesPerPixel");
	if ((img.bytesPerPixel != 3 && img.bytesPerPixel != 4) ||
		img.bitsPerPixel != img.bytesPerPixel * 8)
	{
		throw std::invalid_argument("Bitmap pixel format must be 24-bit RGB or 32-bit RGBA.");
	}
	if (img.width > std::numeric_limits<size_t>::max() / img.bytesPerPixel ||
		img.byteWidth < img.width * img.bytesPerPixel ||
		img.height > std::numeric_limits<size_t>::max() / img.byteWidth)
	{
		throw std::invalid_argument("Bitmap dimensions or row stride are invalid.");
	}

	const Napi::Value image_value = obj.Get("image");
	if (!image_value.IsBuffer())
	{
		throw std::invalid_argument("Bitmap image must be a Buffer.");
	}
	const Napi::Buffer<char> buffer = image_value.As<Napi::Buffer<char>>();
	const size_t image_size = static_cast<size_t>(img.byteWidth) * img.height;
	if (buffer.Length() < image_size)
	{
		throw std::invalid_argument("Bitmap image Buffer is shorter than its declared dimensions.");
	}

	img.image = static_cast<uint8_t *>(malloc(image_size));
	if (img.image == NULL)
	{
		throw std::bad_alloc();
	}
	memcpy(img.image, buffer.Data(), image_size);

	return img;
 }

static MMBitmapRef BuildMMBitmapFromJsObject(const Napi::Object& obj)
{
	BMP img = buildBMP(obj);
	return createMMBitmap(img.image,
	                      img.width,
	                      img.height,
	                      img.byteWidth,
	                      img.bitsPerPixel,
	                      img.bytesPerPixel);
}

typedef struct search_match_result_t {
	bool found;
	bool hasCandidate;
	double score;
	size_t x;
	size_t y;
	size_t width;
	size_t height;
	double overlapRatio;
} search_match_result_t;

typedef struct fuzzy_overlap_t {
	size_t needleLeft;
	size_t needleTop;
	size_t needleRight;
	size_t needleBottom;
	size_t visibleX;
	size_t visibleY;
	size_t width;
	size_t height;
	double overlapRatio;
} fuzzy_overlap_t;

typedef struct fuzzy_anchor_t {
	size_t x;
	size_t y;
	MMRGBColor color;
	size_t colorCount;
	size_t order;
} fuzzy_anchor_t;

typedef struct fuzzy_candidate_result_t {
	bool valid;
	double score;
	int offsetX;
	int offsetY;
	fuzzy_overlap_t overlap;
} fuzzy_candidate_result_t;

typedef struct fuzzy_search_metrics_t {
	size_t candidateOffsetsEvaluated;
	size_t requestedThreadCount;
	size_t availableThreadCount;
	size_t effectiveThreadCount;
	double candidateScanMilliseconds;
	double verificationMilliseconds;
	double threadBudgetWaitMilliseconds;
	double elapsedMilliseconds;
} fuzzy_search_metrics_t;

static search_match_result_t MakeSearchMatchResult(bool found,
	                                              bool has_candidate,
	                                              double score,
	                                              size_t x,
	                                              size_t y,
	                                              size_t width,
	                                              size_t height,
	                                              double overlap_ratio)
{
	search_match_result_t result;
	result.found = found;
	result.hasCandidate = has_candidate;
	result.score = score;
	result.x = x;
	result.y = y;
	result.width = width;
	result.height = height;
	result.overlapRatio = overlap_ratio;
	return result;
}

static Napi::Object BuildSearchMatchObject(Napi::Env env,
	                                      const search_match_result_t& match_result)
{
	Napi::Object result = Napi::Object::New(env);
	result.Set("found", Napi::Boolean::New(env, match_result.found));
	if (match_result.hasCandidate)
	{
		Napi::Object location = Napi::Object::New(env);
		Napi::Object size = Napi::Object::New(env);
		location.Set("x", Napi::Number::New(env, match_result.x));
		location.Set("y", Napi::Number::New(env, match_result.y));
		size.Set("width", Napi::Number::New(env, match_result.width));
		size.Set("height", Napi::Number::New(env, match_result.height));
		result.Set("score", Napi::Number::New(env, match_result.score));
		result.Set("location", location);
		result.Set("size", size);
		result.Set("overlap_ratio", Napi::Number::New(env, match_result.overlapRatio));
	}
	else
	{
		result.Set("score", env.Null());
		result.Set("location", env.Null());
		result.Set("size", env.Null());
		result.Set("overlap_ratio", env.Null());
	}

	return result;
}

static Napi::Object BuildFuzzySearchMetricsObject(
	Napi::Env env,
	const fuzzy_search_metrics_t& native_metrics)
{
	Napi::Object metrics = Napi::Object::New(env);
	metrics.Set("candidate_offsets_evaluated", Napi::Number::New(
		env,
		native_metrics.candidateOffsetsEvaluated));
	metrics.Set("requested_thread_count", Napi::Number::New(
		env,
		native_metrics.requestedThreadCount));
	metrics.Set("available_thread_count", Napi::Number::New(
		env,
		native_metrics.availableThreadCount));
	metrics.Set("effective_thread_count", Napi::Number::New(
		env,
		native_metrics.effectiveThreadCount));
	metrics.Set("candidate_scan_ms", Napi::Number::New(
		env,
		native_metrics.candidateScanMilliseconds));
	metrics.Set("verification_ms", Napi::Number::New(
		env,
		native_metrics.verificationMilliseconds));
	metrics.Set("thread_budget_wait_ms", Napi::Number::New(
		env,
		native_metrics.threadBudgetWaitMilliseconds));
	metrics.Set("elapsed_ms", Napi::Number::New(
		env,
		native_metrics.elapsedMilliseconds));
	return metrics;
}

static MMRGBColor GetBitmapColorAt(MMBitmapRef image, size_t x, size_t y)
{
	return *(MMRGBColor *)(image->imageBuffer + ((image->bytewidth * y) + (x * image->bytesPerPixel)));
}

static size_t GetFuzzySampleStep(size_t width, size_t height, size_t explicitStep)
{
	if (explicitStep > 0)
	{
		return explicitStep;
	}

	const size_t area = width * height;
	if (area >= 40000)
	{
		return 4;
	}

	if (area >= 10000)
	{
		return 3;
	}

	if (area >= 2500)
	{
		return 2;
	}

	return 1;
}

static size_t CountFuzzyColorOccurrences(MMBitmapRef bitmap, const MMRGBColor& color)
{
	size_t count = 0;

	for (size_t y = 0; y < bitmap->height; ++y)
	{
		for (size_t x = 0; x < bitmap->width; ++x)
		{
			if (MMRGBColorEqualToColor(GetBitmapColorAt(bitmap, x, y), color))
			{
				++count;
			}
		}
	}

	return count;
}

static bool IsSameAnchorPoint(const fuzzy_anchor_t& anchor, size_t x, size_t y)
{
	return anchor.x == x && anchor.y == y;
}

static void AddFuzzyAnchorCandidate(std::vector<fuzzy_anchor_t> *candidates,
	                               MMBitmapRef needle,
	                               size_t x,
	                               size_t y,
	                               size_t order)
{
	for (size_t index = 0; index < candidates->size(); ++index)
	{
		if (IsSameAnchorPoint((*candidates)[index], x, y))
		{
			return;
		}
	}

	fuzzy_anchor_t anchor;
	anchor.x = x;
	anchor.y = y;
	anchor.color = GetBitmapColorAt(needle, x, y);
	anchor.colorCount = CountFuzzyColorOccurrences(needle, anchor.color);
	anchor.order = order;
	candidates->push_back(anchor);
}

static void SortFuzzyAnchors(std::vector<fuzzy_anchor_t> *anchors)
{
	for (size_t left = 0; left < anchors->size(); ++left)
	{
		size_t best_index = left;

		for (size_t right = left + 1; right < anchors->size(); ++right)
		{
			if ((*anchors)[right].colorCount < (*anchors)[best_index].colorCount ||
			    ((*anchors)[right].colorCount == (*anchors)[best_index].colorCount &&
			     (*anchors)[right].order < (*anchors)[best_index].order))
			{
				best_index = right;
			}
		}

		if (best_index != left)
		{
			fuzzy_anchor_t swap = (*anchors)[left];
			(*anchors)[left] = (*anchors)[best_index];
			(*anchors)[best_index] = swap;
		}
	}
}

static std::vector<fuzzy_anchor_t> BuildFuzzyAnchors(MMBitmapRef needle)
{
	std::vector<fuzzy_anchor_t> candidates;
	std::vector<fuzzy_anchor_t> anchors;
	const size_t last_x = needle->width - 1;
	const size_t last_y = needle->height - 1;
	const size_t mid_x = last_x / 2;
	const size_t mid_y = last_y / 2;
	const size_t quarter_x = last_x / 4;
	const size_t quarter_y = last_y / 4;
	const size_t three_quarter_x = (last_x * 3) / 4;
	const size_t three_quarter_y = (last_y * 3) / 4;

	candidates.reserve(17);
	anchors.reserve(8);

	AddFuzzyAnchorCandidate(&candidates, needle, mid_x, mid_y, 0);
	AddFuzzyAnchorCandidate(&candidates, needle, last_x, last_y, 1);
	AddFuzzyAnchorCandidate(&candidates, needle, 0, 0, 2);
	AddFuzzyAnchorCandidate(&candidates, needle, last_x, 0, 3);
	AddFuzzyAnchorCandidate(&candidates, needle, 0, last_y, 4);
	AddFuzzyAnchorCandidate(&candidates, needle, mid_x, 0, 5);
	AddFuzzyAnchorCandidate(&candidates, needle, 0, mid_y, 6);
	AddFuzzyAnchorCandidate(&candidates, needle, last_x, mid_y, 7);
	AddFuzzyAnchorCandidate(&candidates, needle, mid_x, last_y, 8);
	AddFuzzyAnchorCandidate(&candidates, needle, quarter_x, quarter_y, 9);
	AddFuzzyAnchorCandidate(&candidates, needle, three_quarter_x, quarter_y, 10);
	AddFuzzyAnchorCandidate(&candidates, needle, quarter_x, three_quarter_y, 11);
	AddFuzzyAnchorCandidate(&candidates, needle, three_quarter_x, three_quarter_y, 12);
	AddFuzzyAnchorCandidate(&candidates, needle, mid_x, quarter_y, 13);
	AddFuzzyAnchorCandidate(&candidates, needle, quarter_x, mid_y, 14);
	AddFuzzyAnchorCandidate(&candidates, needle, three_quarter_x, mid_y, 15);
	AddFuzzyAnchorCandidate(&candidates, needle, mid_x, three_quarter_y, 16);

	SortFuzzyAnchors(&candidates);

	for (size_t index = 0; index < candidates.size() && index < 8; ++index)
	{
		anchors.push_back(candidates[index]);
	}

	return anchors;
}

static bool IsPointOnSampleGrid(size_t x, size_t y, size_t start_x, size_t start_y, size_t sample_step)
{
	return ((x - start_x) % sample_step) == 0 && ((y - start_y) % sample_step) == 0;
}

static bool BuildFuzzyOverlap(MMBitmapRef needle,
	                         MMBitmapRef haystack,
	                         int offset_x,
	                         int offset_y,
	                         double minimum_overlap_ratio,
	                         fuzzy_overlap_t *overlap)
{
	int overlap_left = offset_x < 0 ? -offset_x : 0;
	int overlap_top = offset_y < 0 ? -offset_y : 0;
	int overlap_right = static_cast<int>(needle->width);
	int overlap_bottom = static_cast<int>(needle->height);

	if (offset_x + overlap_right > static_cast<int>(haystack->width))
	{
		overlap_right = static_cast<int>(haystack->width) - offset_x;
	}

	if (offset_y + overlap_bottom > static_cast<int>(haystack->height))
	{
		overlap_bottom = static_cast<int>(haystack->height) - offset_y;
	}

	if (overlap_left >= overlap_right || overlap_top >= overlap_bottom)
	{
		return false;
	}

	overlap->needleLeft = static_cast<size_t>(overlap_left);
	overlap->needleTop = static_cast<size_t>(overlap_top);
	overlap->needleRight = static_cast<size_t>(overlap_right);
	overlap->needleBottom = static_cast<size_t>(overlap_bottom);
	overlap->width = static_cast<size_t>(overlap_right - overlap_left);
	overlap->height = static_cast<size_t>(overlap_bottom - overlap_top);
	overlap->visibleX = static_cast<size_t>(offset_x < 0 ? 0 : offset_x);
	overlap->visibleY = static_cast<size_t>(offset_y < 0 ? 0 : offset_y);
	overlap->overlapRatio = static_cast<double>(overlap->width * overlap->height) /
		static_cast<double>(needle->width * needle->height);

	return overlap->overlapRatio >= minimum_overlap_ratio;
}

static size_t CountFuzzySearchSamples(const fuzzy_overlap_t& overlap,
	                                 const std::vector<fuzzy_anchor_t>& anchors,
	                                 size_t sample_step)
{
	size_t sample_count = 0;

	for (size_t index = 0; index < anchors.size(); ++index)
	{
		const fuzzy_anchor_t& anchor = anchors[index];
		if (anchor.x >= overlap.needleLeft && anchor.x < overlap.needleRight &&
		    anchor.y >= overlap.needleTop && anchor.y < overlap.needleBottom &&
		    !IsPointOnSampleGrid(anchor.x, anchor.y, overlap.needleLeft, overlap.needleTop, sample_step))
		{
			++sample_count;
		}
	}

	for (size_t needle_y = overlap.needleTop; needle_y < overlap.needleBottom; needle_y += sample_step)
	{
		for (size_t needle_x = overlap.needleLeft; needle_x < overlap.needleRight; needle_x += sample_step)
		{
			++sample_count;
		}
	}

	return sample_count;
}

static double DirectFuzzyColorSimilarity(MMRGBColor first, MMRGBColor second)
{
	const double red_delta =
		static_cast<double>(first.red) - static_cast<double>(second.red);
	const double green_delta =
		static_cast<double>(first.green) - static_cast<double>(second.green);
	const double blue_delta =
		static_cast<double>(first.blue) - static_cast<double>(second.blue);
	const double distance = std::sqrt(
		(red_delta * red_delta) +
		(green_delta * green_delta) +
		(blue_delta * blue_delta));
	return std::max(
		0.0,
		std::min(1.0, 1.0 - (distance / 441.67295593)));
}

static double NormalizeFuzzySimilarity(
	MMRGBColor needle_color,
	MMRGBColor haystack_color,
	double minimum_similarity)
{
	double similarity = DirectFuzzyColorSimilarity(needle_color, haystack_color);
	if (similarity < minimum_similarity)
	{
		similarity = 0.0;
	}

	return similarity;
}

static fuzzy_candidate_result_t EvaluateFuzzyCandidate(MMBitmapRef needle,
	                                                  MMBitmapRef haystack,
	                                                  int offset_x,
	                                                  int offset_y,
	                                                  const fuzzy_overlap_t& overlap,
	                                                  double minimum_similarity,
	                                                  size_t sample_step,
	                                                  const std::vector<fuzzy_anchor_t>& anchors,
	                                                  double best_score)
{
	fuzzy_candidate_result_t result;
	const size_t total_samples = CountFuzzySearchSamples(overlap, anchors, sample_step);
	double score_total = 0.0;
	size_t processed_samples = 0;

	result.valid = false;
	result.score = -1.0;
	result.offsetX = offset_x;
	result.offsetY = offset_y;
	result.overlap = overlap;

	if (total_samples == 0)
	{
		return result;
	}

	for (size_t index = 0; index < anchors.size(); ++index)
	{
		const fuzzy_anchor_t& anchor = anchors[index];
		if (anchor.x < overlap.needleLeft || anchor.x >= overlap.needleRight ||
		    anchor.y < overlap.needleTop || anchor.y >= overlap.needleBottom ||
		    IsPointOnSampleGrid(anchor.x, anchor.y, overlap.needleLeft, overlap.needleTop, sample_step))
		{
			continue;
		}

		score_total += NormalizeFuzzySimilarity(
		                                       anchor.color,
		                                       GetBitmapColorAt(haystack,
		                                                       static_cast<size_t>(offset_x + static_cast<int>(anchor.x)),
		                                                       static_cast<size_t>(offset_y + static_cast<int>(anchor.y))),
		                                       minimum_similarity);
		++processed_samples;

		if (best_score >= 0.0)
		{
			const double max_possible_score =
				(score_total + static_cast<double>(total_samples - processed_samples)) /
				static_cast<double>(total_samples);
			if (max_possible_score < best_score)
			{
				return result;
			}
		}
	}

	for (size_t needle_y = overlap.needleTop; needle_y < overlap.needleBottom; needle_y += sample_step)
	{
		for (size_t needle_x = overlap.needleLeft; needle_x < overlap.needleRight; needle_x += sample_step)
		{
			score_total += NormalizeFuzzySimilarity(
			                                       GetBitmapColorAt(needle, needle_x, needle_y),
			                                       GetBitmapColorAt(haystack,
			                                                       static_cast<size_t>(offset_x + static_cast<int>(needle_x)),
			                                                       static_cast<size_t>(offset_y + static_cast<int>(needle_y))),
			                                       minimum_similarity);
			++processed_samples;

			if (best_score >= 0.0)
			{
				const double max_possible_score =
					(score_total + static_cast<double>(total_samples - processed_samples)) /
					static_cast<double>(total_samples);
				if (max_possible_score < best_score)
				{
					return result;
				}
			}
		}
	}

	result.valid = true;
	result.score = score_total / static_cast<double>(total_samples);
	return result;
}

static double ScoreFuzzyCandidateFully(MMBitmapRef needle,
	                                  MMBitmapRef haystack,
	                                  int offset_x,
	                                  int offset_y,
	                                  const fuzzy_overlap_t& overlap,
	                                  double minimum_similarity)
{
	double score_total = 0.0;
	const size_t total_pixels = overlap.width * overlap.height;

	if (total_pixels == 0)
	{
		return -1.0;
	}

	for (size_t needle_y = overlap.needleTop; needle_y < overlap.needleBottom; ++needle_y)
	{
		for (size_t needle_x = overlap.needleLeft; needle_x < overlap.needleRight; ++needle_x)
		{
			score_total += NormalizeFuzzySimilarity(
			                                       GetBitmapColorAt(needle, needle_x, needle_y),
			                                       GetBitmapColorAt(haystack,
			                                                       static_cast<size_t>(offset_x + static_cast<int>(needle_x)),
			                                                       static_cast<size_t>(offset_y + static_cast<int>(needle_y))),
			                                       minimum_similarity);
		}
	}

	return score_total / static_cast<double>(total_pixels);
}

static search_match_result_t FindBestFuzzyBitmapMatch(MMBitmapRef needle,
	                                                 MMBitmapRef haystack,
	                                                 double threshold,
	                                                 double tolerance,
	                                                 bool allowPartialMatch,
	                                                 double minimumOverlapRatio,
	                                                 size_t sampleStep,
	                                                 size_t threadCount,
	                                                 fuzzy_search_metrics_t *metrics)
{
	const auto started_at = std::chrono::steady_clock::now();
	search_match_result_t no_candidate = MakeSearchMatchResult(false, false, 0.0, 0, 0, 0, 0, 0.0);
	*metrics = {};
	metrics->effectiveThreadCount = 1;
	metrics->requestedThreadCount = threadCount;

	if (needle == NULL || haystack == NULL)
	{
		metrics->elapsedMilliseconds = std::chrono::duration<double, std::milli>(
			std::chrono::steady_clock::now() - started_at).count();
		return no_candidate;
	}

	if (needle->width == 0 || needle->height == 0 || haystack->width == 0 || haystack->height == 0)
	{
		metrics->elapsedMilliseconds = std::chrono::duration<double, std::milli>(
			std::chrono::steady_clock::now() - started_at).count();
		return no_candidate;
	}

	if (!allowPartialMatch && (needle->width > haystack->width || needle->height > haystack->height))
	{
		metrics->elapsedMilliseconds = std::chrono::duration<double, std::milli>(
			std::chrono::steady_clock::now() - started_at).count();
		return no_candidate;
	}

	const int minX = allowPartialMatch ? -(static_cast<int>(needle->width) - 1) : 0;
	const int minY = allowPartialMatch ? -(static_cast<int>(needle->height) - 1) : 0;
	const int maxX = allowPartialMatch ? static_cast<int>(haystack->width) - 1 : static_cast<int>(haystack->width - needle->width);
	const int maxY = allowPartialMatch ? static_cast<int>(haystack->height) - 1 : static_cast<int>(haystack->height - needle->height);
	const std::vector<fuzzy_anchor_t> anchors = BuildFuzzyAnchors(needle);
	const double minimum_similarity = 1.0 - tolerance;
	const size_t row_count = static_cast<size_t>(maxY - minY + 1);
	const size_t column_count = static_cast<size_t>(maxX - minX + 1);
	const size_t proposed_thread_count =
		row_count * column_count >= 65536
		? std::min(std::max<size_t>(1, threadCount), row_count)
		: 1;
	NativeThreadReservation thread_reservation(proposed_thread_count);
	const size_t effective_thread_count = thread_reservation.ThreadCount();
	metrics->effectiveThreadCount = effective_thread_count;
	metrics->availableThreadCount = thread_reservation.Capacity();
	metrics->threadBudgetWaitMilliseconds = thread_reservation.WaitMilliseconds();

	struct WorkerResult
	{
		double bestScore = -1.0;
		bool hasCandidate = false;
		int bestOffsetX = 0;
		int bestOffsetY = 0;
		fuzzy_overlap_t bestOverlap = { 0, 0, 0, 0, 0, 0, 0, 0, 0.0 };
		size_t candidateOffsetsEvaluated = 0;
		std::exception_ptr error;
	};
	std::vector<WorkerResult> worker_results(effective_thread_count);
	const auto scan_started_at = std::chrono::steady_clock::now();
	auto scan_rows = [&](size_t worker_index, int first_y, int last_y)
	{
		WorkerResult& worker_result = worker_results[worker_index];
		try
		{
			for (int offset_y = first_y; offset_y < last_y; ++offset_y)
			{
				for (int offset_x = minX; offset_x <= maxX; ++offset_x)
				{
					++worker_result.candidateOffsetsEvaluated;
					fuzzy_overlap_t overlap;
					if (!BuildFuzzyOverlap(
						needle,
						haystack,
						offset_x,
						offset_y,
						minimumOverlapRatio,
						&overlap))
					{
						continue;
					}

					const fuzzy_candidate_result_t candidate = EvaluateFuzzyCandidate(
						needle,
						haystack,
						offset_x,
						offset_y,
						overlap,
						minimum_similarity,
						sampleStep,
						anchors,
						worker_result.bestScore);
					if (!candidate.valid)
					{
						continue;
					}
					if (!worker_result.hasCandidate ||
						candidate.score > worker_result.bestScore)
					{
						worker_result.hasCandidate = true;
						worker_result.bestScore = candidate.score;
						worker_result.bestOffsetX = candidate.offsetX;
						worker_result.bestOffsetY = candidate.offsetY;
						worker_result.bestOverlap = candidate.overlap;
					}
				}
			}
		}
		catch (...)
		{
			worker_result.error = std::current_exception();
		}
	};

	std::vector<std::thread> threads;
	threads.reserve(effective_thread_count - 1);
	try
	{
		for (size_t worker_index = 1; worker_index < effective_thread_count; ++worker_index)
		{
			const int first_y = minY + static_cast<int>(
				(row_count * worker_index) / effective_thread_count);
			const int last_y = minY + static_cast<int>(
				(row_count * (worker_index + 1)) / effective_thread_count);
			threads.emplace_back(scan_rows, worker_index, first_y, last_y);
		}
		scan_rows(
			0,
			minY,
			minY + static_cast<int>(row_count / effective_thread_count));
	}
	catch (...)
	{
		for (std::thread& thread : threads)
		{
			if (thread.joinable()) thread.join();
		}
		throw;
	}
	for (std::thread& thread : threads)
	{
		thread.join();
	}

	double best_score = -1.0;
	bool has_candidate = false;
	int best_offset_x = 0;
	int best_offset_y = 0;
	fuzzy_overlap_t best_overlap = { 0, 0, 0, 0, 0, 0, 0, 0, 0.0 };
	for (WorkerResult& worker_result : worker_results)
	{
		if (worker_result.error) std::rethrow_exception(worker_result.error);
		metrics->candidateOffsetsEvaluated += worker_result.candidateOffsetsEvaluated;
		if (worker_result.hasCandidate &&
			(!has_candidate || worker_result.bestScore > best_score))
		{
			has_candidate = true;
			best_score = worker_result.bestScore;
			best_offset_x = worker_result.bestOffsetX;
			best_offset_y = worker_result.bestOffsetY;
			best_overlap = worker_result.bestOverlap;
		}
	}
	metrics->candidateScanMilliseconds = std::chrono::duration<double, std::milli>(
		std::chrono::steady_clock::now() - scan_started_at).count();

	if (!has_candidate)
	{
		metrics->elapsedMilliseconds = std::chrono::duration<double, std::milli>(
			std::chrono::steady_clock::now() - started_at).count();
		return no_candidate;
	}

	const auto verification_started_at = std::chrono::steady_clock::now();
	const double final_score = ScoreFuzzyCandidateFully(needle,
	                                                  haystack,
	                                                  best_offset_x,
	                                                  best_offset_y,
	                                                  best_overlap,
	                                                  minimum_similarity);
	metrics->verificationMilliseconds = std::chrono::duration<double, std::milli>(
		std::chrono::steady_clock::now() - verification_started_at).count();
	const bool found = final_score >= threshold;

	search_match_result_t result = MakeSearchMatchResult(found,
	                            true,
	                            final_score,
	                            best_overlap.visibleX,
	                            best_overlap.visibleY,
	                            best_overlap.width,
	                            best_overlap.height,
	                            best_overlap.overlapRatio);
	metrics->elapsedMilliseconds = std::chrono::duration<double, std::milli>(
		std::chrono::steady_clock::now() - started_at).count();
	return result;
}

static bool IsFiniteNumberValue(const Napi::Value& value, double *result)
{
	if (!value.IsNumber())
	{
		return false;
	}

	const double numeric_value = value.As<Napi::Number>().DoubleValue();
	if (!std::isfinite(numeric_value))
	{
		return false;
	}

	*result = numeric_value;
	return true;
}

static size_t GetPositiveIntegerOption(const Napi::Object& options,
	                                  const char *name,
	                                  size_t default_value)
{
	if (!options.Has(name))
	{
		return default_value;
	}

	double value = 0.0;
	if (!IsFiniteNumberValue(options.Get(name), &value) || value < 1.0 || std::floor(value) != value)
	{
		throw std::invalid_argument(std::string(name) + " must be a positive integer.");
	}
	return static_cast<size_t>(value);
}

static double GetUnitIntervalOption(const Napi::Object& options,
	                               const char *name,
	                               double default_value)
{
	if (!options.Has(name))
	{
		return default_value;
	}

	double value = 0.0;
	if (!IsFiniteNumberValue(options.Get(name), &value) || value < 0.0 || value > 1.0)
	{
		throw std::invalid_argument(std::string(name) + " must be between 0 and 1.");
	}
	return value;
}

static Napi::Object BuildCatalogSearchResultObject(
	Napi::Env env,
	const BitmapCatalogSearchResult& search_result)
{
	const auto result_started_at = std::chrono::steady_clock::now();
	Napi::Object result = Napi::Object::New(env);
	Napi::Array images = Napi::Array::New(env, search_result.images.size());

	for (size_t image_index = 0; image_index < search_result.images.size(); ++image_index)
	{
		const BitmapCatalogImageResult& image_result = search_result.images[image_index];
		Napi::Object image = Napi::Object::New(env);
		Napi::Array occurrences = Napi::Array::New(env, image_result.occurrences.size());
		image.Set("image_index", Napi::Number::New(env, image_result.imageIndex));

		for (size_t occurrence_index = 0; occurrence_index < image_result.occurrences.size(); ++occurrence_index)
		{
			const BitmapCatalogOccurrence& native_occurrence = image_result.occurrences[occurrence_index];
			Napi::Object occurrence = Napi::Object::New(env);
			occurrence.Set("x", Napi::Number::New(env, native_occurrence.x));
			occurrence.Set("y", Napi::Number::New(env, native_occurrence.y));
			occurrence.Set("width", Napi::Number::New(env, native_occurrence.width));
			occurrence.Set("height", Napi::Number::New(env, native_occurrence.height));
			occurrence.Set("score", Napi::Number::New(env, native_occurrence.score));
			occurrence.Set("overlap_ratio", Napi::Number::New(env, native_occurrence.overlapRatio));
			occurrences.Set(occurrence_index, occurrence);
		}

		image.Set("occurrences", occurrences);
		images.Set(image_index, image);
	}

	const BitmapCatalogMetrics& native_metrics = search_result.metrics;
	Napi::Object metrics = Napi::Object::New(env);
	metrics.Set("catalog_images", Napi::Number::New(env, native_metrics.catalogImages));
	metrics.Set("fingerprint_entries", Napi::Number::New(env, native_metrics.fingerprintEntries));
	metrics.Set("haystack_pixels_scanned", Napi::Number::New(env, native_metrics.haystackPixelsScanned));
	metrics.Set("index_buckets_visited", Napi::Number::New(env, native_metrics.indexBucketsVisited));
	metrics.Set("candidate_offsets_generated", Napi::Number::New(env, native_metrics.candidateOffsetsGenerated));
	metrics.Set("candidate_offsets_verified", Napi::Number::New(env, native_metrics.candidateOffsetsVerified));
	metrics.Set("verification_pixels_compared", Napi::Number::New(env, native_metrics.verificationPixelsCompared));
	metrics.Set("fingerprint_collisions_tested", Napi::Number::New(env, native_metrics.fingerprintCollisionsTested));
	metrics.Set("candidate_votes_recorded", Napi::Number::New(env, native_metrics.candidateVotesRecorded));
	metrics.Set("evidence_cells_initialized", Napi::Number::New(env, native_metrics.evidenceCellsInitialized));
	metrics.Set("evidence_cells_examined", Napi::Number::New(env, native_metrics.evidenceCellsExamined));
	metrics.Set("workspace_bytes", Napi::Number::New(env, native_metrics.workspaceBytes));
	metrics.Set("requested_thread_count", Napi::Number::New(
		env,
		native_metrics.requestedThreadCount));
	metrics.Set("available_thread_count", Napi::Number::New(
		env,
		native_metrics.availableThreadCount));
	metrics.Set("effective_thread_count", Napi::Number::New(env, native_metrics.effectiveThreadCount));
	metrics.Set("candidate_scan_ms", Napi::Number::New(env, native_metrics.candidateScanMilliseconds));
	metrics.Set("candidate_extraction_ms", Napi::Number::New(env, native_metrics.candidateExtractionMilliseconds));
	metrics.Set("verification_ms", Napi::Number::New(env, native_metrics.verificationMilliseconds));
	metrics.Set("bitmap_copy_ms", Napi::Number::New(env, native_metrics.bitmapCopyMilliseconds));
	metrics.Set("queue_ms", Napi::Number::New(env, native_metrics.queueMilliseconds));
	metrics.Set("thread_budget_wait_ms", Napi::Number::New(
		env,
		native_metrics.threadBudgetWaitMilliseconds));
	metrics.Set("elapsed_ms", Napi::Number::New(env, native_metrics.elapsedMilliseconds));
	result.Set("images", images);
	result.Set("metrics", metrics);
	const auto result_built_at = std::chrono::steady_clock::now();
	metrics.Set("result_construction_ms", Napi::Number::New(
		env,
		std::chrono::duration<double, std::milli>(result_built_at - result_started_at).count()));
	return result;
}

class BitmapCatalogSearchWorker : public Napi::AsyncWorker
{
public:
	BitmapCatalogSearchWorker(Napi::Env env,
	                         std::shared_ptr<BitmapCatalogMatcher> matcher,
	                         MMBitmapRef haystack,
	                         size_t thread_count,
	                         double bitmap_copy_milliseconds)
		: Napi::AsyncWorker(env),
		  deferred_(Napi::Promise::Deferred::New(env)),
		  matcher_(std::move(matcher)),
		  haystack_(haystack),
		  thread_count_(thread_count),
		  bitmap_copy_milliseconds_(bitmap_copy_milliseconds),
		  queued_at_(std::chrono::steady_clock::now())
	{
	}

	~BitmapCatalogSearchWorker() override
	{
		if (haystack_ != NULL)
		{
			destroyMMBitmap(haystack_);
		}
	}

	Napi::Promise Promise() const
	{
		return deferred_.Promise();
	}

protected:
	void Execute() override
	{
		try
		{
			const auto execute_started_at = std::chrono::steady_clock::now();
			result_ = matcher_->Search(haystack_, thread_count_);
			result_.metrics.bitmapCopyMilliseconds = bitmap_copy_milliseconds_;
			result_.metrics.queueMilliseconds =
				std::chrono::duration<double, std::milli>(execute_started_at - queued_at_).count();
		}
		catch (const std::exception& error)
		{
			SetError(error.what());
		}
	}

	void OnOK() override
	{
		deferred_.Resolve(BuildCatalogSearchResultObject(Env(), result_));
	}

	void OnError(const Napi::Error& error) override
	{
		deferred_.Reject(error.Value());
	}

private:
	Napi::Promise::Deferred deferred_;
	std::shared_ptr<BitmapCatalogMatcher> matcher_;
	MMBitmapRef haystack_;
	size_t thread_count_;
	double bitmap_copy_milliseconds_;
	std::chrono::steady_clock::time_point queued_at_;
	BitmapCatalogSearchResult result_;
};

class BitmapCatalogMatcherBinding : public Napi::ObjectWrap<BitmapCatalogMatcherBinding>
{
public:
	static void Init(Napi::Env env, Napi::Object exports)
	{
		Napi::Function constructor = DefineClass(env, "BitmapCatalogMatcher", {
			InstanceMethod("search", &BitmapCatalogMatcherBinding::Search)
		});
		exports.Set("BitmapCatalogMatcher", constructor);
	}

	explicit BitmapCatalogMatcherBinding(const Napi::CallbackInfo& info)
		: Napi::ObjectWrap<BitmapCatalogMatcherBinding>(info)
	{
		Napi::Env env = info.Env();
		if (info.Length() != 2 || !info[0].IsArray() || !info[1].IsObject())
		{
			Napi::TypeError::New(env, "BitmapCatalogMatcher requires an image array and options object.")
				.ThrowAsJavaScriptException();
			return;
		}

		std::vector<MMBitmapRef> images;
		try
		{
			Napi::Array image_values = info[0].As<Napi::Array>();
			images.reserve(image_values.Length());
			for (uint32_t index = 0; index < image_values.Length(); ++index)
			{
				if (!image_values.Get(index).IsObject())
				{
					throw std::invalid_argument("Every bitmap catalog image must be an object.");
				}
				images.push_back(BuildMMBitmapFromJsObject(image_values.Get(index).As<Napi::Object>()));
			}

			Napi::Object option_values = info[1].As<Napi::Object>();
			std::string mode = option_values.Has("mode")
				? option_values.Get("mode").As<Napi::String>().Utf8Value()
				: "exact";
			if (mode != "exact" && mode != "fuzzy")
			{
				throw std::invalid_argument("Bitmap catalog mode must be exact or fuzzy.");
			}

			BitmapCatalogOptions options;
			options.mode = mode == "fuzzy" ? BitmapCatalogMatchMode::Fuzzy : BitmapCatalogMatchMode::Exact;
			options.threshold = GetUnitIntervalOption(option_values, "threshold", 0.85);
			options.tolerance = GetUnitIntervalOption(option_values, "tolerance", mode == "fuzzy" ? 0.15 : 0.0);
			options.allowPartialMatch = option_values.Has("allow_partial_match") &&
				option_values.Get("allow_partial_match").ToBoolean().Value();
			options.minimumOverlapRatio = GetUnitIntervalOption(option_values, "minimum_overlap_ratio", 0.6);
			options.candidateStep = GetPositiveIntegerOption(option_values, "candidate_step", 1);
			options.maxResultsPerImage = GetPositiveIntegerOption(option_values, "max_results_per_image", 100);
			options.maxCandidatesPerImage = GetPositiveIntegerOption(option_values, "max_candidates_per_image", 1000000);
			options.threadCount = GetPositiveIntegerOption(option_values, "thread_count", 1);
			if (options.threadCount > 64)
			{
				throw std::invalid_argument("thread_count must not exceed 64.");
			}
			matcher_ = std::make_shared<BitmapCatalogMatcher>(std::move(images), options);
		}
		catch (const std::exception& error)
		{
			for (MMBitmapRef image : images)
			{
				destroyMMBitmap(image);
			}
			Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
		}
	}

private:
	Napi::Value Search(const Napi::CallbackInfo& info)
	{
		Napi::Env env = info.Env();
		if (!matcher_ || info.Length() < 1 || info.Length() > 2 || !info[0].IsObject())
		{
			Napi::TypeError::New(
				env,
				"Bitmap catalog search requires a bitmap and optional thread count.")
				.ThrowAsJavaScriptException();
			return env.Null();
		}

		try
		{
			if (info.Length() > 2)
			{
				throw std::invalid_argument(
					"Bitmap catalog search accepts a bitmap and optional thread count.");
			}
			size_t thread_count = 0;
			if (info.Length() == 2)
			{
				double thread_count_value = 0.0;
				if (!IsFiniteNumberValue(info[1], &thread_count_value) ||
					thread_count_value < 1.0 ||
					thread_count_value > 64.0 ||
					std::floor(thread_count_value) != thread_count_value)
				{
					throw std::invalid_argument(
						"Bitmap catalog search thread count must be an integer between 1 and 64.");
				}
				thread_count = static_cast<size_t>(thread_count_value);
			}
			const auto bitmap_copy_started_at = std::chrono::steady_clock::now();
			MMBitmapRef haystack = BuildMMBitmapFromJsObject(info[0].As<Napi::Object>());
			const double bitmap_copy_milliseconds =
				std::chrono::duration<double, std::milli>(
					std::chrono::steady_clock::now() - bitmap_copy_started_at).count();
			BitmapCatalogSearchWorker *worker = new BitmapCatalogSearchWorker(
				env,
				matcher_,
				haystack,
				thread_count,
				bitmap_copy_milliseconds);
			Napi::Promise promise = worker->Promise();
			worker->Queue();
			return promise;
		}
		catch (const std::exception& error)
		{
			Napi::TypeError::New(env, error.what()).ThrowAsJavaScriptException();
			return env.Null();
		}
	}

	std::shared_ptr<BitmapCatalogMatcher> matcher_;
};

Napi::Value getColorWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();
	MMBitmapRef bitmap;
	MMRGBHex color;

	size_t x = info[1].As<Napi::Number>().Int32Value();
	size_t y = info[2].As<Napi::Number>().Int32Value();

	//Get our image object from JavaScript.
	BMP img = buildBMP(info[0].ToObject());

	//Create the bitmap.
	bitmap = createMMBitmap(img.image, img.width, img.height, img.byteWidth, img.bitsPerPixel, img.bytesPerPixel);

	// Make sure the requested pixel is inside the bitmap.
	if (!MMBitmapPointInBounds(bitmap, MMPointMake(x, y)))
	{
		Napi::Error::New(env, "Requested coordinates are outside the bitmap's dimensions.").ThrowAsJavaScriptException();
return env.Null();
	}

	color = MMRGBHexAtPoint(bitmap, x, y);

	char hex[7];

	padHex(color, hex);

	destroyMMBitmap(bitmap);

	return Napi::String::New(env, hex);

}

Napi::Value loadBitmapFromFileWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() != 1)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
		return env.Null();
	}

	std::string path = info[0].As<Napi::String>();
	const char *extension = getExtension(path.c_str(), path.size());
	MMImageType imageType = kInvalidImageType;
	MMIOError errorCode = kMMIOUnsupportedTypeError;

	if (extension != NULL)
	{
		imageType = imageTypeFromExtension(extension);
	}

	MMBitmapRef bitmap = newMMBitmapFromFile(path.c_str(), imageType, &errorCode);

	if (bitmap == NULL)
	{
		const char *message = MMIOErrorString(imageType, errorCode);
		if (message == NULL)
		{
			message = "Could not load image reference from file.";
		}
		Napi::Error::New(env, message).ThrowAsJavaScriptException();
		return env.Null();
	}

	Napi::Object result = BuildBitmapObject(env, bitmap);
	destroyMMBitmap(bitmap);
	return result;
}

Napi::Value findBitmapWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() < 2)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
		return env.Null();
	}

	MMBitmapRef haystack = BuildMMBitmapFromJsObject(info[0].ToObject());
	MMBitmapRef needle = BuildMMBitmapFromJsObject(info[1].ToObject());
	const float tolerance = info.Length() > 2 ? info[2].As<Napi::Number>().FloatValue() : 0.0f;
	MMPoint point = MMPointZero;
	Napi::Object result;

	if (tolerance < 0.0f || tolerance > 1.0f)
	{
		destroyMMBitmap(haystack);
		destroyMMBitmap(needle);
		Napi::Error::New(env, "Bitmap search tolerance must be between 0 and 1.").ThrowAsJavaScriptException();
		return env.Null();
	}

	const int searchResult = findBitmapInBitmap(needle, haystack, &point, tolerance);
	result = BuildSearchMatchObject(env,
	                               searchResult == 0
	                               	? MakeSearchMatchResult(true, true, 1.0, point.x, point.y, needle->width, needle->height, 1.0)
	                               	: MakeSearchMatchResult(false, false, 0.0, 0, 0, 0, 0, 0.0));

	destroyMMBitmap(haystack);
	destroyMMBitmap(needle);
	return result;
}

Napi::Value findAllBitmapsWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() < 2)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
		return env.Null();
	}

	MMBitmapRef haystack = BuildMMBitmapFromJsObject(info[0].ToObject());
	MMBitmapRef needle = BuildMMBitmapFromJsObject(info[1].ToObject());
	const float tolerance = info.Length() > 2 ? info[2].As<Napi::Number>().FloatValue() : 0.0f;

	if (tolerance < 0.0f || tolerance > 1.0f)
	{
		destroyMMBitmap(haystack);
		destroyMMBitmap(needle);
		Napi::Error::New(env, "Bitmap search tolerance must be between 0 and 1.").ThrowAsJavaScriptException();
		return env.Null();
	}

	MMPointArrayRef matches = findAllBitmapInBitmap(needle, haystack, tolerance);
	Napi::Array result = Napi::Array::New(env, matches->count);

	for (size_t index = 0; index < matches->count; ++index)
	{
		const MMPoint point = MMPointArrayGetItem(matches, index);
		result.Set(index,
		          BuildSearchMatchObject(env, MakeSearchMatchResult(true, true, 1.0, point.x, point.y, needle->width, needle->height, 1.0)));
	}

	destroyMMPointArray(matches);
	destroyMMBitmap(haystack);
	destroyMMBitmap(needle);
	return result;
}

Napi::Value findFuzzyBitmapWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() < 2 || info.Length() > 8)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
		return env.Null();
	}

	MMBitmapRef haystack = BuildMMBitmapFromJsObject(info[0].ToObject());
	MMBitmapRef needle = BuildMMBitmapFromJsObject(info[1].ToObject());
	double threshold = 0.85;
	double tolerance = 0.15;
	const bool allowPartialMatch = info.Length() > 4 ? info[4].As<Napi::Boolean>().Value() : false;
	double minimumOverlapRatio = 0.6;
	size_t sampleStep = 0;
	double sampleStepValue = 0.0;
	double threadCountValue = 1.0;

	if ((info.Length() > 2 && !IsFiniteNumberValue(info[2], &threshold)) ||
	    (info.Length() > 3 && !IsFiniteNumberValue(info[3], &tolerance)) ||
	    (info.Length() > 5 && !IsFiniteNumberValue(info[5], &minimumOverlapRatio)) ||
	    (info.Length() > 6 && !IsFiniteNumberValue(info[6], &sampleStepValue)) ||
	    (info.Length() > 7 && !IsFiniteNumberValue(info[7], &threadCountValue)))
	{
		destroyMMBitmap(haystack);
		destroyMMBitmap(needle);
		Napi::Error::New(env, "Invalid fuzzy bitmap search bounds specified.").ThrowAsJavaScriptException();
		return env.Null();
	}

	if (sampleStepValue < 0.0 || std::floor(sampleStepValue) != sampleStepValue ||
	    threadCountValue < 1.0 || threadCountValue > 64.0 ||
	    std::floor(threadCountValue) != threadCountValue)
	{
		destroyMMBitmap(haystack);
		destroyMMBitmap(needle);
		Napi::Error::New(env, "Invalid fuzzy bitmap search bounds specified.").ThrowAsJavaScriptException();
		return env.Null();
	}

	sampleStep = static_cast<size_t>(sampleStepValue);

	if (threshold < 0.0 || threshold > 1.0 || tolerance < 0.0 || tolerance > 1.0 ||
	    minimumOverlapRatio < 0.0 || minimumOverlapRatio > 1.0)
	{
		destroyMMBitmap(haystack);
		destroyMMBitmap(needle);
		Napi::Error::New(env, "Invalid fuzzy bitmap search bounds specified.").ThrowAsJavaScriptException();
		return env.Null();
	}

	fuzzy_search_metrics_t metrics = {};
	Napi::Object result;
	try
	{
		result = BuildSearchMatchObject(env,
		                               FindBestFuzzyBitmapMatch(
		                                   needle,
		                                   haystack,
		                                   threshold,
		                                   tolerance,
		                                   allowPartialMatch,
		                                   minimumOverlapRatio,
		                                   GetFuzzySampleStep(
		                                       needle->width,
		                                       needle->height,
		                                       sampleStep),
		                                   static_cast<size_t>(threadCountValue),
		                                   &metrics));
		result.Set("metrics", BuildFuzzySearchMetricsObject(env, metrics));
	}
	catch (const std::exception& error)
	{
		destroyMMBitmap(haystack);
		destroyMMBitmap(needle);
		Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
		return env.Null();
	}

	destroyMMBitmap(haystack);
	destroyMMBitmap(needle);
	return result;
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports)
{
	InitializeHotkeyThreading();
	InitNativeHotkeyManager(env, exports);
	BitmapCatalogMatcherBinding::Init(env, exports);

	exports.Set(Napi::String::New(env, "dragMouse"),
				Napi::Function::New(env, dragMouseWrapper));

	exports.Set(Napi::String::New(env, "updateScreenMetrics"),
				Napi::Function::New(env, updateScreenMetricsWrapper));

	exports.Set(Napi::String::New(env, "moveMouse"),
				Napi::Function::New(env, moveMouseWrapper));

	exports.Set(Napi::String::New(env, "moveMouseSmooth"),
				Napi::Function::New(env, moveMouseSmoothWrapper));

	exports.Set(Napi::String::New(env, "getMousePos"),
				Napi::Function::New(env, getMousePosWrapper));

	exports.Set(Napi::String::New(env, "mouseClick"),
				Napi::Function::New(env, mouseClickWrapper));

	exports.Set(Napi::String::New(env, "mouseToggle"),
				Napi::Function::New(env, mouseToggleWrapper));

	exports.Set(Napi::String::New(env, "scrollMouse"),
				Napi::Function::New(env, scrollMouseWrapper));

	exports.Set(Napi::String::New(env, "setMouseDelay"),
				Napi::Function::New(env, setMouseDelayWrapper));

	exports.Set(Napi::String::New(env, "keyTap"),
				Napi::Function::New(env, keyTapWrapper));

	exports.Set(Napi::String::New(env, "keyToggle"),
				Napi::Function::New(env, keyToggleWrapper));

	exports.Set(Napi::String::New(env, "unicodeTap"),
				Napi::Function::New(env, unicodeTapWrapper));

	exports.Set(Napi::String::New(env, "typeString"),
				Napi::Function::New(env, typeStringWrapper));

	exports.Set(Napi::String::New(env, "typeStringDelayed"),
				Napi::Function::New(env, typeStringDelayedWrapper));

	exports.Set(Napi::String::New(env, "setKeyboardDelay"),
				Napi::Function::New(env, setKeyboardDelayWrapper));

	exports.Set(Napi::String::New(env, "getPixelColor"),
				Napi::Function::New(env, getPixelColorWrapper));

	exports.Set(Napi::String::New(env, "getScreenSize"),
				Napi::Function::New(env, getScreenSizeWrapper));

	exports.Set(Napi::String::New(env, "getDesktopState"),
				Napi::Function::New(env, getDesktopStateWrapper));

	exports.Set(Napi::String::New(env, "focusWindow"),
				Napi::Function::New(env, focusWindowWrapper));

	exports.Set(Napi::String::New(env, "getClipboardText"),
				Napi::Function::New(env, getClipboardTextWrapper));

	exports.Set(Napi::String::New(env, "clearClipboardText"),
				Napi::Function::New(env, clearClipboardTextWrapper));

	exports.Set(Napi::String::New(env, "captureScreen"),
				Napi::Function::New(env, captureScreenWrapper));

	exports.Set(Napi::String::New(env, "loadBitmapFromFile"),
				Napi::Function::New(env, loadBitmapFromFileWrapper));

	exports.Set(Napi::String::New(env, "findBitmap"),
				Napi::Function::New(env, findBitmapWrapper));

	exports.Set(Napi::String::New(env, "findAllBitmaps"),
				Napi::Function::New(env, findAllBitmapsWrapper));

	exports.Set(Napi::String::New(env, "findFuzzyBitmap"),
				Napi::Function::New(env, findFuzzyBitmapWrapper));

	exports.Set(Napi::String::New(env, "getColor"),
				Napi::Function::New(env, getColorWrapper));

	exports.Set(Napi::String::New(env, "getXDisplayName"),
				Napi::Function::New(env, getXDisplayNameWrapper));

	exports.Set(Napi::String::New(env, "setXDisplayName"),
				Napi::Function::New(env, setXDisplayNameWrapper));

	return exports;
}

NODE_API_MODULE(robotjs, InitAll)
