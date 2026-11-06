#pragma once
#ifndef NATIVE_THREAD_BUDGET_H
#define NATIVE_THREAD_BUDGET_H

#include <cstddef>

class NativeThreadReservation
{
public:
	explicit NativeThreadReservation(size_t requested_thread_count);
	~NativeThreadReservation();

	NativeThreadReservation(const NativeThreadReservation&) = delete;
	NativeThreadReservation& operator=(const NativeThreadReservation&) = delete;

	size_t ThreadCount() const;
	size_t Capacity() const;
	double WaitMilliseconds() const;

private:
	size_t threadCount_;
	size_t capacity_;
	double waitMilliseconds_;
};

#endif /* NATIVE_THREAD_BUDGET_H */
