/**
 * @file storage.js
 * @description localStorage-based storage module for search history and bookmarks
 *
 * Provides StorageUtils global object with CRUD operations for history and bookmarks.
 * Data is persisted in localStorage and shared across all pages.
 *
 * @author ZedeX
 * @version 1.0.0
 * @date 2026-06-09
 * @license Apache-2.0
 */

var StorageUtils = (function() {
    var HISTORY_KEY = 'shlib_search_history';
    var BOOKMARKS_KEY = 'shlib_bookmarks';
    var MAX_HISTORY = 100;
    var _idCounter = 0;

    function _uniqueId() {
        return Date.now() * 1000 + (++_idCounter);
    }

    function _read(key) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function _write(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            // storage full - remove oldest entries
            if (key === HISTORY_KEY && data.length > 10) {
                data = data.slice(0, 10);
                try { localStorage.setItem(key, JSON.stringify(data)); } catch (e2) {}
            }
        }
    }

    function addHistory(keyword, searchType, resultCount) {
        if (!keyword || !keyword.trim()) return;
        keyword = keyword.trim();
        searchType = searchType || 'AllFields';
        resultCount = resultCount || 0;

        var history = _read(HISTORY_KEY);

        // dedup by keyword+type: remove existing entry with same keyword and type
        var dedupKey = keyword + '::' + searchType;
        history = history.filter(function(item) {
            return (item.keyword + '::' + item.search_type) !== dedupKey;
        });

        var entry = {
            id: _uniqueId(),
            keyword: keyword,
            search_type: searchType,
            result_count: resultCount,
            created_at: new Date().toISOString()
        };

        history.unshift(entry);

        // cap at MAX_HISTORY
        if (history.length > MAX_HISTORY) {
            history = history.slice(0, MAX_HISTORY);
        }

        _write(HISTORY_KEY, history);
        return entry;
    }

    function getHistory() {
        return _read(HISTORY_KEY);
    }

    function deleteHistory(id) {
        var history = _read(HISTORY_KEY);
        history = history.filter(function(item) { return item.id !== id; });
        _write(HISTORY_KEY, history);
    }

    function clearHistory() {
        _write(HISTORY_KEY, []);
    }

    function addBookmark(recordId, title, author, coverUrl) {
        if (!recordId) return null;
        var bookmarks = _read(BOOKMARKS_KEY);

        // dedup by recordId
        var existing = bookmarks.filter(function(item) { return item.record_id === recordId; });
        if (existing.length > 0) return existing[0];

        var entry = {
            id: _uniqueId(),
            record_id: recordId,
            title: title || '',
            author: author || '',
            cover_url: coverUrl || '',
            created_at: new Date().toISOString()
        };

        bookmarks.unshift(entry);
        _write(BOOKMARKS_KEY, bookmarks);
        return entry;
    }

    function getBookmarks() {
        return _read(BOOKMARKS_KEY);
    }

    function deleteBookmark(id) {
        var bookmarks = _read(BOOKMARKS_KEY);
        bookmarks = bookmarks.filter(function(item) { return item.id !== id; });
        _write(BOOKMARKS_KEY, bookmarks);
    }

    function isBookmarked(recordId) {
        var bookmarks = _read(BOOKMARKS_KEY);
        return bookmarks.some(function(item) { return item.record_id === recordId; });
    }

    function toggleBookmark(recordId, title, author, coverUrl) {
        if (isBookmarked(recordId)) {
            // remove
            var bookmarks = _read(BOOKMARKS_KEY);
            var target = bookmarks.filter(function(item) { return item.record_id === recordId; });
            if (target.length > 0) {
                deleteBookmark(target[0].id);
            }
            return false;
        } else {
            addBookmark(recordId, title, author, coverUrl);
            return true;
        }
    }

    function getBookmarkByRecordId(recordId) {
        var bookmarks = _read(BOOKMARKS_KEY);
        var found = bookmarks.filter(function(item) { return item.record_id === recordId; });
        return found.length > 0 ? found[0] : null;
    }

    return {
        addHistory: addHistory,
        getHistory: getHistory,
        deleteHistory: deleteHistory,
        clearHistory: clearHistory,
        addBookmark: addBookmark,
        getBookmarks: getBookmarks,
        deleteBookmark: deleteBookmark,
        isBookmarked: isBookmarked,
        toggleBookmark: toggleBookmark,
        getBookmarkByRecordId: getBookmarkByRecordId
    };
})();
