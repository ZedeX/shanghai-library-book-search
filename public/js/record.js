/**
 * @file record.js
 * @description 图书详情页面脚本 - 处理图书详情和馆藏信息展示
 * 
 * 本文件负责图书详情页面的所有交互逻辑，包括详情加载、馆藏筛选等。
 * 
 * 【项目地位】
 * - 作为图书详情页面的核心脚本，是用户查看图书信息的详细视图
 * - 与 record.html 配合使用
 * 
 * 【主要功能】
 * 1. 详情加载：调用 API 获取图书详情和馆藏信息
 * 2. 详情渲染：将图书信息渲染为结构化页面
 * 3. 馆藏表格：展示各分馆的馆藏状态
 * 4. 图书馆筛选：按图书馆过滤馆藏列表
 * 5. 偏好切换：在偏好图书馆和全部馆藏间切换
 * 
 * 【依赖关系】
 * - 依赖 library-utils.js 提供的工具函数
 * - 依赖后端 API /api/record
 * 
 * @author ZedeX
 * @version 1.0.0
 * @date 2026-04-18
 * @license Apache-2.0
 */

/**
 * URL 路径部分数组
 * @constant {string[]}
 */
const pathParts = window.location.pathname.split('/');

/**
 * 图书记录 ID
 * @constant {string}
 */
const recordId = pathParts[pathParts.length - 1] || '';

/**
 * 上海图书馆基础 URL
 * @constant {string}
 */
const BASE_URL = 'https://vufind.library.sh.cn';

/**
 * 所有馆藏数据
 * @type {Array<Object>}
 */
let allHoldings = [];

/**
 * 是否显示全部模式
 * @type {boolean}
 */
let showAllMode = false;

/**
 * 偏好图书馆
 * @type {string}
 */
let preferredLibrary = '';

/**
 * 当前筛选的图书馆
 * @type {string}
 */
let currentFilterLibrary = '';

var recordSidebarOpen = false;
var recordSidebarTab = 'history';

/**
 * 加载图书详情
 * 从 API 获取图书详情和馆藏信息并渲染页面
 * @function loadBookDetail
 * @async
 */
async function loadBookDetail() {
    preferredLibrary = LibraryUtils.getPreferredLibrary();

    try {
        const response = await fetch('/api/record/' + recordId);
        const data = await response.json();

        allHoldings = data.holdings?.holdings || [];

        const libraries = getLibraryOptions();
        if (preferredLibrary && !showAllMode) {
            currentFilterLibrary = LibraryUtils.findMatchingLibrary(preferredLibrary, libraries);
        }

        renderBookDetail(data);
    } catch (error) {
        document.getElementById('book-content').innerHTML = '<p style="text-align:center;color:#c62828;">加载失败，请重试</p>';
    }
}

function toggleLibraryMode() {
    showAllMode = !showAllMode;
    if (showAllMode) {
        currentFilterLibrary = '';
    } else {
        const libraries = getLibraryOptions();
        currentFilterLibrary = LibraryUtils.findMatchingLibrary(preferredLibrary, libraries);
    }
    renderHoldingsTable();
    updateHoldingsHeader();
}

function selectLibrary(libName) {
    if (libName) {
        currentFilterLibrary = libName;
        showAllMode = false;
    } else {
        currentFilterLibrary = '';
        showAllMode = true;
    }
    renderHoldingsTable();
    updateHoldingsHeader();
}

function getDisplayHoldings() {
    if (!currentFilterLibrary) return allHoldings;
    return LibraryUtils.filterHoldingsByLibrary(allHoldings, currentFilterLibrary);
}

function updateHoldingsHeader() {
    const holdings = getDisplayHoldings();
    const availableCount = LibraryUtils.calculateAvailableCount(holdings);
    const headerEl = document.querySelector('.holdings-header h2');
    if (headerEl) {
        headerEl.textContent = '馆藏信息 (' + holdings.length + '本，可借' + availableCount + '本)';
    }
}

function getLibraryOptions() {
    const libraries = [...new Set(allHoldings.map(h => h.library).filter(Boolean))];
    libraries.sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return libraries;
}

function getLibraryAvailableCount(libraryName) {
    const libHoldings = allHoldings.filter(h => h.library === libraryName);
    return LibraryUtils.calculateAvailableCount(libHoldings);
}

function getTotalAvailableCount() {
    return LibraryUtils.calculateAvailableCount(allHoldings);
}

