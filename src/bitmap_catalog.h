#pragma once
#ifndef BITMAP_CATALOG_H
#define BITMAP_CATALOG_H

#include "MMBitmap.h"
#include <cstddef>
#include <memory>
#include <vector>

enum class BitmapCatalogMatchMode
{
	Exact,
	Fuzzy
};

struct BitmapCatalogOptions
{
	BitmapCatalogMatchMode mode;
	double threshold;
	double tolerance;
	bool allowPartialMatch;
	double minimumOverlapRatio;
	size_t candidateStep;
	size_t maxResultsPerImage;
	size_t maxCandidatesPerImage;
	size_t threadCount;
};

struct BitmapCatalogOccurrence
{
	size_t x;
	size_t y;
	size_t width;
	size_t height;
	double score;
	double overlapRatio;
};

struct BitmapCatalogImageResult
{
	size_t imageIndex;
	std::vector<BitmapCatalogOccurrence> occurrences;
};

struct BitmapCatalogMetrics
{
	size_t catalogImages;
	size_t fingerprintEntries;
	size_t haystackPixelsScanned;
	size_t indexBucketsVisited;
	size_t candidateOffsetsGenerated;
	size_t candidateOffsetsVerified;
	size_t verificationPixelsCompared;
	size_t fingerprintCollisionsTested;
	size_t candidateVotesRecorded;
	size_t evidenceCellsInitialized;
	size_t evidenceCellsExamined;
	size_t workspaceBytes;
	size_t requestedThreadCount;
	size_t availableThreadCount;
	size_t effectiveThreadCount;
	double candidateScanMilliseconds;
	double candidateExtractionMilliseconds;
	double verificationMilliseconds;
	double bitmapCopyMilliseconds;
	double queueMilliseconds;
	double threadBudgetWaitMilliseconds;
	double elapsedMilliseconds;
};

struct BitmapCatalogSearchResult
{
	std::vector<BitmapCatalogImageResult> images;
	BitmapCatalogMetrics metrics;
};

class BitmapCatalogMatcher
{
public:
	BitmapCatalogMatcher(std::vector<MMBitmapRef> images, const BitmapCatalogOptions& options);
	~BitmapCatalogMatcher();

	BitmapCatalogMatcher(const BitmapCatalogMatcher&) = delete;
	BitmapCatalogMatcher& operator=(const BitmapCatalogMatcher&) = delete;

	BitmapCatalogSearchResult Search(MMBitmapRef haystack, size_t thread_count = 0) const;
	size_t ImageCount() const;
	size_t FingerprintEntryCount() const;

private:
	struct Impl;
	std::unique_ptr<Impl> impl_;
};

#endif /* BITMAP_CATALOG_H */
