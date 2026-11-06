#pragma once
#ifndef HOTKEY_MANAGER_H
#define HOTKEY_MANAGER_H

#include <napi.h>

bool InitializeHotkeyThreading();
void InitNativeHotkeyManager(Napi::Env env, Napi::Object exports);

#endif
