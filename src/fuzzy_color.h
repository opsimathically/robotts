#pragma once
#ifndef FUZZY_COLOR_H
#define FUZZY_COLOR_H

#include "MMBitmap.h"
#include <algorithm>
#include <cmath>
#include <cstdint>

inline uint32_t FuzzyColorDistanceSquared(MMRGBColor first, MMRGBColor second)
{
	const int red_delta = static_cast<int>(first.red) - static_cast<int>(second.red);
	const int green_delta = static_cast<int>(first.green) - static_cast<int>(second.green);
	const int blue_delta = static_cast<int>(first.blue) - static_cast<int>(second.blue);
	return static_cast<uint32_t>(
		(red_delta * red_delta) +
		(green_delta * green_delta) +
		(blue_delta * blue_delta));
}

inline double FuzzyColorSimilarity(MMRGBColor first, MMRGBColor second)
{
	const double distance = std::sqrt(static_cast<double>(
		FuzzyColorDistanceSquared(first, second)));
	return std::max(
		0.0,
		std::min(1.0, 1.0 - (distance / 441.67295593)));
}

#endif /* FUZZY_COLOR_H */
