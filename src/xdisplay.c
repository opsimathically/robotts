#include "xdisplay.h"
#include <X11/Xatom.h>
#include <stdio.h> /* For fputs() */
#include <stdlib.h> /* For atexit() */
#include <string.h> /* For strdup() */
#include <unistd.h> /* For usleep() */

static Display *mainDisplay = NULL;
static int registered = 0;
static char *displayName = ":0.0";
static int hasDisplayNameChanged = 0;
static Window clipboardWindow = 0;

static char *DuplicateString(const char *value)
{
	size_t length = value != NULL ? strlen(value) : 0;
	char *copy = (char *)malloc(length + 1);

	if (copy == NULL)
	{
		return NULL;
	}

	if (length > 0)
	{
		memcpy(copy, value, length);
	}

	copy[length] = '\0';
	return copy;
}

static void SetErrorMessage(char **error_message, const char *message)
{
	if (error_message == NULL)
	{
		return;
	}

	*error_message = DuplicateString(message);
}

static Window XGetClipboardWindow(Display *display)
{
	if (display == NULL)
	{
		return None;
	}

	if (clipboardWindow == 0)
	{
		clipboardWindow = XCreateSimpleWindow(display,
		                                     DefaultRootWindow(display),
		                                     0,
		                                     0,
		                                     1,
		                                     1,
		                                     0,
		                                     BlackPixel(display, DefaultScreen(display)),
		                                     BlackPixel(display, DefaultScreen(display)));
	}

	return clipboardWindow;
}

static bool ReadSelectionText(Display *display,
	                          Window window,
	                          Atom selection,
	                          Atom target,
	                          Atom property,
	                          char **text_out,
	                          char **error_message)
{
	XEvent event;
	int attempt;

	if (display == NULL || window == None || selection == None || target == None || property == None || text_out == NULL)
	{
		SetErrorMessage(error_message, "Clipboard read request was invalid.");
		return false;
	}

	XDeleteProperty(display, window, property);
	XConvertSelection(display, selection, target, property, window, CurrentTime);
	XFlush(display);

	for (attempt = 0; attempt < 100; ++attempt)
	{
		while (XPending(display) > 0)
		{
			XNextEvent(display, &event);
			if (event.type == SelectionNotify &&
			    event.xselection.requestor == window &&
			    event.xselection.selection == selection)
			{
				Atom actualType = None;
				int actualFormat = 0;
				unsigned long itemCount = 0;
				unsigned long bytesAfter = 0;
				unsigned char *propertyValue = NULL;

				if (event.xselection.property == None)
				{
					return false;
				}

				if (XGetWindowProperty(display,
				                       window,
				                       property,
				                       0,
				                       (~0L),
				                       False,
				                       AnyPropertyType,
				                       &actualType,
				                       &actualFormat,
				                       &itemCount,
				                       &bytesAfter,
				                       &propertyValue) != Success)
				{
					SetErrorMessage(error_message, "Could not read clipboard property data.");
					return false;
				}

				if (propertyValue == NULL)
				{
					*text_out = DuplicateString("");
					return *text_out != NULL;
				}

				if (actualFormat != 8)
				{
					XFree(propertyValue);
					SetErrorMessage(error_message, "Clipboard content was not text.");
					return false;
				}

				*text_out = (char *)malloc(itemCount + 1);
				if (*text_out == NULL)
				{
					XFree(propertyValue);
					SetErrorMessage(error_message, "Could not allocate clipboard buffer.");
					return false;
				}

				if (itemCount > 0)
				{
					memcpy(*text_out, propertyValue, itemCount);
				}

				(*text_out)[itemCount] = '\0';
				XFree(propertyValue);
				return true;
			}
		}

		usleep(10000);
	}

	SetErrorMessage(error_message, "Timed out waiting for clipboard selection data.");
	return false;
}