function renderHoldingsTable() {
    const holdings = getDisplayHoldings();
    const container = document.getElementById('holdings-table-container');
    const libraries = getLibraryOptions();
    const totalAvailable = getTotalAvailableCount();

    let filterSection = '<div class="library-filter-row">' +
        '<select class="library-filter-select" onchange="selectLibrary(this.value)">' +
        '<option value=""' + (!currentFilterLibrary ? ' selected' : '') + '>全部图书馆 (可借' + totalAvailable + '本)</option>' +
        libraries.map(lib => {
            const avail = getLibraryAvailableCount(lib);
            return '<option value="' + escapeHtml(lib) + '"' + (currentFilterLibrary === lib ? ' selected' : '') + '>' + escapeHtml(lib) + ' (可借' + avail + '本)</option>';
        }).join('') +
        '</select>' +
        (preferredLibrary ? '<button class="btn-switch" onclick="toggleLibraryMode()">' + (showAllMode || !currentFilterLibrary ? '切换偏好' : '切换全部') + '</button>' : '') +
        '</div>';

    let modeIndicator = '';
    if (currentFilterLibrary && !showAllMode) {
        modeIndicator = '<div class="library-mode-indicator">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>' +
            '当前: ' + currentFilterLibrary + ' (' + holdings.length + '本)</div>';
    }

    let tableHtml = '';
    if (holdings.length > 0) {
        tableHtml = '<table class="holdings-table"><thead><tr><th>馆藏地</th><th>条码号</th><th>索书号</th><th>状态</th></tr></thead><tbody>' +
            holdings.map(h => '<tr>' +
                '<td>' + (escapeHtml(h.library) || '-') + '</td>' +
                '<td>' + (escapeHtml(h.location) || '-') + '</td>' +
                '<td>' + (escapeHtml(h.call_number) || '-') + '</td>' +
                '<td><span class="status-badge ' + getStatusClass(h.status) + '">' + formatStatus(h.status) + '</span></td>' +
            '</tr>').join('') +
            '</tbody></table>';
    } else {
        tableHtml = '<p style="color:var(--text-secondary);">暂无馆藏信息</p>';
    }

    container.innerHTML = filterSection + modeIndicator + tableHtml;
}

function formatStatus(status) {
    if (!status) return '未知';
    if (status.includes('丢失')) return '不可借阅';
    if (status.includes('已归还')) {
        if (status.includes('流转中')) return '流转中';
        return '可借阅';
    }
    return status;
}

