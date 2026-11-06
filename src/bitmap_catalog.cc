#include "bitmap_catalog.h"
#include "fuzzy_color.h"
#include "native_thread_budget.h"
#include "rgb.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <exception>
#include <limits>
#include <stdexcept>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace
{
struct FingerprintEntry
{
	size_t imageIndex;
	size_t x;
	size_t y;
	MMRGBColor color;
};

struct CandidateOffset
{
	int x;
	int y;
};

struct RankedFingerprint
{
	FingerprintEntry entry;
	size_t neighborhoodFrequency;
	double distanceFromMeanSquared;
};

struct Overlap
{
	size_t needleLeft;
	size_t needleTop;
	size_t needleRight;
	size_t needleBottom;
	size_t visibleX;
	size_t visibleY;
	size_t width;
	size_t height;
	double ratio;
};

MMRGBColor ColorAt(MMBitmapRef bitmap, size_t x, size_t y)
{
	return *reinterpret_cast<MMRGBColor *>(
		bitmap->imageBuffer + (bitmap->bytewidth * y) + (x * bitmap->bytesPerPixel));
}

uint32_t BucketKey(MMRGBColor color, size_t bucket_width)
{
	const uint32_t red = static_cast<uint32_t>(color.red / bucket_width);
	const uint32_t green = static_cast<uint32_t>(color.green / bucket_width);
	const uint32_t blue = static_cast<uint32_t>(color.blue / bucket_width);
	return (red << 16) | (green << 8) | blue;
}

uint64_t OffsetKey(int x, int y)
{
	return (static_cast<uint64_t>(static_cast<uint32_t>(x)) << 32) |
		static_cast<uint32_t>(y);
}

bool RecordCandidateVote(
	uint8_t *vote,
	uint8_t required_votes,
	bool parallel,
	bool *qualified)
{
	*qualified = false;
	if (!parallel)
	{
		if (*vote >= required_votes)
		{
			return false;
		}
		++(*vote);
		*qualified = *vote == required_votes;
		return true;
	}

	uint8_t observed = __atomic_load_n(vote, __ATOMIC_RELAXED);
	while (observed < required_votes)
	{
		const uint8_t desired = static_cast<uint8_t>(observed + 1);
		if (__atomic_compare_exchange_n(
			vote,
			&observed,
			desired,
			true,
			__ATOMIC_RELAXED,
			__ATOMIC_RELAXED))
		{
			*qualified = desired == required_votes;
			return true;
		}
	}
	return false;
}

bool BuildOverlap(MMBitmapRef needle,
	              MMBitmapRef haystack,
	              int offset_x,
	              int offset_y,
	              bool allow_partial,
	              double minimum_overlap_ratio,
	              Overlap *overlap)
{
	if (!allow_partial)
	{
		if (offset_x < 0 || offset_y < 0 ||
			offset_x + static_cast<int>(needle->width) > static_cast<int>(haystack->width) ||
			offset_y + static_cast<int>(needle->height) > static_cast<int>(haystack->height))
		{
			return false;
		}
	}

	const int left = std::max(0, -offset_x);
	const int top = std::max(0, -offset_y);
	const int right = std::min(static_cast<int>(needle->width),
		static_cast<int>(haystack->width) - offset_x);
	const int bottom = std::min(static_cast<int>(needle->height),
		static_cast<int>(haystack->height) - offset_y);

	if (left >= right || top >= bottom)
	{
		return false;
	}

	overlap->needleLeft = static_cast<size_t>(left);
	overlap->needleTop = static_cast<size_t>(top);
	overlap->needleRight = static_cast<size_t>(right);
	overlap->needleBottom = static_cast<size_t>(bottom);
	overlap->visibleX = static_cast<size_t>(std::max(0, offset_x));
	overlap->visibleY = static_cast<size_t>(std::max(0, offset_y));
	overlap->width = static_cast<size_t>(right - left);
	overlap->height = static_cast<size_t>(bottom - top);
	overlap->ratio = static_cast<double>(overlap->width * overlap->height) /
		static_cast<double>(needle->width * needle->height);
	return overlap->ratio >= minimum_overlap_ratio;
}

std::vector<std::pair<size_t, size_t>> ExactAnchorCandidates(MMBitmapRef image)
{
	const size_t last_x = image->width - 1;
	const size_t last_y = image->height - 1;
	std::vector<std::pair<size_t, size_t>> candidates = {
		{ last_x / 2, last_y / 2 }, { last_x, last_y }, { 0, 0 },
		{ last_x, 0 }, { 0, last_y }, { last_x / 2, 0 },
		{ 0, last_y / 2 }, { last_x, last_y / 2 }, { last_x / 2, last_y }
	};
	std::sort(candidates.begin(), candidates.end());
	candidates.erase(std::unique(candidates.begin(), candidates.end()), candidates.end());
	return candidates;
}

std::pair<size_t, size_t> ChooseExactAnchor(MMBitmapRef image)
{
	const std::vector<std::pair<size_t, size_t>> candidates = ExactAnchorCandidates(image);
	size_t best_count = image->width * image->height + 1;
	std::pair<size_t, size_t> best = candidates.front();

	for (const std::pair<size_t, size_t>& candidate : candidates)
	{
		const MMRGBColor candidate_color = ColorAt(image, candidate.first, candidate.second);
		size_t count = 0;
		for (size_t y = 0; y < image->height; ++y)
		{
			for (size_t x = 0; x < image->width; ++x)
			{
				if (FuzzyColorSimilarity(candidate_color, ColorAt(image, x, y)) == 1.0)
				{
					++count;
				}
			}
		}

		if (count < best_count)
		{
			best_count = count;
			best = candidate;
		}
	}

	return best;
}

bool VerifyExact(MMBitmapRef needle,
	             MMBitmapRef haystack,
	             int offset_x,
	             int offset_y,
	             double tolerance,
	             size_t *pixels_compared)
{
	if (offset_x < 0 || offset_y < 0 ||
		offset_x + static_cast<int>(needle->width) > static_cast<int>(haystack->width) ||
		offset_y + static_cast<int>(needle->height) > static_cast<int>(haystack->height))
	{
		return false;
	}

	const double minimum_similarity = 1.0 - tolerance;
	const double maximum_distance = tolerance * 441.67295593;
	const double maximum_distance_squared = maximum_distance * maximum_distance;
	for (size_t y = 0; y < needle->height; ++y)
	{
		for (size_t x = 0; x < needle->width; ++x)
		{
			++(*pixels_compared);
			const MMRGBColor needle_color = ColorAt(needle, x, y);
			const MMRGBColor haystack_color = ColorAt(
				haystack,
				static_cast<size_t>(offset_x) + x,
				static_cast<size_t>(offset_y) + y);
			if (FuzzyColorDistanceSquared(needle_color, haystack_color) >
				maximum_distance_squared ||
				FuzzyColorSimilarity(needle_color, haystack_color) < minimum_similarity)
			{
				return false;
			}
		}
	}
	return true;
}

double ScoreFuzzy(MMBitmapRef needle,
	              MMBitmapRef haystack,
	              int offset_x,
	              int offset_y,
	              const Overlap& overlap,
	              double tolerance,
	              double threshold,
	              size_t *pixels_compared)
{
	const size_t total_pixels = overlap.width * overlap.height;
	const double minimum_similarity = 1.0 - tolerance;
	const double maximum_distance = tolerance * 441.67295593;
	const double maximum_distance_squared = maximum_distance * maximum_distance;
	double score_total = 0.0;
	size_t processed = 0;

	for (size_t y = overlap.needleTop; y < overlap.needleBottom; ++y)
	{
		for (size_t x = overlap.needleLeft; x < overlap.needleRight; ++x)
		{
			const MMRGBColor needle_color = ColorAt(needle, x, y);
			const MMRGBColor haystack_color = ColorAt(
				haystack,
				static_cast<size_t>(offset_x + static_cast<int>(x)),
				static_cast<size_t>(offset_y + static_cast<int>(y)));
			double similarity = 0.0;
			if (FuzzyColorDistanceSquared(needle_color, haystack_color) <=
				maximum_distance_squared)
			{
				similarity = FuzzyColorSimilarity(needle_color, haystack_color);
			}
			if (similarity < minimum_similarity)
			{
				similarity = 0.0;
			}
			score_total += similarity;
			++processed;
			++(*pixels_compared);

			const double maximum_score =
				(score_total + static_cast<double>(total_pixels - processed)) /
				static_cast<double>(total_pixels);
			if (maximum_score < threshold)
			{
				return maximum_score;
			}
		}
	}

	return score_total / static_cast<double>(total_pixels);
}
}

