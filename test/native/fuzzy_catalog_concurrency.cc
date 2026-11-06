#include "bitmap_catalog.h"
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>

namespace
{
MMBitmapRef CreateBitmap(size_t width, size_t height, size_t seed)
{
	const size_t byte_width = width * 3;
	uint8_t *image = static_cast<uint8_t *>(std::calloc(byte_width * height, 1));
	if (image == NULL) throw std::bad_alloc();
	MMBitmapRef bitmap = createMMBitmap(image, width, height, byte_width, 24, 3);
	if (bitmap == NULL)
	{
		std::free(image);
		throw std::bad_alloc();
	}
	for (size_t y = 0; y < height; ++y)
	{
		for (size_t x = 0; x < width; ++x)
		{
			const size_t offset = (y * byte_width) + (x * 3);
			image[offset] = static_cast<uint8_t>((seed * 47 + x * 29 + y * 11) & 0xFF);
			image[offset + 1] = static_cast<uint8_t>((seed * 83 + x * 17 + y * 31) & 0xFF);
			image[offset + 2] = static_cast<uint8_t>((seed * 19 + x * 43 + y * 23) & 0xFF);
		}
	}
	return bitmap;
}

void EmbedBitmap(MMBitmapRef haystack, MMBitmapRef reference, size_t target_x, size_t target_y)
{
	for (size_t y = 0; y < reference->height; ++y)
	{
		for (size_t x = 0; x < reference->width; ++x)
		{
			for (size_t channel = 0; channel < 3; ++channel)
			{
				haystack->imageBuffer[
					((target_y + y) * haystack->bytewidth) +
					((target_x + x) * haystack->bytesPerPixel) +
					channel] =
					reference->imageBuffer[
						(y * reference->bytewidth) +
						(x * reference->bytesPerPixel) +
						channel];
			}
		}
	}
}

void AssertEquivalent(
	const BitmapCatalogSearchResult& expected,
	const BitmapCatalogSearchResult& actual)
{
	if (actual.images.size() != expected.images.size())
	{
		throw std::runtime_error("Image result count changed.");
	}
	for (size_t image_index = 0; image_index < expected.images.size(); ++image_index)
	{
		const std::vector<BitmapCatalogOccurrence>& expected_occurrences =
			expected.images[image_index].occurrences;
		const std::vector<BitmapCatalogOccurrence>& actual_occurrences =
			actual.images[image_index].occurrences;
		if (actual_occurrences.size() != expected_occurrences.size())
		{
			throw std::runtime_error("Occurrence count changed.");
		}
		for (size_t index = 0; index < expected_occurrences.size(); ++index)
		{
			if (actual_occurrences[index].x != expected_occurrences[index].x ||
				actual_occurrences[index].y != expected_occurrences[index].y ||
				actual_occurrences[index].score != expected_occurrences[index].score)
			{
				throw std::runtime_error("Occurrence content changed.");
			}
		}
	}
}
}

int main()
{
	MMBitmapRef reference = CreateBitmap(8, 8, 7);
	MMBitmapRef haystack = CreateBitmap(260, 260, 100003);
	EmbedBitmap(haystack, reference, 170, 130);

	BitmapCatalogOptions options = {};
	options.mode = BitmapCatalogMatchMode::Fuzzy;
	options.threshold = 0.99;
	options.tolerance = 0.01;
	options.allowPartialMatch = false;
	options.minimumOverlapRatio = 0.6;
	options.candidateStep = 1;
	options.maxResultsPerImage = 10;
	options.maxCandidatesPerImage = 100000;
	options.threadCount = 4;
	std::vector<MMBitmapRef> images = { reference };
	BitmapCatalogMatcher matcher(std::move(images), options);
	const BitmapCatalogSearchResult expected = matcher.Search(haystack, 1);
	std::vector<std::thread> callers;
	std::vector<BitmapCatalogSearchResult> results(3);

	for (size_t index = 0; index < results.size(); ++index)
	{
		callers.emplace_back([&matcher, haystack, &results, index]()
		{
			results[index] = matcher.Search(haystack, 4);
		});
	}
	for (std::thread& caller : callers) caller.join();
	for (const BitmapCatalogSearchResult& result : results)
	{
		AssertEquivalent(expected, result);
	}

	destroyMMBitmap(haystack);
	std::cout << "native fuzzy catalog concurrency verification passed\n";
	return 0;
}