function renderBookDetail(data) {
    const container = document.getElementById('book-content');
    if (!data.book) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:40px;">未找到该图书</p>';
        return;
    }

    const book = data.book;
    const holdings = getDisplayHoldings();
    const availableCount = LibraryUtils.calculateAvailableCount(holdings);

    const coverUrl = book.cover_url ?
        (book.cover_url.startsWith('http') ? book.cover_url : BASE_URL + book.cover_url) :
        BASE_URL + '/Cover/Show?instanceId=' + recordId;

    var isBookmarked = StorageUtils.isBookmarked(recordId);

    container.innerHTML =
        '<div class="book-header">' +
            '<div class="book-cover-large">' +
                '<img src="' + coverUrl + '" alt="封面" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
                '<span class="book-cover-placeholder" style="display:none">无封面</span>' +
            '</div>' +
            '<div class="book-main-info">' +
                '<h1>' + (escapeHtml(book.title) || '未知书名') + '</h1>' +
                '<p class="book-author">' + (escapeHtml(book.author) || '未知作者') + '</p>' +
                '<ul class="book-meta-list">' +
                    '<li><span class="label">出版社</span><span class="value">' + (escapeHtml(book.publisher) || '未知') + '</span></li>' +
                    '<li><span class="label">出版年</span><span class="value">' + (book.publish_year || '未知') + '</span></li>' +
                    '<li><span class="label">索书号</span><span class="value">' + (escapeHtml(book.call_number) || '未知') + '</span></li>' +
                    '<li><span class="label">ISBN</span><span class="value">' + (book.isbn || '未知') + '</span></li>' +
                '</ul>' +
                '<button class="detail-bookmark-btn' + (isBookmarked ? ' bookmarked' : '') + '" id="detail-bookmark-btn" onclick="toggleBookmarkDetail(\'' + recordId + '\',\'' + escapeAttr(book.title || '') + '\',\'' + escapeAttr(book.author || '') + '\',\'' + escapeAttr(coverUrl) + '\')">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="' + (isBookmarked ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
                    (isBookmarked ? '已收藏' : '收藏') +
                '</button>' +
            '</div>' +
        '</div>' +
        (book.summary ? '<div class="summary-section"><h3>内容简介</h3><p style="line-height:1.8;color:var(--text-secondary);">' + escapeHtml(book.summary) + '</p></div>' : '') +
        '<div class="holdings-section">' +
            '<div class="holdings-header">' +
                '<h2>馆藏信息 (' + holdings.length + '本，可借' + availableCount + '本)</h2>' +
                '<a href="' + BASE_URL + '/Record/' + recordId + '" target="_blank" class="btn-official">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>' +
                    '官网详情</a>' +
            '</div>' +
            '<div id="holdings-table-container"></div>' +
        '</div>';

    renderHoldingsTable();
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

// === Bookmark Detail Toggle ===
function toggleBookmarkDetail(recordId, title, author, coverUrl) {
    var added = StorageUtils.toggleBookmark(recordId, title, author, coverUrl);
    var btn = document.getElementById('detail-bookmark-btn');
    if (btn) {
        if (added) {
            btn.classList.add('bookmarked');
        } else {
            btn.classList.remove('bookmarked');
        }
        var svg = btn.querySelector('svg');
        if (svg) svg.setAttribute('fill', added ? 'currentColor' : 'none');
        // Update text node
        for (var i = btn.childNodes.length - 1; i >= 0; i--) {
            if (btn.childNodes[i].nodeType === 3) {
                btn.childNodes[i].textContent = added ? '已收藏' : '收藏';
                break;
            }
        }
    }
    if (recordSidebarOpen && recordSidebarTab === 'bookmarks') loadRecordBookmarksList();
}

// === Sidebar for Record Page ===
function toggleRecordSidebar(tab) {
    if (recordSidebarOpen && recordSidebarTab === tab) {
        closeRecordSidebar();
        return;
    }
    recordSidebarTab = tab;
    recordSidebarOpen = true;
    document.getElementById('sidebar-overlay').classList.add('active');
    document.getElementById('sidebar-panel').classList.add('open');
    document.getElementById('btn-history').classList.toggle('active', tab === 'history');
    document.getElementById('btn-bookmarks').classList.toggle('active', tab === 'bookmarks');
    switchRecordSidebarTab(tab);
}

function closeRecordSidebar() {
    recordSidebarOpen = false;
    document.getElementById('sidebar-overlay').classList.remove('active');
    document.getElementById('sidebar-panel').classList.remove('open');
    document.getElementById('btn-history').classList.remove('active');
    document.getElementById('btn-bookmarks').classList.remove('active');
    document.getElementById('sidebar-footer').style.display = 'none';
}

function switchRecordSidebarTab(tab) {
    recordSidebarTab = tab;
    document.getElementById('sidebar-tab-history').classList.toggle('active', tab === 'history');
    document.getElementById('sidebar-tab-bookmarks').classList.toggle('active', tab === 'bookmarks');
    document.getElementById('sidebar-title').textContent = tab === 'history' ? '搜索历史' : '收藏夹';
    if (tab === 'history') loadRecordHistoryList();
    else loadRecordBookmarksList();
}

function loadRecordHistoryList() {
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
        return '<div class="history-item" onclick="window.location.href=\'/Search/Results?lookfor=' + encodeURIComponent(item.keyword) + '&type=' + item.search_type + '\'">' +
            '<span class="history-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>' +
            '<div class="history-info">' +
                '<div class="history-keyword">' + escapeHtml(item.keyword) + '</div>' +
                '<div class="history-meta">' + typeLabel + ' · ' + item.result_count + '条结果 · ' + formatTime(item.created_at) + '</div>' +
            '</div>' +
            '<button class="history-delete" onclick="deleteRecordHistory(' + item.id + ',event)" title="删除">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
        '</div>';
    }).join('');
}

function loadRecordBookmarksList() {
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
            '<button class="bookmark-delete" onclick="deleteRecordBookmark(' + item.id + ',event)" title="删除">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
        '</div>';
    }).join('');
}

function deleteRecordHistory(id, event) {
    event.stopPropagation();
    StorageUtils.deleteHistory(id);
    loadRecordHistoryList();
}

function deleteRecordBookmark(id, event) {
    event.stopPropagation();
    StorageUtils.deleteBookmark(id);
    loadRecordBookmarksList();
}

function clearRecordHistory() {
    StorageUtils.clearHistory();
    loadRecordHistoryList();
}

function getStatusClass(status) {
    if (!status) return 'status-unknown';
    const s = status.toLowerCase();
    if (s.includes('流转中')) return 'status-in-transit';
    if (s.includes('可借') || s.includes('在馆') || s.includes('已归还')) return 'status-available';
    if (s.includes('借出') || s.includes('外借') || s.includes('丢失')) return 'status-unavailable';
    return 'status-unknown';
}

loadBookDetail();
