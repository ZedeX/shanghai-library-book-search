/**
 * @file search.js
 * @description 搜索结果页面脚本 - 处理图书搜索和结果展示
 * 
 * 本文件负责搜索结果页面的所有交互逻辑，包括搜索、分页、馆藏状态加载等。
 * 
 * 【项目地位】
 * - 作为搜索结果页面的核心脚本，是用户查找图书的主要入口
 * - 与 search.html 配合使用
 * 
 * 【主要功能】
 * 1. 搜索执行：调用 API 获取搜索结果
 * 2. 结果渲染：将搜索结果渲染为图书卡片
 * 3. 分页导航：处理分页逻辑和 UI
 * 4. 馆藏预览：异步加载每本书的馆藏状态
 * 5. 图书馆筛选：按图书馆过滤搜索结果
 * 
 * 【依赖关系】
 * - 依赖 library-utils.js 提供的工具函数
 * - 依赖后端 API /api/search 和 /api/holdings
 * 
 * @author ZedeX
 * @version 1.0.0
 * @date 2026-04-18
 * @license Apache-2.0
 */

/**
 * URL 查询参数对象
 * @constant {URLSearchParams}
 */
const urlParams = new URLSearchParams(window.location.search);

/**
 * 搜索关键词
 * @constant {string}
 */
const query = urlParams.get('lookfor') || '';

/**
 * 搜索类型
 * @constant {string}
 */
const searchType = urlParams.get('type') || 'AllFields';

/**
 * 当前页码
 * @constant {number}
 */
const page = parseInt(urlParams.get('page') || '1', 10);

/**
 * 上海图书馆基础 URL
 * @constant {string}
 */
const BASE_URL = 'https://vufind.library.sh.cn';

/**
 * 当前筛选条件
 * @type {Object}
 */
let currentFilters = {
    library: '',
    format: '',
    year: '',
    language: '',
    clc: '',
    loanType: ''
};

let preferredLibrary = '';

var sidebarOpen = false;
var sidebarTab = 'history';

function init() {
    preferredLibrary = LibraryUtils.getPreferredLibrary();
    document.getElementById('search-input').value = query;
    document.getElementById('search-type').value = searchType;
    initLibraryFilter();
    loadResults();

    document.querySelector('input[name="lookfor"]').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') submitSearch();
    });
}

function initLibraryFilter() {
    const libraryFilter = document.getElementById('library-filter');
    const libraryLabel = document.getElementById('library-filter-label');
    if (preferredLibrary) {
        libraryFilter.value = preferredLibrary;
        currentFilters.library = preferredLibrary;
        libraryLabel.textContent = '偏好图书馆: ' + preferredLibrary;
    }
}

function applyLibraryFilter() {
    const libraryFilter = document.getElementById('library-filter');
    const libraryLabel = document.getElementById('library-filter-label');
    currentFilters.library = libraryFilter.value;
    if (libraryFilter.value) {
        libraryLabel.textContent = '筛选: ' + libraryFilter.value;
    } else {
        libraryLabel.textContent = preferredLibrary ? '偏好图书馆: ' + preferredLibrary : '图书馆筛选';
    }
    loadResults();
}

function clearLibraryFilter() {
    document.getElementById('library-filter').value = '';
    currentFilters.library = '';
    preferredLibrary = '';
    LibraryUtils.setPreferredLibrary('');
    document.getElementById('library-filter-label').textContent = '图书馆筛选';
    loadResults();
}

function showAllLibraries() {
    document.getElementById('library-filter').value = '';
    currentFilters.library = '';
    document.getElementById('library-filter-label').textContent = '显示全部馆藏';
    loadResults();
}

function submitSearch() {
    const newQuery = document.querySelector('input[name="lookfor"]').value;
    const newType = document.getElementById('search-type').value;
    if (newQuery) {
        window.location.href = '/Search/Results?lookfor=' + encodeURIComponent(newQuery) + '&type=' + newType;
    }
}

function showLoading() {
    document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.remove('active');
}

