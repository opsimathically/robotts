#include <napi.h>
#include <cstdlib>
#include <cstring>
#include <sstream>
#include <vector>
#include "mouse.h"
#include "deadbeef_rand.h"
#include "keypress.h"
#include "screen.h"
#include "screengrab.h"
#include "MMBitmap.h"
#include "bitmap_find.h"
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

	const bool hasValue = actualType == XA_WINDOW && actualFormat == 32 && itemCount > 0;
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
			windows.push_back(windowItems[index]);
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

	//If user has provided screen coords, use them!
	if (info.Length() == 4)
	{
		//TODO: Make sure requested coords are within the screen bounds, or we get a seg fault.
		// 		An error message is much nicer!

		x = info[0].As<Napi::Number>().Int32Value();
		y = info[1].As<Napi::Number>().Int32Value();
		w = info[2].As<Napi::Number>().Int32Value();
		h = info[3].As<Napi::Number>().Int32Value();
	}
	else
	{
		//We're getting the full screen.
		x = 0;
		y = 0;

		//Get screen size.
		MMSize displaySize = getMainDisplaySize();
		w = displaySize.width;
		h = displaySize.height;
	}

	MMBitmapRef bitmap = copyMMBitmapFromDisplayInRect(MMRectMake(x, y, w, h));
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

	img.width = obj.Get("width").As<Napi::Number>().Uint32Value();
	img.height = obj.Get("height").As<Napi::Number>().Uint32Value();
	img.byteWidth = obj.Get("byteWidth").As<Napi::Number>().Uint32Value();
	img.bitsPerPixel = obj.Get("bitsPerPixel").As<Napi::Number>().Uint32Value();
	img.bytesPerPixel = obj.Get("bytesPerPixel").As<Napi::Number>().Uint32Value();

	char* buf = obj.Get("image").As<Napi::Buffer<char>>().Data();

	//Convert the buffer to a uint8_t which createMMBitmap requires.
	img.image = (uint8_t *)malloc(img.byteWidth * img.height);
	memcpy(img.image, buf, img.byteWidth * img.height);

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

static Napi::Object BuildSearchMatchObject(Napi::Env env,
	                                      bool found,
	                                      double score,
	                                      size_t x,
	                                      size_t y,
	                                      size_t width,
	                                      size_t height)
{
	Napi::Object result = Napi::Object::New(env);
	result.Set("found", Napi::Boolean::New(env, found));
	if (found)
	{
		Napi::Object location = Napi::Object::New(env);
		Napi::Object size = Napi::Object::New(env);
		location.Set("x", Napi::Number::New(env, x));
		location.Set("y", Napi::Number::New(env, y));
		size.Set("width", Napi::Number::New(env, width));
		size.Set("height", Napi::Number::New(env, height));
		result.Set("score", Napi::Number::New(env, score));
		result.Set("location", location);
		result.Set("size", size);
	}
	else
	{
		result.Set("score", env.Null());
		result.Set("location", env.Null());
		result.Set("size", env.Null());
	}

	return result;
}

