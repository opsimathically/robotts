#include "native_thread_budget.h"
#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <sched.h>
#include <thread>

namespace
{
std::mutex budgetMutex;
std::condition_variable budgetCondition;
size_t activeThreadCount = 0;

size_t HardwareThreadCount()
{
	cpu_set_t cpu_set;
	CPU_ZERO(&cpu_set);
	if (sched_getaffinity(0, sizeof(cpu_set), &cpu_set) == 0)
	{
		const int affinity_count = CPU_COUNT(&cpu_set);
		if (affinity_count > 0)
		{
			return static_cast<size_t>(affinity_count);
		}
	}
	const unsigned int hardware_count = std::thread::hardware_concurrency();
	return std::max<size_t>(1, static_cast<size_t>(hardware_count));
}
}

NativeThreadReservation::NativeThreadReservation(size_t requested_thread_count)
	: threadCount_(0),
	  capacity_(HardwareThreadCount()),
	  waitMilliseconds_(0.0)
{
	const auto wait_started_at = std::chrono::steady_clock::now();
	const size_t requested = std::max<size_t>(
		1,
		std::min(requested_thread_count, capacity_));
	std::unique_lock<std::mutex> lock(budgetMutex);
	budgetCondition.wait(lock, [this]()
	{
		return activeThreadCount < capacity_;
	});
	threadCount_ = std::min(requested, capacity_ - activeThreadCount);
	activeThreadCount += threadCount_;
	waitMilliseconds_ = std::chrono::duration<double, std::milli>(
		std::chrono::steady_clock::now() - wait_started_at).count();
}

NativeThreadReservation::~NativeThreadReservation()
{
	{
		std::lock_guard<std::mutex> lock(budgetMutex);
		activeThreadCount -= threadCount_;
	}
	budgetCondition.notify_all();
}

size_t NativeThreadReservation::ThreadCount() const
{
	return threadCount_;
}

size_t NativeThreadReservation::Capacity() const
{
	return capacity_;
}

double NativeThreadReservation::WaitMilliseconds() const
{
	return waitMilliseconds_;
}