struct BitmapCatalogMatcher::Impl
{
	static constexpr size_t kFuzzyEvidenceTarget = 32;

	std::vector<MMBitmapRef> images;
	BitmapCatalogOptions options;
	size_t bucketWidth;
	double candidateSimilarity;
	size_t bucketCount;
	bool usesDenseIndex;
	std::vector<std::vector<FingerprintEntry>> denseIndex;
	std::unordered_map<uint32_t, std::vector<FingerprintEntry>> sparseIndex;
	std::vector<size_t> requiredCandidateVotes;
	size_t fingerprintEntries;

	Impl(std::vector<MMBitmapRef> input_images, const BitmapCatalogOptions& input_options)
		: images(std::move(input_images)),
		  options(input_options),
		  bucketWidth(1),
		  candidateSimilarity(1.0 - input_options.tolerance),
		  bucketCount(256),
		  usesDenseIndex(false),
		  requiredCandidateVotes(images.size(), 1),
		  fingerprintEntries(0)
	{
		const double candidate_distance = (1.0 - candidateSimilarity) * 441.67295593;
		bucketWidth = std::max<size_t>(1, static_cast<size_t>(std::floor(candidate_distance)) + 1);
		bucketCount = (255 / bucketWidth) + 1;
		const size_t dense_bucket_count = bucketCount * bucketCount * bucketCount;
		usesDenseIndex =
			options.mode == BitmapCatalogMatchMode::Fuzzy &&
			dense_bucket_count <= 262144;
		if (usesDenseIndex)
		{
			denseIndex.resize(dense_bucket_count);
		}
	}

