#include "bitmap_find.h"
#include <assert.h>

#define MAX_EXACT_SEARCH_ANCHORS 8
#define EXACT_SEARCH_CANDIDATE_ANCHORS 17

typedef struct exact_search_anchor_t {
	MMPoint point;
	MMRGBHex color;
	size_t color_count;
	size_t order;
} exact_search_anchor_t;

typedef struct exact_search_plan_t {
	exact_search_anchor_t anchors[MAX_EXACT_SEARCH_ANCHORS];
	size_t anchor_count;
} exact_search_plan_t;

static int PointsEqual(MMPoint first, MMPoint second)
{
	return first.x == second.x && first.y == second.y;
}

static size_t CountColorOccurrences(MMBitmapRef bitmap, MMRGBHex color)
{
	size_t count = 0;
	MMPoint point;

	for (point.y = 0; point.y < bitmap->height; ++point.y) {
		for (point.x = 0; point.x < bitmap->width; ++point.x) {
			if (MMRGBHexAtPoint(bitmap, point.x, point.y) == color) {
				++count;
			}
		}
	}

	return count;
}

static void SortAnchors(exact_search_anchor_t *anchors, size_t anchor_count)
{
	size_t left;

	for (left = 0; left < anchor_count; ++left) {
		size_t best_index = left;
		size_t right;

		for (right = left + 1; right < anchor_count; ++right) {
			if (anchors[right].color_count < anchors[best_index].color_count ||
			    (anchors[right].color_count == anchors[best_index].color_count &&
			     anchors[right].order < anchors[best_index].order)) {
				best_index = right;
			}
		}

		if (best_index != left) {
			exact_search_anchor_t swap = anchors[left];
			anchors[left] = anchors[best_index];
			anchors[best_index] = swap;
		}
	}
}

static void AddSearchAnchorCandidate(exact_search_anchor_t *candidates,
                                     size_t *candidate_count,
                                     MMBitmapRef needle,
                                     size_t x,
                                     size_t y,
                                     size_t order)
{
	size_t index;
	const MMPoint point = MMPointMake(x, y);

	for (index = 0; index < *candidate_count; ++index) {
		if (PointsEqual(candidates[index].point, point)) {
			return;
		}
	}

	candidates[*candidate_count].point = point;
	candidates[*candidate_count].color = MMRGBHexAtPoint(needle, x, y);
	candidates[*candidate_count].color_count =
		CountColorOccurrences(needle, candidates[*candidate_count].color);
	candidates[*candidate_count].order = order;
	++(*candidate_count);
}

static void initExactSearchPlan(exact_search_plan_t *plan, MMBitmapRef needle)
{
	exact_search_anchor_t candidates[EXACT_SEARCH_CANDIDATE_ANCHORS];
	size_t candidate_count = 0;
	const size_t width = needle->width;
	const size_t height = needle->height;
	const size_t last_x = width - 1;
	const size_t last_y = height - 1;
	const size_t mid_x = last_x / 2;
	const size_t mid_y = last_y / 2;
	const size_t quarter_x = last_x / 4;
	const size_t quarter_y = last_y / 4;
	const size_t three_quarter_x = (last_x * 3) / 4;
	const size_t three_quarter_y = (last_y * 3) / 4;

	assert(plan != NULL);
	assert(needle != NULL);
	assert(width > 0 && height > 0);

	AddSearchAnchorCandidate(candidates, &candidate_count, needle, mid_x, mid_y, 0);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, last_x, last_y, 1);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, 0, 0, 2);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, last_x, 0, 3);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, 0, last_y, 4);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, mid_x, 0, 5);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, 0, mid_y, 6);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, last_x, mid_y, 7);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, mid_x, last_y, 8);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, quarter_x, quarter_y, 9);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, three_quarter_x, quarter_y, 10);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, quarter_x, three_quarter_y, 11);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, three_quarter_x, three_quarter_y, 12);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, mid_x, quarter_y, 13);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, quarter_x, mid_y, 14);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, three_quarter_x, mid_y, 15);
	AddSearchAnchorCandidate(candidates, &candidate_count, needle, mid_x, three_quarter_y, 16);

	SortAnchors(candidates, candidate_count);

	plan->anchor_count = candidate_count < MAX_EXACT_SEARCH_ANCHORS
		? candidate_count
		: MAX_EXACT_SEARCH_ANCHORS;

	for (size_t index = 0; index < plan->anchor_count; ++index) {
		plan->anchors[index] = candidates[index];
	}
}