static double ColorSimilarity(MMRGBColor first, MMRGBColor second)
{
	const double redDelta = static_cast<double>(first.red) - static_cast<double>(second.red);
	const double greenDelta = static_cast<double>(first.green) - static_cast<double>(second.green);
	const double blueDelta = static_cast<double>(first.blue) - static_cast<double>(second.blue);
	const double distance = sqrt((redDelta * redDelta) + (greenDelta * greenDelta) + (blueDelta * blueDelta));
	const double score = 1.0 - (distance / 441.67295593);

	if (score < 0.0)
	{
		return 0.0;
	}

	if (score > 1.0)
	{
		return 1.0;
	}

	return score;
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

static Napi::Object FindBestFuzzyBitmapMatch(Napi::Env env,
	                                        MMBitmapRef needle,
	                                        MMBitmapRef haystack,
	                                        double threshold,
	                                        double tolerance,
	                                        bool allowPartialMatch,
	                                        double minimumOverlapRatio,
	                                        size_t sampleStep)
{
	if (needle == NULL || haystack == NULL)
	{
		return BuildSearchMatchObject(env, false, 0.0, 0, 0, 0, 0);
	}

	if (needle->width == 0 || needle->height == 0 || haystack->width == 0 || haystack->height == 0)
	{
		return BuildSearchMatchObject(env, false, 0.0, 0, 0, 0, 0);
	}

	const int minX = allowPartialMatch ? -(static_cast<int>(needle->width) - 1) : 0;
	const int minY = allowPartialMatch ? -(static_cast<int>(needle->height) - 1) : 0;
	const int maxX = allowPartialMatch ? static_cast<int>(haystack->width) - 1 : static_cast<int>(haystack->width - needle->width);
	const int maxY = allowPartialMatch ? static_cast<int>(haystack->height) - 1 : static_cast<int>(haystack->height - needle->height);
	double bestScore = -1.0;
	size_t bestX = 0;
	size_t bestY = 0;

	if (!allowPartialMatch && (needle->width > haystack->width || needle->height > haystack->height))
	{
		return BuildSearchMatchObject(env, false, 0.0, 0, 0, 0, 0);
	}

	for (int offsetY = minY; offsetY <= maxY; ++offsetY)
	{
		for (int offsetX = minX; offsetX <= maxX; ++offsetX)
		{
			int overlapLeft = offsetX < 0 ? -offsetX : 0;
			int overlapTop = offsetY < 0 ? -offsetY : 0;
			int overlapRight = static_cast<int>(needle->width);
			int overlapBottom = static_cast<int>(needle->height);
			double scoreTotal = 0.0;
			size_t sampleCount = 0;

			if (offsetX + overlapRight > static_cast<int>(haystack->width))
			{
				overlapRight = static_cast<int>(haystack->width) - offsetX;
			}

			if (offsetY + overlapBottom > static_cast<int>(haystack->height))
			{
				overlapBottom = static_cast<int>(haystack->height) - offsetY;
			}

			if (overlapLeft >= overlapRight || overlapTop >= overlapBottom)
			{
				continue;
			}

			const size_t overlapWidth = static_cast<size_t>(overlapRight - overlapLeft);
			const size_t overlapHeight = static_cast<size_t>(overlapBottom - overlapTop);
			const double overlapRatio = static_cast<double>(overlapWidth * overlapHeight) /
				static_cast<double>(needle->width * needle->height);

			if (overlapRatio < minimumOverlapRatio)
			{
				continue;
			}

			for (int needleY = overlapTop; needleY < overlapBottom; needleY += static_cast<int>(sampleStep))
			{
				for (int needleX = overlapLeft; needleX < overlapRight; needleX += static_cast<int>(sampleStep))
				{
					MMRGBColor needleColor = GetBitmapColorAt(needle, static_cast<size_t>(needleX), static_cast<size_t>(needleY));
					MMRGBColor haystackColor = GetBitmapColorAt(haystack,
					                                          static_cast<size_t>(offsetX + needleX),
					                                          static_cast<size_t>(offsetY + needleY));
					double similarity = ColorSimilarity(needleColor, haystackColor);
					if (similarity < (1.0 - tolerance))
					{
						similarity = 0.0;
					}
					scoreTotal += similarity;
					++sampleCount;
				}
			}

			if (sampleCount == 0)
			{
				continue;
			}

			const double score = scoreTotal / static_cast<double>(sampleCount);
			if (score > bestScore)
			{
				bestScore = score;
				bestX = static_cast<size_t>(offsetX < 0 ? 0 : offsetX);
				bestY = static_cast<size_t>(offsetY < 0 ? 0 : offsetY);
			}
		}
	}

	if (bestScore >= threshold)
	{
		return BuildSearchMatchObject(env, true, bestScore, bestX, bestY, needle->width, needle->height);
	}

	return BuildSearchMatchObject(env, false, bestScore, 0, 0, 0, 0);
}

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
	const MMImageType imageType = extension != NULL ? imageTypeFromExtension(extension) : kInvalidImageType;
	MMIOError errorCode = kMMIOUnsupportedTypeError;
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
	                               searchResult == 0,
	                               searchResult == 0 ? 1.0 : 0.0,
	                               point.x,
	                               point.y,
	                               needle->width,
	                               needle->height);

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
		          BuildSearchMatchObject(env, true, 1.0, point.x, point.y, needle->width, needle->height));
	}

	destroyMMPointArray(matches);
	destroyMMBitmap(haystack);
	destroyMMBitmap(needle);
	return result;
}

Napi::Value findFuzzyBitmapWrapper(const Napi::CallbackInfo& info)
{
	Napi::Env env = info.Env();

	if (info.Length() < 2)
	{
		Napi::Error::New(env, "Invalid number of arguments.").ThrowAsJavaScriptException();
		return env.Null();
	}

	MMBitmapRef haystack = BuildMMBitmapFromJsObject(info[0].ToObject());
	MMBitmapRef needle = BuildMMBitmapFromJsObject(info[1].ToObject());
	const double threshold = info.Length() > 2 ? info[2].As<Napi::Number>().DoubleValue() : 0.85;
	const double tolerance = info.Length() > 3 ? info[3].As<Napi::Number>().DoubleValue() : 0.15;
	const bool allowPartialMatch = info.Length() > 4 ? info[4].As<Napi::Boolean>().Value() : false;
	const double minimumOverlapRatio = info.Length() > 5 ? info[5].As<Napi::Number>().DoubleValue() : 0.6;
	const size_t sampleStep = info.Length() > 6 ? info[6].As<Napi::Number>().Uint32Value() : 0;

	if (threshold < 0.0 || threshold > 1.0 || tolerance < 0.0 || tolerance > 1.0 ||
	    minimumOverlapRatio < 0.0 || minimumOverlapRatio > 1.0)
	{
		destroyMMBitmap(haystack);
		destroyMMBitmap(needle);
		Napi::Error::New(env, "Invalid fuzzy bitmap search bounds specified.").ThrowAsJavaScriptException();
		return env.Null();
	}

	Napi::Object result = FindBestFuzzyBitmapMatch(env,
	                                             needle,
	                                             haystack,
	                                             threshold,
	                                             tolerance,
	                                             allowPartialMatch,
	                                             minimumOverlapRatio,
	                                             GetFuzzySampleStep(needle->width, needle->height, sampleStep));

	destroyMMBitmap(haystack);
	destroyMMBitmap(needle);
	return result;
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports)
{
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