	size_t DenseBucketIndex(MMRGBColor color) const
	{
		const size_t red = color.red / bucketWidth;
		const size_t green = color.green / bucketWidth;
		const size_t blue = color.blue / bucketWidth;
		return ((red * bucketCount) + green) * bucketCount + blue;
	}

	const std::vector<FingerprintEntry> *FindBucket(
		size_t red,
		size_t green,
		size_t blue) const
	{
		if (usesDenseIndex)
		{
			return &denseIndex[((red * bucketCount) + green) * bucketCount + blue];
		}
		const uint32_t key =
			(static_cast<uint32_t>(red) << 16) |
			(static_cast<uint32_t>(green) << 8) |
			static_cast<uint32_t>(blue);
		const auto found = sparseIndex.find(key);
		return found == sparseIndex.end() ? NULL : &found->second;
	}

	void AddIndexEntry(const FingerprintEntry& entry)
	{
		if (usesDenseIndex)
		{
			denseIndex[DenseBucketIndex(entry.color)].push_back(entry);
		}
		else
		{
			sparseIndex[BucketKey(entry.color, bucketWidth)].push_back(entry);
		}
		++fingerprintEntries;
	}

	void BuildIndex()
	{
		for (size_t image_index = 0; image_index < images.size(); ++image_index)
		{
			MMBitmapRef image = images[image_index];
			if (options.mode == BitmapCatalogMatchMode::Exact)
			{
				const std::pair<size_t, size_t> anchor = ChooseExactAnchor(image);
				FingerprintEntry entry = { image_index, anchor.first, anchor.second,
					ColorAt(image, anchor.first, anchor.second) };
				AddIndexEntry(entry);
				continue;
			}
			if (options.threshold == 0.0)
			{
				requiredCandidateVotes[image_index] = 0;
				continue;
			}

			std::vector<FingerprintEntry> entries;
			std::unordered_map<uint32_t, size_t> bucket_frequencies;
			double red_total = 0.0;
			double green_total = 0.0;
			double blue_total = 0.0;
			for (size_t y = 0; y < image->height; y += options.candidateStep)
			{
				for (size_t x = 0; x < image->width; x += options.candidateStep)
				{
					FingerprintEntry entry = { image_index, x, y, ColorAt(image, x, y) };
					entries.push_back(entry);
					++bucket_frequencies[BucketKey(entry.color, bucketWidth)];
					red_total += entry.color.red;
					green_total += entry.color.green;
					blue_total += entry.color.blue;
				}
			}

			if (!options.allowPartialMatch)
			{
				std::unordered_map<uint32_t, size_t> neighborhood_frequencies;
				size_t maximum_neighborhood_frequency = 0;
				for (const auto& bucket_frequency : bucket_frequencies)
				{
					const uint32_t bucket_key = bucket_frequency.first;
					const int base_red = static_cast<int>((bucket_key >> 16) & 0xFF);
					const int base_green = static_cast<int>((bucket_key >> 8) & 0xFF);
					const int base_blue = static_cast<int>(bucket_key & 0xFF);
					size_t neighborhood_frequency = 0;
					for (int red_delta = -1; red_delta <= 1; ++red_delta)
					{
						const int red = base_red + red_delta;
						if (red < 0 || red >= static_cast<int>(bucketCount)) continue;
						for (int green_delta = -1; green_delta <= 1; ++green_delta)
						{
							const int green = base_green + green_delta;
							if (green < 0 || green >= static_cast<int>(bucketCount)) continue;
							for (int blue_delta = -1; blue_delta <= 1; ++blue_delta)
							{
								const int blue = base_blue + blue_delta;
								if (blue < 0 || blue >= static_cast<int>(bucketCount)) continue;
								const uint32_t neighbor_key =
									(static_cast<uint32_t>(red) << 16) |
									(static_cast<uint32_t>(green) << 8) |
									static_cast<uint32_t>(blue);
								const auto neighbor = bucket_frequencies.find(neighbor_key);
								if (neighbor != bucket_frequencies.end())
								{
									neighborhood_frequency += neighbor->second;
								}
							}
						}
					}
					neighborhood_frequencies[bucket_key] = neighborhood_frequency;
					maximum_neighborhood_frequency = std::max(
						maximum_neighborhood_frequency,
						neighborhood_frequency);
				}

				const double entry_count = static_cast<double>(entries.size());
				const double mean_red = red_total / entry_count;
				const double mean_green = green_total / entry_count;
				const double mean_blue = blue_total / entry_count;
				std::vector<RankedFingerprint> ranked_entries;
				ranked_entries.reserve(entries.size());
				for (const FingerprintEntry& entry : entries)
				{
					const double red_distance =
						static_cast<double>(entry.color.red) - mean_red;
					const double green_distance =
						static_cast<double>(entry.color.green) - mean_green;
					const double blue_distance =
						static_cast<double>(entry.color.blue) - mean_blue;
					ranked_entries.push_back({
						entry,
						neighborhood_frequencies[BucketKey(entry.color, bucketWidth)],
						(red_distance * red_distance) +
							(green_distance * green_distance) +
							(blue_distance * blue_distance)
					});
				}

				// Keep enough rare fingerprints that a threshold-passing match must
				// satisfy a bounded number of them before full-image verification.
				// Fuzzy-neighborhood frequency avoids treating many nearly identical
				// antialiasing shades as independent rare colors.
				std::sort(ranked_entries.begin(), ranked_entries.end(),
					[](const RankedFingerprint& first, const RankedFingerprint& second)
					{
						return first.neighborhoodFrequency < second.neighborhoodFrequency ||
							(first.neighborhoodFrequency == second.neighborhoodFrequency &&
								(first.distanceFromMeanSquared > second.distanceFromMeanSquared ||
									(first.distanceFromMeanSquared == second.distanceFromMeanSquared &&
										(first.entry.y < second.entry.y ||
											(first.entry.y == second.entry.y &&
												first.entry.x < second.entry.x)))));
					});
				entries.clear();
				entries.reserve(ranked_entries.size());
				for (const RankedFingerprint& ranked_entry : ranked_entries)
				{
					entries.push_back(ranked_entry.entry);
				}

				if (image->width > std::numeric_limits<size_t>::max() / image->height)
				{
					throw std::runtime_error("Bitmap catalog image dimensions are too large.");
				}
				const size_t image_pixels = image->width * image->height;
				const size_t minimum_nonzero_pixels = static_cast<size_t>(
					std::ceil(options.threshold * static_cast<double>(image_pixels)));
				const size_t allowed_zero_pixels = image_pixels - minimum_nonzero_pixels;
				const double maximum_neighborhood_ratio =
					static_cast<double>(maximum_neighborhood_frequency) /
					static_cast<double>(entries.size());
				size_t evidence_target = kFuzzyEvidenceTarget;
				if (maximum_neighborhood_ratio >= 0.5)
				{
					evidence_target = 128;
				}
				else if (maximum_neighborhood_ratio >= 0.25)
				{
					evidence_target = 64;
				}
				else if (maximum_neighborhood_ratio >= 0.125)
				{
					evidence_target = 48;
				}
				const size_t desired_entries = allowed_zero_pixels >
					std::numeric_limits<size_t>::max() - evidence_target
					? entries.size()
					: allowed_zero_pixels + evidence_target;
				if (entries.size() > desired_entries)
				{
					entries.resize(desired_entries);
				}
				requiredCandidateVotes[image_index] = entries.size() > allowed_zero_pixels
					? entries.size() - allowed_zero_pixels
					: 1;
			}

			for (const FingerprintEntry& entry : entries)
			{
				AddIndexEntry(entry);
			}
		}
	}