static int AnchorsMatchAtOffset(MMBitmapRef needle,
                                MMBitmapRef haystack,
                                MMPoint offset,
                                float tolerance,
                                const exact_search_plan_t *plan)
{
	size_t index;

	assert(needle != NULL);
	assert(haystack != NULL);
	assert(plan != NULL);

	for (index = 0; index < plan->anchor_count; ++index) {
		const exact_search_anchor_t *anchor = &plan->anchors[index];
		const MMRGBHex haystack_color = MMRGBHexAtPoint(haystack,
		                                               offset.x + anchor->point.x,
		                                               offset.y + anchor->point.y);

		if (!MMRGBHexSimilarToColor(anchor->color, haystack_color, tolerance)) {
			return 0;
		}
	}

	return 1;
}

static int needleAtOffset(MMBitmapRef needle, MMBitmapRef haystack,
                          MMPoint offset, float tolerance);

static int findBitmapInRectAt(MMBitmapRef needle,
                              MMBitmapRef haystack,
                              MMPoint *point,
                              MMRect rect,
                              float tolerance,
                              MMPoint startPoint,
                              const exact_search_plan_t *plan)
{
	const size_t scan_height = rect.size.height - needle->height;
	const size_t scan_width = rect.size.width - needle->width;
	MMPoint point_offset = startPoint;

	if (needle->height > haystack->height || needle->width > haystack->width ||
	    !MMBitmapRectInBounds(haystack, rect)) {
		return -1;
	}

	assert(point != NULL);
	assert(needle != NULL);
	assert(needle->height > 0 && needle->width > 0);
	assert(haystack != NULL);
	assert(haystack->height > 0 && haystack->width > 0);
	assert(plan != NULL);

	while (point_offset.y <= scan_height) {
		while (point_offset.x <= scan_width) {
			if (AnchorsMatchAtOffset(needle, haystack, point_offset, tolerance, plan) &&
			    needleAtOffset(needle, haystack, point_offset, tolerance)) {
				*point = point_offset;
				return 0;
			}

			++point_offset.x;
		}

		point_offset.x = rect.origin.x;
		++point_offset.y;
	}

	return -1;
}

int findBitmapInRect(MMBitmapRef needle,
		             MMBitmapRef haystack,
                     MMPoint *point,
                     MMRect rect,
                     float tolerance)
{
	exact_search_plan_t plan;

	initExactSearchPlan(&plan, needle);
	return findBitmapInRectAt(needle, haystack, point, rect, tolerance, MMPointZero, &plan);
}

MMPointArrayRef findAllBitmapInRect(MMBitmapRef needle, MMBitmapRef haystack,
                                    MMRect rect, float tolerance)
{
	MMPointArrayRef point_array = createMMPointArray(0);
	MMPoint point = MMPointZero;
	exact_search_plan_t plan;

	initExactSearchPlan(&plan, needle);

	while (findBitmapInRectAt(needle, haystack, &point, rect,
	                          tolerance, point, &plan) == 0) {
		const size_t scan_width = (haystack->width - needle->width) + 1;
		MMPointArrayAppendPoint(point_array, point);
		ITER_NEXT_POINT(point, scan_width, 0);
	}

	return point_array;
}

size_t countOfBitmapInRect(MMBitmapRef needle, MMBitmapRef haystack,
                           MMRect rect, float tolerance)
{
	size_t count = 0;
	MMPoint point = MMPointZero;
	exact_search_plan_t plan;

	initExactSearchPlan(&plan, needle);

	while (findBitmapInRectAt(needle, haystack, &point, rect,
	                          tolerance, point, &plan) == 0) {
		const size_t scan_width = (haystack->width - needle->width) + 1;
		++count;
		ITER_NEXT_POINT(point, scan_width, 0);
	}

	return count;
}

static int needleAtOffset(MMBitmapRef needle, MMBitmapRef haystack,
                          MMPoint offset, float tolerance)
{
	const MMPoint last_point = MMPointMake(needle->width - 1, needle->height - 1);
	MMPoint scan;

	for (scan.y = last_point.y; ; --scan.y) {
		for (scan.x = last_point.x; ; --scan.x) {
			MMRGBHex needle_color = MMRGBHexAtPoint(needle, scan.x, scan.y);
			MMRGBHex haystack_color = MMRGBHexAtPoint(haystack,
			                                          offset.x + scan.x,
			                                          offset.y + scan.y);
			if (!MMRGBHexSimilarToColor(needle_color, haystack_color, tolerance)) {
				return 0;
			}
			if (scan.x == 0) {
				break;
			}
		}
		if (scan.y == 0) {
			break;
		}
	}

	return 1;
}