async function loadResults() {
    const resultsEl = document.getElementById('results');
    const countEl = document.getElementById('results-count');
    const titleEl = document.getElementById('search-title');

    titleEl.textContent = '搜索: ' + query;
    showLoading();

    try {
        let apiUrl = '/api/search?q=' + encodeURIComponent(query) + '&type=' + searchType + '&page=' + page;
        if (currentFilters.library) apiUrl += '&library=' + encodeURIComponent(currentFilters.library);

        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.success) {
            const totalResults = data.statistics.total_results || 0;
            const totalPages = data.statistics.total_pages || 1;
            let displayTotal;
            if (totalResults > 0) {
                displayTotal = totalResults + '+';
            } else if (totalPages > 1) {
                displayTotal = (totalPages * 20) + '+';
            } else {
                displayTotal = data.books.length;
            }
            countEl.textContent = '找到 ' + displayTotal + ' 条结果';
            renderResults(data);
            // Save search history
            StorageUtils.addHistory(query, searchType, parseInt(displayTotal) || data.books.length);
        } else {
            resultsEl.innerHTML = '<div class="error-message">搜索出错: ' + (data.error || '未知错误') + '</div>';
            countEl.textContent = '搜索失败';
        }
    } catch (error) {
        resultsEl.innerHTML = '<div class="error-message">网络错误，请检查连接后重试</div>';
        countEl.textContent = '加载失败';
    } finally {
        hideLoading();
    }
}

function renderResults(data) {
    const container = document.getElementById('results');

    if (!data.books || data.books.length === 0) {
        container.innerHTML = '<div class="no-results"><div class="no-results-icon">📚</div><p>未找到相关图书</p><p style="font-size:14px;margin-top:8px;">试试其他关键词？</p></div>';
        return;
    }

    container.innerHTML = data.books.map(function(book) {
        const coverUrl = book.cover_url ?
            (book.cover_url.startsWith('http') ? book.cover_url : BASE_URL + book.cover_url) :
            BASE_URL + '/Cover/Show?instanceId=' + book.record_id;
        var isBookmarked = StorageUtils.isBookmarked(book.record_id);
        return '<a href="/Record/' + book.record_id + '" class="book-card" id="book-' + book.record_id + '" style="position:relative">' +
            '<button class="bookmark-btn-card' + (isBookmarked ? ' bookmarked' : '') + '" onclick="toggleBookmarkCard(\'' + book.record_id + '\',\'' + escapeAttr(book.title) + '\',\'' + escapeAttr(book.author || '') + '\',\'' + escapeAttr(coverUrl) + '\',event)" title="' + (isBookmarked ? '取消收藏' : '收藏') + '">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (isBookmarked ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
            '</button>' +
            '<div class="book-cover">' +
                '<img src="' + coverUrl + '" alt="封面" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><span class="book-cover-placeholder" style="display:none">无封面</span>' +
            '</div>' +
            '<div class="book-info">' +
                '<span class="book-title">' + escapeHtml(book.title) + '</span>' +
                '<p class="book-meta">' + (book.author ? '著者：' + escapeHtml(book.author) : '著者：未知') + '</p>' +
                '<p class="book-meta">' + (book.publisher ? '出版社：' + escapeHtml(book.publisher) : '') + (book.publish_year ? (book.publisher ? ' | ' : '') + '出版时间：' + book.publish_year : '') + '</p>' +
                (book.call_number ? '<p class="book-meta">索书号：' + escapeHtml(book.call_number) + '</p>' : '') +
                '<span class="book-status status-loading" id="status-' + book.record_id + '">正在加载馆藏...</span>' +
            '</div>' +
        '</a>';
    }).join('');

    renderPagination(data.statistics.page || 1, data.statistics.total_pages || 1);
    loadHoldingsAsync(data.books);
}

async function loadHoldingsAsync(books) {
    for (const book of books) {
        try {
            const holdings = await fetchHoldings(book.record_id);
            updateBookStatus(book.record_id, holdings);
        } catch (e) {
            updateBookStatus(book.record_id, []);
        }
    }
}

function updateBookStatus(recordId, holdings) {
    const statusEl = document.getElementById('status-' + recordId);
    if (!statusEl) return;
    const filterLib = currentFilters.library || preferredLibrary;
    const holdingsInfo = getHoldingsInfo(holdings, filterLib);
    statusEl.className = 'book-status ' + holdingsInfo.statusClass;
    statusEl.textContent = holdingsInfo.statusText;
    if (holdingsInfo.preview) {
        const infoDiv = statusEl.parentElement;
        const existingPreview = infoDiv.querySelector('.holdings-preview');
        if (existingPreview) existingPreview.remove();
        const previewDiv = document.createElement('div');
        previewDiv.className = 'holdings-preview';
        previewDiv.innerHTML = holdingsInfo.preview;
        infoDiv.appendChild(previewDiv);
    }
}