	~Impl()
	{
		for (MMBitmapRef image : images)
		{
			destroyMMBitmap(image);
		}
	}
};

BitmapCatalogMatcher::BitmapCatalogMatcher(
	std::vector<MMBitmapRef> images,
	const BitmapCatalogOptions& options)
	: impl_(new Impl(std::move(images), options))
{
	if (impl_->options.candidateStep == 0 || impl_->options.maxResultsPerImage == 0 ||
		impl_->options.maxCandidatesPerImage == 0)
	{
		throw std::invalid_argument("Bitmap catalog limits must be positive.");
	}
	impl_->BuildIndex();
}

BitmapCatalogMatcher::~BitmapCatalogMatcher() = default;

size_t BitmapCatalogMatcher::ImageCount() const
{
	return impl_->images.size();
}

size_t BitmapCatalogMatcher::FingerprintEntryCount() const
{
	return impl_->fingerprintEntries;
}

BitmapCatalogSearchResult BitmapCatalogMatcher::Search(
	MMBitmapRef haystack,
	size_t thread_count) const
{
	struct FuzzyEvidence
	{
		size_t width;
		size_t height;
		size_t requiredVotes;
		std::vector<uint8_t> votes;
	};
	struct ScanOutput
	{
		size_t haystackPixelsScanned = 0;
		size_t indexBucketsVisited = 0;
		size_t fingerprintCollisionsTested = 0;
		size_t candidateVotesRecorded = 0;
		std::vector<std::vector<CandidateOffset>> qualifiedCandidates;
		std::vector<std::unordered_set<uint64_t>> directCandidateKeys;
		std::exception_ptr error;

		explicit ScanOutput(size_t image_count)
			: qualifiedCandidates(image_count),
			  directCandidateKeys(image_count)
		{
		}
	};

	const auto started_at = std::chrono::steady_clock::now();
	BitmapCatalogSearchResult result;
	result.images.resize(impl_->images.size());
	result.metrics = {};
	result.metrics.catalogImages = impl_->images.size();
	result.metrics.fingerprintEntries = impl_->fingerprintEntries;
	result.metrics.effectiveThreadCount = 1;
	std::vector<std::vector<CandidateOffset>> candidates(impl_->images.size());
	std::vector<FuzzyEvidence> fuzzy_evidence(impl_->images.size());
	const int bucket_limit = static_cast<int>(impl_->bucketCount - 1);
	const double indexed_candidate_similarity =
		impl_->options.mode == BitmapCatalogMatchMode::Fuzzy &&
		impl_->options.allowPartialMatch
		? std::max(impl_->options.threshold, impl_->candidateSimilarity)
		: impl_->candidateSimilarity;
	const double indexed_candidate_distance =
		(1.0 - indexed_candidate_similarity) * 441.67295593;
	const double indexed_candidate_distance_squared =
		indexed_candidate_distance * indexed_candidate_distance;
	size_t requested_thread_count = thread_count == 0
		? impl_->options.threadCount
		: thread_count;
	requested_thread_count = std::max<size_t>(1, requested_thread_count);
	size_t proposed_thread_count =
		impl_->options.mode == BitmapCatalogMatchMode::Fuzzy &&
		impl_->options.threshold > 0.0 &&
		haystack->width * haystack->height >= 65536
		? std::min(requested_thread_count, haystack->height)
		: 1;
	NativeThreadReservation thread_reservation(proposed_thread_count);
	const size_t effective_thread_count = thread_reservation.ThreadCount();
	result.metrics.requestedThreadCount = requested_thread_count;
	result.metrics.availableThreadCount = thread_reservation.Capacity();
	result.metrics.effectiveThreadCount = effective_thread_count;
	result.metrics.threadBudgetWaitMilliseconds =
		thread_reservation.WaitMilliseconds();

	for (size_t index = 0; index < result.images.size(); ++index)
	{
		result.images[index].imageIndex = index;
		if (impl_->options.mode == BitmapCatalogMatchMode::Fuzzy &&
			impl_->options.threshold == 0.0)
		{
			MMBitmapRef image = impl_->images[index];
			const int first_x = impl_->options.allowPartialMatch
				? -(static_cast<int>(image->width) - 1)
				: 0;
			const int first_y = impl_->options.allowPartialMatch
				? -(static_cast<int>(image->height) - 1)
				: 0;
			const int last_x = impl_->options.allowPartialMatch
				? static_cast<int>(haystack->width) - 1
				: static_cast<int>(haystack->width) - static_cast<int>(image->width);
			const int last_y = impl_->options.allowPartialMatch
				? static_cast<int>(haystack->height) - 1
				: static_cast<int>(haystack->height) - static_cast<int>(image->height);
			if (last_x >= first_x && last_y >= first_y)
			{
				const size_t width = static_cast<size_t>(last_x - first_x + 1);
				const size_t height = static_cast<size_t>(last_y - first_y + 1);
				if (width > std::numeric_limits<size_t>::max() / height)
				{
					throw std::runtime_error("Bitmap catalog candidate limit exceeded.");
				}
				if (!impl_->options.allowPartialMatch &&
					width * height > impl_->options.maxCandidatesPerImage)
				{
					throw std::runtime_error("Bitmap catalog candidate limit exceeded.");
				}
				candidates[index].reserve(std::min(
					width * height,
					impl_->options.maxCandidatesPerImage));
				for (int y = first_y; y <= last_y; ++y)
				{
					for (int x = first_x; x <= last_x; ++x)
					{
						if (impl_->options.allowPartialMatch)
						{
							Overlap overlap;
							if (!BuildOverlap(
								image,
								haystack,
								x,
								y,
								true,
								impl_->options.minimumOverlapRatio,
								&overlap))
							{
								continue;
							}
						}
						candidates[index].push_back({x, y});
						if (candidates[index].size() >
							impl_->options.maxCandidatesPerImage)
						{
							throw std::runtime_error(
								"Bitmap catalog candidate limit exceeded.");
						}
					}
				}
			}
			continue;
		}
		if (impl_->options.mode != BitmapCatalogMatchMode::Fuzzy ||
			impl_->options.allowPartialMatch)
		{
			continue;
		}

		MMBitmapRef image = impl_->images[index];
		if (image->width > haystack->width || image->height > haystack->height)
		{
			continue;
		}
		FuzzyEvidence& evidence = fuzzy_evidence[index];
		evidence.width = haystack->width - image->width + 1;
		evidence.height = haystack->height - image->height + 1;
		evidence.requiredVotes = impl_->requiredCandidateVotes[index];
		if (evidence.width > std::numeric_limits<size_t>::max() / evidence.height)
		{
			throw std::runtime_error("Bitmap catalog candidate workspace is too large.");
		}
		evidence.votes.resize(evidence.width * evidence.height, 0);
		result.metrics.evidenceCellsInitialized += evidence.votes.size();
		result.metrics.workspaceBytes += evidence.votes.size() * sizeof(uint8_t);
	}

	const auto candidate_scan_started_at = std::chrono::steady_clock::now();
	std::vector<ScanOutput> scan_outputs;
	scan_outputs.reserve(effective_thread_count);
	for (size_t index = 0; index < effective_thread_count; ++index)
	{
		scan_outputs.emplace_back(impl_->images.size());
	}

	auto scan_rows = [&](size_t worker_index, size_t first_y, size_t last_y)
	{
		ScanOutput& output = scan_outputs[worker_index];
		try
		{
			for (size_t y = first_y; y < last_y; ++y)
			{
				for (size_t x = 0; x < haystack->width; ++x)
				{
					++output.haystackPixelsScanned;
					const MMRGBColor haystack_color = ColorAt(haystack, x, y);
					const uint32_t base_key = BucketKey(haystack_color, impl_->bucketWidth);
					const int base_red = static_cast<int>((base_key >> 16) & 0xFF);
					const int base_green = static_cast<int>((base_key >> 8) & 0xFF);
					const int base_blue = static_cast<int>(base_key & 0xFF);

					for (int red_delta = -1; red_delta <= 1; ++red_delta)
					{
						const int red = base_red + red_delta;
						if (red < 0 || red > bucket_limit) continue;
						for (int green_delta = -1; green_delta <= 1; ++green_delta)
						{
							const int green = base_green + green_delta;
							if (green < 0 || green > bucket_limit) continue;
							for (int blue_delta = -1; blue_delta <= 1; ++blue_delta)
							{
								const int blue = base_blue + blue_delta;
								if (blue < 0 || blue > bucket_limit) continue;
								++output.indexBucketsVisited;
								const std::vector<FingerprintEntry> *bucket = impl_->FindBucket(
									static_cast<size_t>(red),
									static_cast<size_t>(green),
									static_cast<size_t>(blue));
								if (bucket == NULL || bucket->empty()) continue;

								for (const FingerprintEntry& entry : *bucket)
								{
									++output.fingerprintCollisionsTested;
									if (FuzzyColorDistanceSquared(entry.color, haystack_color) >
										indexed_candidate_distance_squared)
									{
										continue;
									}

									const int offset_x =
										static_cast<int>(x) - static_cast<int>(entry.x);
									const int offset_y =
										static_cast<int>(y) - static_cast<int>(entry.y);
									if (impl_->options.mode == BitmapCatalogMatchMode::Fuzzy &&
										!impl_->options.allowPartialMatch)
									{
										FuzzyEvidence& evidence = fuzzy_evidence[entry.imageIndex];
										if (offset_x < 0 || offset_y < 0 ||
											static_cast<size_t>(offset_x) >= evidence.width ||
											static_cast<size_t>(offset_y) >= evidence.height)
										{
											continue;
										}
										uint8_t& votes = evidence.votes[
											(static_cast<size_t>(offset_y) * evidence.width) +
											static_cast<size_t>(offset_x)];
										bool qualified = false;
										if (RecordCandidateVote(
											&votes,
											static_cast<uint8_t>(evidence.requiredVotes),
											effective_thread_count > 1,
											&qualified))
										{
											++output.candidateVotesRecorded;
											if (qualified)
											{
												output.qualifiedCandidates[entry.imageIndex].push_back({
													offset_x, offset_y });
											}
										}
										continue;
									}
									output.directCandidateKeys[entry.imageIndex].insert(
										OffsetKey(offset_x, offset_y));
								}
							}
						}
					}
				}
			}
		}
		catch (...)
		{
			output.error = std::current_exception();
		}
	};

	std::vector<std::thread> scan_threads;
	scan_threads.reserve(effective_thread_count > 0 ? effective_thread_count - 1 : 0);
	try
	{
		for (size_t worker_index = 1;
			impl_->fingerprintEntries > 0 && worker_index < effective_thread_count;
			++worker_index)
		{
			const size_t first_y = (haystack->height * worker_index) / effective_thread_count;
			const size_t last_y =
				(haystack->height * (worker_index + 1)) / effective_thread_count;
			scan_threads.emplace_back(scan_rows, worker_index, first_y, last_y);
		}
		if (impl_->fingerprintEntries > 0)
		{
			scan_rows(0, 0, haystack->height / effective_thread_count);
		}
	}
	catch (...)
	{
		for (std::thread& thread : scan_threads)
		{
			if (thread.joinable())
			{
				thread.join();
			}
		}
		throw;
	}
	for (std::thread& thread : scan_threads)
	{
		thread.join();
	}
	const auto candidate_scan_finished_at = std::chrono::steady_clock::now();
	result.metrics.candidateScanMilliseconds =
		std::chrono::duration<double, std::milli>(
			candidate_scan_finished_at - candidate_scan_started_at).count();

	const auto candidate_extraction_started_at = std::chrono::steady_clock::now();
	for (ScanOutput& output : scan_outputs)
	{
		if (output.error)
		{
			std::rethrow_exception(output.error);
		}
		result.metrics.haystackPixelsScanned += output.haystackPixelsScanned;
		result.metrics.indexBucketsVisited += output.indexBucketsVisited;
		result.metrics.fingerprintCollisionsTested += output.fingerprintCollisionsTested;
		result.metrics.candidateVotesRecorded += output.candidateVotesRecorded;
		for (size_t image_index = 0; image_index < impl_->images.size(); ++image_index)
		{
			if (impl_->options.mode == BitmapCatalogMatchMode::Fuzzy &&
				!impl_->options.allowPartialMatch)
			{
				candidates[image_index].insert(
					candidates[image_index].end(),
					output.qualifiedCandidates[image_index].begin(),
					output.qualifiedCandidates[image_index].end());
				continue;
			}
			for (const uint64_t offset_key : output.directCandidateKeys[image_index])
			{
				const int offset_x = static_cast<int32_t>(offset_key >> 32);
				const int offset_y = static_cast<int32_t>(offset_key & 0xFFFFFFFFU);
				candidates[image_index].push_back({offset_x, offset_y});
			}
		}
	}

	for (size_t image_index = 0; image_index < candidates.size(); ++image_index)
	{
		if (impl_->options.mode != BitmapCatalogMatchMode::Fuzzy ||
			impl_->options.allowPartialMatch)
		{
			std::sort(candidates[image_index].begin(), candidates[image_index].end(),
				[](const CandidateOffset& first, const CandidateOffset& second)
				{
					return first.y < second.y ||
						(first.y == second.y && first.x < second.x);
				});
			candidates[image_index].erase(
				std::unique(candidates[image_index].begin(), candidates[image_index].end(),
					[](const CandidateOffset& first, const CandidateOffset& second)
					{
						return first.x == second.x && first.y == second.y;
					}),
				candidates[image_index].end());
		}
		if (candidates[image_index].size() > impl_->options.maxCandidatesPerImage)
		{
			throw std::runtime_error("Bitmap catalog candidate limit exceeded.");
		}
		result.metrics.candidateOffsetsGenerated += candidates[image_index].size();
	}
	for (size_t image_index = 0; image_index < impl_->images.size(); ++image_index)
	{
		std::sort(candidates[image_index].begin(), candidates[image_index].end(),
			[](const CandidateOffset& first, const CandidateOffset& second)
			{
				return first.y < second.y || (first.y == second.y && first.x < second.x);
			});
	}
	const auto candidate_extraction_finished_at = std::chrono::steady_clock::now();
	result.metrics.candidateExtractionMilliseconds =
		std::chrono::duration<double, std::milli>(
			candidate_extraction_finished_at - candidate_extraction_started_at).count();

	const auto verification_started_at = std::chrono::steady_clock::now();
	for (size_t image_index = 0; image_index < impl_->images.size(); ++image_index)
	{
		MMBitmapRef needle = impl_->images[image_index];
		for (const CandidateOffset& candidate : candidates[image_index])
		{
			if (result.images[image_index].occurrences.size() >= impl_->options.maxResultsPerImage)
			{
				break;
			}
			++result.metrics.candidateOffsetsVerified;

			if (impl_->options.mode == BitmapCatalogMatchMode::Exact)
			{
				if (VerifyExact(needle, haystack, candidate.x, candidate.y,
					impl_->options.tolerance, &result.metrics.verificationPixelsCompared))
				{
					result.images[image_index].occurrences.push_back({
						static_cast<size_t>(candidate.x), static_cast<size_t>(candidate.y),
						needle->width, needle->height, 1.0, 1.0 });
				}
				continue;
			}

			Overlap overlap;
			if (!BuildOverlap(needle, haystack, candidate.x, candidate.y,
				impl_->options.allowPartialMatch, impl_->options.minimumOverlapRatio, &overlap))
			{
				continue;
			}
			const double score = ScoreFuzzy(needle, haystack, candidate.x, candidate.y,
				overlap, impl_->options.tolerance, impl_->options.threshold,
				&result.metrics.verificationPixelsCompared);
			if (score >= impl_->options.threshold)
			{
				result.images[image_index].occurrences.push_back({
					overlap.visibleX, overlap.visibleY, overlap.width, overlap.height,
					score, overlap.ratio });
			}
		}

		std::sort(result.images[image_index].occurrences.begin(),
			result.images[image_index].occurrences.end(),
			[](const BitmapCatalogOccurrence& first, const BitmapCatalogOccurrence& second)
			{
				return first.y < second.y || (first.y == second.y && first.x < second.x);
			});
	}
	const auto verification_finished_at = std::chrono::steady_clock::now();
	result.metrics.verificationMilliseconds =
		std::chrono::duration<double, std::milli>(
			verification_finished_at - verification_started_at).count();

	const auto finished_at = std::chrono::steady_clock::now();
	result.metrics.elapsedMilliseconds =
		std::chrono::duration<double, std::milli>(finished_at - started_at).count();
	return result;
}