Display *XGetMainDisplay(void)
{
	/* Close the display if displayName has changed */
	if (hasDisplayNameChanged) {
		XCloseMainDisplay();
		hasDisplayNameChanged = 0;
	}

	if (mainDisplay == NULL) {
		/* First try the user set displayName */
		mainDisplay = XOpenDisplay(displayName);

		/* Then try using environment variable DISPLAY */
		if (mainDisplay == NULL) {
			mainDisplay = XOpenDisplay(NULL);
		}

		if (mainDisplay == NULL) {
			fputs("Could not open main display\n", stderr);
		} else if (!registered) {
			atexit(&XCloseMainDisplay);
			registered = 1;
		}
	}

	return mainDisplay;
}

void XCloseMainDisplay(void)
{
	if (mainDisplay != NULL && clipboardWindow != 0) {
		XDestroyWindow(mainDisplay, clipboardWindow);
		clipboardWindow = 0;
	}

	if (mainDisplay != NULL) {
		XCloseDisplay(mainDisplay);
		mainDisplay = NULL;
	}
}

char *getXDisplay(void)
{
	return displayName;
}

void setXDisplay(const char *name)
{
	displayName = strdup(name);
	hasDisplayNameChanged = 1;
}

bool XGetClipboardText(char **text_out, char **error_message)
{
	Display *display = XGetMainDisplay();
	Window window;
	Window selectionOwner;
	Atom clipboard;
	Atom textAtom;
	Atom compoundText;
	Atom utf8String;
	Atom property;

	if (text_out == NULL)
	{
		SetErrorMessage(error_message, "Clipboard output buffer was not provided.");
		return false;
	}

	*text_out = NULL;

	if (display == NULL)
	{
		SetErrorMessage(error_message, "Could not open X11 display for clipboard read.");
		return false;
	}

	window = XGetClipboardWindow(display);
	if (window == None)
	{
		SetErrorMessage(error_message, "Could not create X11 clipboard window.");
		return false;
	}

	clipboard = XInternAtom(display, "CLIPBOARD", False);
	property = XInternAtom(display, "ROBOTTS_CLIPBOARD", False);
	utf8String = XInternAtom(display, "UTF8_STRING", False);
	textAtom = XInternAtom(display, "TEXT", False);
	compoundText = XInternAtom(display, "COMPOUND_TEXT", False);
	selectionOwner = XGetSelectionOwner(display, clipboard);

	if (selectionOwner == None)
	{
		*text_out = DuplicateString("");
		return *text_out != NULL;
	}

	if (selectionOwner == window)
	{
		*text_out = DuplicateString("");
		return *text_out != NULL;
	}

	if (ReadSelectionText(display, window, clipboard, utf8String, property, text_out, error_message))
	{
		return true;
	}

	if (ReadSelectionText(display, window, clipboard, XA_STRING, property, text_out, error_message))
	{
		return true;
	}

	if (ReadSelectionText(display, window, clipboard, textAtom, property, text_out, error_message))
	{
		return true;
	}

	if (ReadSelectionText(display, window, clipboard, compoundText, property, text_out, error_message))
	{
		return true;
	}

	return false;
}

bool XClearClipboardText(char **error_message)
{
	Display *display = XGetMainDisplay();
	Window window;
	Atom clipboard;

	if (display == NULL)
	{
		SetErrorMessage(error_message, "Could not open X11 display for clipboard clear.");
		return false;
	}

	window = XGetClipboardWindow(display);
	if (window == None)
	{
		SetErrorMessage(error_message, "Could not create X11 clipboard window.");
		return false;
	}

	clipboard = XInternAtom(display, "CLIPBOARD", False);
	XSetSelectionOwner(display, clipboard, window, CurrentTime);
	XSetSelectionOwner(display, XA_PRIMARY, window, CurrentTime);
	XFlush(display);

	if (XGetSelectionOwner(display, clipboard) != window)
	{
		SetErrorMessage(error_message, "Could not become the clipboard selection owner.");
		return false;
	}

	return true;
}