async function fetchHoldings(recordId) {
    try {
        const response = await fetch('/api/holdings/' + recordId);
        const data = await response.json();
        if (data.success && data.holdings) return data.holdings;
    } catch (e) {}
    return [];
}

function getHoldingsInfo(holdings, filterLibrary) {
    if (!holdings || holdings.length === 0) {
        return { statusClass: 'status-unknown', statusText: '查看详情', preview: '' };
    }
    const displayHoldings = filterLibrary ?
        LibraryUtils.filterHoldingsByLibrary(holdings, filterLibrary) : holdings;
    const availableCount = LibraryUtils.calculateAvailableCount(displayHoldings);
    let preview = '';
    if (displayHoldings.length > 0) {
        const libNames = [...new Set(displayHoldings.map(h => h.library))].slice(0, 2);
        preview = libNames.map(name => '<span class="holdings-preview-item">' + name + '</span>').join('');
    }
    let statusClass, statusText;
    if (availableCount > 0) {
        statusClass = 'status-available';
        statusText = '可借 ' + availableCount + ' 本';
    } else if (displayHoldings.length > 0) {
        statusClass = 'status-unavailable';
        statusText = '已借出 (' + displayHoldings.length + '本)';
    } else if (filterLibrary && holdings.length > 0) {
        statusClass = 'status-unknown';
        statusText = holdings.length + '本(其他馆)';
    } else {
        statusClass = 'status-unknown';
        statusText = '查看详情';
    }
    return { statusClass: statusClass, statusText: statusText, preview: preview };
}

function renderPagination(currentPage, totalPages) {
    const pagination = document.getElementById('pagination');
    let html = '';
    if (currentPage > 1) html += '<a href="' + buildPageUrl(currentPage - 1) + '">« 上一页</a>';
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);
    if (startPage > 1) {
        html += '<a href="' + buildPageUrl(1) + '">1</a>';
        if (startPage > 2) html += '<span class="ellipsis">...</span>';
    }
    for (let i = startPage; i <= endPage; i++) {
        if (i === currentPage) {
            html += '<span class="current">' + i + '</span>';
        } else {
            html += '<a href="' + buildPageUrl(i) + '">' + i + '</a>';
        }
    }
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += '<span class="ellipsis">...</span>';
        html += '<a href="' + buildPageUrl(totalPages) + '">' + totalPages + '</a>';
    }
    if (currentPage < totalPages) html += '<a href="' + buildPageUrl(currentPage + 1) + '">下一页 »</a>';
    pagination.innerHTML = html;
}

function buildPageUrl(pageNum) {
    let url = '/Search/Results?lookfor=' + encodeURIComponent(query) + '&type=' + searchType + '&page=' + pageNum;
    if (currentFilters.library) url += '&library=' + encodeURIComponent(currentFilters.library);
    return url;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    if (!text) return '';
    return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatTime(timeStr) {
    if (!timeStr) return '';
    var d = new Date(timeStr);
    if (isNaN(d.getTime())) return timeStr;
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
    return (d.getMonth() + 1) + '/' + d.getDate();
}

// === Bookmark Card Toggle ===
function toggleBookmarkCard(recordId, title, author, coverUrl, event) {
    event.preventDefault();
    event.stopPropagation();
    var added = StorageUtils.toggleBookmark(recordId, title, author, coverUrl);
    updateBookmarkButtons(recordId, added);
    if (sidebarOpen && sidebarTab === 'bookmarks') loadBookmarksList();
}

function updateBookmarkButtons(recordId, isBookmarked) {
    document.querySelectorAll('.bookmark-btn-card').forEach(function(btn) {
        var onclick = btn.getAttribute('onclick');
        if (onclick && onclick.indexOf(recordId) > -1) {
            if (isBookmarked) btn.classList.add('bookmarked');
            else btn.classList.remove('bookmarked');
            btn.querySelector('svg').setAttribute('fill', isBookmarked ? 'currentColor' : 'none');
            btn.title = isBookmarked ? '取消收藏' : '收藏';
        }
    });
}

// === Sidebar ===
function toggleSidebar(tab) {
    if (sidebarOpen && sidebarTab === tab) {
        closeSidebar();
        return;
    }
    sidebarTab = tab;
    sidebarOpen = true;
    document.getElementById('sidebar-overlay').classList.add('active');
    document.getElementById('sidebar-panel').classList.add('open');
    document.getElementById('btn-history').classList.toggle('active', tab === 'history');
    document.getElementById('btn-bookmarks').classList.toggle('active', tab === 'bookmarks');
    switchSidebarTab(tab);
}

function closeSidebar() {
    sidebarOpen = false;
    document.getElementById('sidebar-overlay').classList.remove('active');
    document.getElementById('sidebar-panel').classList.remove('open');
    document.getElementById('btn-history').classList.remove('active');
    document.getElementById('btn-bookmarks').classList.remove('active');
    document.getElementById('sidebar-footer').style.display = 'none';
}

function switchSidebarTab(tab) {
    sidebarTab = tab;
    document.getElementById('sidebar-tab-history').classList.toggle('active', tab === 'history');
    document.getElementById('sidebar-tab-bookmarks').classList.toggle('active', tab === 'bookmarks');
    document.getElementById('sidebar-title').textContent = tab === 'history' ? '搜索历史' : '收藏夹';
    if (tab === 'history') loadHistoryList();
    else loadBookmarksList();
}

function loadHistoryList() {
    var body = document.getElementById('sidebar-body');
    var footer = document.getElementById('sidebar-footer');
    var history = StorageUtils.getHistory();
    if (!history || history.length === 0) {
        body.innerHTML = '<div class="sidebar-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p>暂无搜索历史</p></div>';
        footer.style.display = 'none';
        return;
    }
    footer.style.display = '';
    body.innerHTML = history.map(function(item) {
        var typeMap = {AllFields:'全部',Title:'书名',Author:'作者',Publisher:'出版社',Subject:'主题',CallNumber:'索书号'};
        var typeLabel = typeMap[item.search_type] || item.search_type;
        return '<div class="history-item" onclick="searchFromHistory(\'' + escapeAttr(item.keyword) + '\',\'' + item.search_type + '\')">' +
            '<span class="history-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>' +
            '<div class="history-info">' +
                '<div class="history-keyword">' + escapeHtml(item.keyword) + '</div>' +
                '<div class="history-meta">' + typeLabel + ' · ' + item.result_count + '条结果 · ' + formatTime(item.created_at) + '</div>' +
            '</div>' +
            '<button class="history-delete" onclick="deleteHistory(' + item.id + ',event)" title="删除">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
        '</div>';
    }).join('');
}

function loadBookmarksList() {
    var body = document.getElementById('sidebar-body');
    var footer = document.getElementById('sidebar-footer');
    var bookmarks = StorageUtils.getBookmarks();
    footer.style.display = 'none';
    if (!bookmarks || bookmarks.length === 0) {
        body.innerHTML = '<div class="sidebar-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><p>暂无收藏</p></div>';
        return;
    }
    body.innerHTML = bookmarks.map(function(item) {
        var coverUrl = item.cover_url || '';
        return '<div class="bookmark-item" onclick="window.location.href=\'/Record/' + item.record_id + '\'">' +
            '<div class="bookmark-cover">' + (coverUrl ? '<img src="' + coverUrl + '" onerror="this.style.display=\'none\';this.parentElement.textContent=\'无封面\'">' : '无封面') + '</div>' +
            '<div class="bookmark-info">' +
                '<div class="bookmark-title">' + escapeHtml(item.title) + '</div>' +
                '<div class="bookmark-author">' + escapeHtml(item.author || '') + '</div>' +
            '</div>' +
            '<button class="bookmark-delete" onclick="deleteBookmark(' + item.id + ',event)" title="删除">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
        '</div>';
    }).join('');
}

function searchFromHistory(keyword, type) {
    window.location.href = '/Search/Results?lookfor=' + encodeURIComponent(keyword) + '&type=' + type;
}

function deleteHistory(id, event) {
    event.stopPropagation();
    StorageUtils.deleteHistory(id);
    loadHistoryList();
}

function deleteBookmark(id, event) {
    event.stopPropagation();
    StorageUtils.deleteBookmark(id);
    loadBookmarksList();
}

function clearAllHistory() {
    StorageUtils.clearHistory();
    loadHistoryList();
}

init();
