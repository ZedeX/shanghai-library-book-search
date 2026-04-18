#!/usr/bin/env node
/**
 * @file cli.js
 * @description 上海图书馆图书检索命令行工具 (CLI)
 * 
 * 本文件是项目的命令行入口，提供图书搜索、详情查看、馆藏查询等功能。
 * 
 * 【项目地位】
 * - 作为独立的 CLI 工具，可全局安装使用
 * - 与 Web 版本共享相同的后端 API 逻辑
 * 
 * 【主要功能】
 * 1. 图书搜索：支持书名、作者、出版社、索书号等多维度搜索
 * 2. 图书详情：查看图书的详细信息（ISBN、出版社、简介等）
 * 3. 馆藏查询：查看各分馆的馆藏状态和可借数量
 * 4. 场馆筛选：支持按图书馆名称筛选结果
 * 
 * 【依赖关系】
 * - 直接调用上海图书馆 VuFind 系统的 Web 接口
 * - 使用 Node.js 内置 fetch API（Node 18+）
 * 
 * @author ZedeX
 * @version 1.0.0
 * @date 2026-04-18
 * @license Apache-2.0
 */

/**
 * 上海图书馆 VuFind 系统基础 URL
 * @constant {string}
 */
const LIBRARY_BASE_URL = 'https://vufind.library.sh.cn';

/**
 * 搜索类型映射表
 * 将 CLI 参数映射到 VuFind 系统的搜索类型
 * @constant {Object.<string, string>}
 */
const SEARCH_TYPE_MAP = {
  all: 'AllFields',
  title: 'Title',
  author: 'Author',
  publisher: 'Publisher',
  subject: 'Subject',
  callnumber: 'CallNumber',
};

/**
 * HTTP 请求默认请求头
 * 模拟浏览器访问以绕过反爬虫检测
 * @constant {Object.<string, string>}
 */
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

/**
 * 显示帮助信息
 * 输出 CLI 的使用方法、参数说明和示例
 * @function showHelp
 * @returns {void}
 */
function showHelp() {
  console.log(`
上海图书馆图书检索 CLI

用法:
  shlib <书名> [选项]           搜索图书，显示所有场馆可借情况
  shlib <书名> <场馆> [选项]    搜索图书，显示指定场馆可借情况

选项:
  -t, --type <类型>     搜索类型 (默认: all)
                        all=全部字段, title=书名, author=作者
                        publisher=出版社, subject=主题, callnumber=索书号
  -p, --page <页码>     页码 (默认: 1)
  -l, --limit <数量>    每页结果数 (默认: 20, 最大: 50)
  -d, --detail <ID>     直接查看图书详情 (record ID)
  -h, --help            显示帮助信息
  -v, --version         显示版本号

示例:
  shlib 红楼梦                      搜索"红楼梦"，显示所有场馆可借情况
  shlib 红楼梦 上海图书馆东馆        搜索"红楼梦"，只显示东馆可借情况
  shlib 三体 -t title               按书名搜索"三体"
  shlib 刘慈欣 -t author            按作者搜索"刘慈欣"
  shlib 人民文学出版社 -t publisher  按出版社搜索
  shlib I247.5 -t callnumber        按索书号搜索
  shlib 红楼梦 -p 2                 搜索第2页结果
  shlib 红楼梦 -l 10                每页显示10条结果
  shlib -d 4264088b-1b2c-4a76-9544-1823d8354d3f  查看图书详情

场馆名称简写:
  东馆     = 上海图书馆东馆
  淮海路   = 上海图书馆淮海路馆
  闵行     = 闵行分馆
  浦东     = 浦东新区分馆
  黄浦     = 黄浦分馆
  徐汇     = 徐汇区图书馆（徐家汇书院）
  长宁     = 长宁区图书馆
  静安     = 静安区图书馆
  普陀     = 普陀分馆
  虹口     = 虹口区图书馆
  杨浦     = 杨浦分馆
  宝山     = 宝山分馆
  嘉定     = 嘉定分馆
  青浦     = 青浦分馆
  松江     = 松江区图书馆
  奉贤     = 奉贤分馆
  金山     = 金山分馆
  崇明     = 崇明分馆
`);
}

/**
 * 显示版本号
 * 从 package.json 读取并输出版本信息
 * @function showVersion
 * @returns {void}
 */
function showVersion() {
  const pkg = require('./package.json');
  console.log(pkg.version);
}

/**
 * 图书馆名称别名映射表
 * 用于将用户输入的简写转换为完整的图书馆名称
 * @constant {Object.<string, string>}
 */
const LIBRARY_ALIASES = {
  '东馆': '上海图书馆东馆',
  '淮海路': '上海图书馆淮海路馆',
  '淮海': '上海图书馆淮海路馆',
  '闵行': '闵行分馆',
  '浦东': '浦东新区分馆',
  '黄浦': '黄浦分馆',
  '徐汇': '徐汇区图书馆（徐家汇书院）',
  '徐家汇': '徐汇区图书馆（徐家汇书院）',
  '长宁': '长宁区图书馆',
  '静安': '静安区图书馆',
  '普陀': '普陀分馆',
  '虹口': '虹口区图书馆',
  '杨浦': '杨浦分馆',
  '宝山': '宝山分馆',
  '嘉定': '嘉定分馆',
  '青浦': '青浦分馆',
  '松江': '松江区图书馆',
  '奉贤': '奉贤分馆',
  '金山': '金山分馆',
  '崇明': '崇明分馆',
};

/**
 * 解析图书馆名称
 * 将用户输入的简写或部分名称转换为完整的图书馆名称
 * @function resolveLibraryName
 * @param {string} name - 用户输入的图书馆名称（可能是简写）
 * @returns {string|null} 完整的图书馆名称，如果无法解析则返回 null
 * @example
 * resolveLibraryName('东馆') // 返回 '上海图书馆东馆'
 * resolveLibraryName('徐汇') // 返回 '徐汇区图书馆（徐家汇书院）'
 */
function resolveLibraryName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [alias, fullName] of Object.entries(LIBRARY_ALIASES)) {
    if (alias === name || fullName.includes(name) || lower === alias.toLowerCase()) {
      return fullName;
    }
  }
  return name;
}

/**
 * 解码 HTML 实体
 * 将 HTML 实体字符转换为对应的 Unicode 字符
 * @function decodeHtmlEntities
 * @param {string} text - 包含 HTML 实体的文本
 * @returns {string} 解码后的文本
 * @example
 * decodeHtmlEntities('&amp;') // 返回 '&'
 * decodeHtmlEntities('&lt;div&gt;') // 返回 '<div>'
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x3B;/g, ';')
    .replace(/&#x3D;/g, '=')
    .replace(/&#x20;/g, ' ');
}

/**
 * 移除 HTML 标签
 * 将 HTML 字符串转换为纯文本，保留换行结构
 * @function stripTags
 * @param {string} html - HTML 字符串
 * @returns {string} 纯文本字符串
 * @example
 * stripTags('<p>Hello</p>') // 返回 'Hello'
 * stripTags('<br/>Line2') // 返回 '\nLine2'
 */
function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * 解析搜索结果页面
 * 从上海图书馆搜索结果 HTML 页面中提取图书列表和分页信息
 * @function parseSearchResults
 * @param {string} html - 搜索结果页面的 HTML 内容
 * @returns {Object} 解析结果对象
 * @returns {Array<Object>} returns.books - 图书列表
 * @returns {string} returns.books[].record_id - 图书记录 ID
 * @returns {string} returns.books[].title - 书名
 * @returns {string} returns.books[].author - 作者
 * @returns {string} returns.books[].publisher - 出版社
 * @returns {string} returns.books[].publish_year - 出版年份
 * @returns {string} returns.books[].call_number - 索书号
 * @returns {number} returns.totalResults - 总结果数
 * @returns {number} returns.totalPages - 总页数
 * @returns {number} returns.currentPage - 当前页码
 */
function parseSearchResults(html) {
  const books = [];
  let totalResults = 0;
  let totalPages = 1;
  let currentPage = 1;

  const totalMatch = html.match(/共\s*(\d[\d,]*)\s*条/);
  if (totalMatch) {
    totalResults = parseInt(totalMatch[1].replace(/,/g, ''), 10);
  }

  const pageMatches = [...html.matchAll(/page=(\d+)/g)];
  if (pageMatches.length > 0) {
    const pageNums = pageMatches.map(m => parseInt(m[1], 10)).filter(n => n > 0);
    if (pageNums.length > 0) {
      totalPages = Math.max(...pageNums);
    }
  }

  const activePageMatch = html.match(/class="active"[^>]*><span>(\d+)<\/span>/);
  if (activePageMatch) {
    currentPage = parseInt(activePageMatch[1], 10);
  } else {
    const urlPageMatch = html.match(/[?&]page=(\d+)/);
    if (urlPageMatch) {
      currentPage = parseInt(urlPageMatch[1], 10);
    }
  }

  const resultBlocks = html.split(/(?=<div[^>]*id="result\d+")/);
  for (const block of resultBlocks) {
    if (!/id="result\d+"/.test(block)) continue;

    const book = {
      record_id: '',
      title: '',
      author: '',
      publisher: '',
      publish_year: '',
      call_number: '',
    };

    const recordIdMatch = block.match(/\/Record\/([^"?/]+)/);
    if (recordIdMatch) {
      book.record_id = recordIdMatch[1];
    }

    const titleMatch = block.match(/<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    if (titleMatch) {
      book.title = decodeHtmlEntities(stripTags(titleMatch[1])).trim();
    }

    const authorMatches = [...block.matchAll(/<a[^>]*href="[^"]*type=Author[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];
    if (authorMatches.length > 0) {
      book.author = authorMatches.map(m => decodeHtmlEntities(stripTags(m[1])).trim()).join('; ');
    }

    const bodyText = stripTags(block);

    const publisherMatch = bodyText.match(/出版社[：:]\s*(\S+)/);
    if (publisherMatch) {
      book.publisher = publisherMatch[1].trim();
    }

    const yearMatch = bodyText.match(/出版时间[：:]\s*(\d{4})/);
    if (yearMatch) {
      book.publish_year = yearMatch[1];
    }

    const callNumberMatch = bodyText.match(/索书号[：:]\s*(\S+)/);
    if (callNumberMatch) {
      book.call_number = callNumberMatch[1].trim();
    }

    if (book.title) {
      books.push(book);
    }
  }

  return { books, totalResults, totalPages, currentPage };
}

/**
 * 解析图书详情页面
 * 从上海图书馆图书详情 HTML 页面中提取图书详细信息
 * @function parseBookDetail
 * @async
 * @param {string} html - 图书详情页面的 HTML 内容
 * @param {string} recordId - 图书记录 ID
 * @returns {Promise<Object>} 图书详情对象
 * @returns {string} returns.record_id - 图书记录 ID
 * @returns {string} returns.title - 书名
 * @returns {string} returns.author - 作者
 * @returns {string} returns.publisher - 出版社
 * @returns {string} returns.publish_year - 出版年份
 * @returns {string} returns.isbn - ISBN 号
 * @returns {string} returns.call_number - 索书号
 * @returns {string} returns.summary - 图书简介
 */
async function parseBookDetail(html, recordId) {
  const detail = {
    record_id: recordId,
    title: '',
    author: '',
    publisher: '',
    publish_year: '',
    isbn: '',
    call_number: '',
    summary: '',
  };

  const titleMatch = html.match(/<h3[^>]*property="name"[^>]*>([\s\S]*?)<\/h3>/);
  if (titleMatch) {
    detail.title = decodeHtmlEntities(stripTags(titleMatch[1]));
  }

  const authorMatches = [...html.matchAll(/<span[^>]*class="[^"]*author-data[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/g)];
  if (authorMatches.length > 0) {
    detail.author = authorMatches.map(m => decodeHtmlEntities(stripTags(m[1])).trim()).join('; ');
  }

  const publisherMatch = html.match(/<span[^>]*property="publisher"[^>]*>([\s\S]*?)<\/span>/);
  if (publisherMatch) {
    detail.publisher = decodeHtmlEntities(stripTags(publisherMatch[1]));
  }

  const summaryMatch = html.match(/<div[^>]*class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (summaryMatch) {
    detail.summary = decodeHtmlEntities(stripTags(summaryMatch[1]));
  }

  const detailTableMatch = html.match(/<table[^>]*id="table-detail"[^>]*>([\s\S]*?)<\/table>/);
  if (detailTableMatch) {
    const tableHtml = detailTableMatch[1];
    const tableRows = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
    for (const row of tableRows) {
      const rowHtml = row[1];
      const thMatch = rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/);
      const tdMatch = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/);
      if (thMatch && tdMatch) {
        const th = stripTags(thMatch[1]).trim();
        const td = stripTags(tdMatch[1]).trim();

        if (/isbn/i.test(th)) {
          const isbnMatch = td.match(/[\d\-Xx]+/);
          if (isbnMatch) detail.isbn = isbnMatch[0];
        } else if (/出版/.test(th) && /日期|时间|年/.test(th)) {
          const yearMatch = td.match(/(\d{4})/);
          if (yearMatch) detail.publish_year = yearMatch[1];
        } else if (/索书号/.test(th)) {
          detail.call_number = td;
        }
      }
    }
  }

  return detail;
}

/**
 * 解析馆藏信息页面
 * 从上海图书馆馆藏 HTML 页面中提取各分馆的馆藏状态
 * @function parseHoldings
 * @async
 * @param {string} html - 馆藏页面的 HTML 内容
 * @param {string} recordId - 图书记录 ID
 * @returns {Promise<Array<Object>>} 馆藏信息列表
 * @returns {string} returns[].library - 所属图书馆
 * @returns {string} returns[].location - 馆藏位置
 * @returns {string} returns[].call_number - 索书号
 * @returns {string} returns[].status - 借阅状态
 * @returns {boolean} returns[].available - 是否可借
 */
async function parseHoldings(html, recordId) {
  const holdings = [];
  let currentLibrary = '';

  const libH3Matches = html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g);
  const libPositions = [];
  for (const m of libH3Matches) {
    const text = stripTags(m[1]).trim();
    const libMatch = text.match(/所属馆[：:]\s*(.+)/);
    if (libMatch) {
      libPositions.push({ pos: m.index, library: libMatch[1].trim() });
    } else if (text) {
      libPositions.push({ pos: m.index, library: text });
    }
  }

  const trMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
  for (const tr of trMatches) {
    const trHtml = tr[1];
    const trPos = tr.index;

    for (const lp of libPositions) {
      if (lp.pos < trPos) {
        currentLibrary = lp.library;
      }
    }

    const callNumberMatch = trHtml.match(/<span[^>]*class="[^"]*callnumber[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    const barcodeMatch = trHtml.match(/<span[^>]*class="[^"]*barcode[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    const statusMatch = trHtml.match(/<span[^>]*class="[^"]*availability[^"]*"[^>]*>([\s\S]*?)<\/span>/);

    const callNumber = callNumberMatch ? stripTags(callNumberMatch[1]).trim() : '';
    const barcode = barcodeMatch ? stripTags(barcodeMatch[1]).trim() : '';
    let status = statusMatch ? stripTags(statusMatch[1]).trim() : '';

    if (!status) {
      const statusText = stripTags(trHtml);
      if (/已归还|可借|在馆/.test(statusText)) {
        const sMatch = statusText.match(/(已归还[^\s]*|可借[^\s]*|在馆[^\s]*)/);
        if (sMatch) status = sMatch[1];
      } else if (/借出|外借/.test(statusText)) {
        const sMatch = statusText.match(/(已借出[^\s]*|外借[^\s]*)/);
        if (sMatch) status = sMatch[1];
      } else if (/丢失/.test(statusText)) {
        status = '馆藏丢失';
      }
    }

    if (status.includes('Available')) {
      status = status.replace('Available', '已归还');
    }
    if (status.includes('Loaned out')) {
      status = status.replace('Loaned out', '已借出');
    }
    if (status.includes('Lost')) {
      status = status.replace('Lost', '馆藏丢失');
    }

    if (callNumber || status) {
      holdings.push({
        library: currentLibrary,
        location: barcode,
        call_number: callNumber,
        status,
        available: status.includes('已归还') && !status.includes('流转中'),
      });
    }
  }

  return holdings;
}

/**
 * 带重试机制的 HTTP 请求
 * 发送 HTTP GET 请求，支持自动重试
 * @function fetchWithRetry
 * @async
 * @param {string} url - 请求 URL
 * @param {number} [retries=3] - 最大重试次数
 * @returns {Promise<string>} 响应 HTML 内容
 * @throws {Error} 当所有重试都失败时抛出错误
 */
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { headers: DEFAULT_HEADERS });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

/**
 * 搜索图书
 * 调用上海图书馆 API 进行图书搜索
 * @function search
 * @async
 * @param {string} keyword - 搜索关键词
 * @param {string} [searchType='all'] - 搜索类型 (all/title/author/publisher/subject/callnumber)
 * @param {number} [page=1] - 页码
 * @param {string|null} [library=null] - 图书馆筛选条件
 * @returns {Promise<Object>} 搜索结果对象，包含图书列表和分页信息
 */
async function search(keyword, searchType = 'all', page = 1, library = null) {
  const vufindType = SEARCH_TYPE_MAP[searchType.toLowerCase()] || 'AllFields';
  const params = new URLSearchParams({
    lookfor: keyword,
    type: vufindType,
    page: String(page),
  });

  if (library) {
    params.append('filter[]', `library_name:"${library}"`);
  }

  const url = `${LIBRARY_BASE_URL}/Search/Results?${params.toString()}`;
  const html = await fetchWithRetry(url);
  return parseSearchResults(html);
}

/**
 * 获取图书详情
 * 根据记录 ID 获取图书详细信息
 * @function getBookDetail
 * @async
 * @param {string} recordId - 图书记录 ID
 * @returns {Promise<Object>} 图书详情对象
 */
async function getBookDetail(recordId) {
  const url = `${LIBRARY_BASE_URL}/Record/${recordId}`;
  const html = await fetchWithRetry(url);
  return parseBookDetail(html, recordId);
}

/**
 * 获取馆藏信息
 * 根据记录 ID 获取图书在各分馆的馆藏状态
 * @function getHoldings
 * @async
 * @param {string} recordId - 图书记录 ID
 * @returns {Promise<Array<Object>>} 馆藏信息列表
 */
async function getHoldings(recordId) {
  const url = `${LIBRARY_BASE_URL}/Record/${recordId}/AjaxTab?tab=holdings`;
  const html = await fetchWithRetry(url);
  return parseHoldings(html, recordId);
}

/**
 * 格式化图书信息输出
 * 将图书对象格式化为 CLI 友好的字符串
 * @function formatBook
 * @param {Object} book - 图书对象
 * @param {number} index - 序号
 * @returns {string} 格式化后的图书信息字符串
 */
function formatBook(book, index) {
  const lines = [
    `${index}. ${book.title}`,
    `   作者: ${book.author || '未知'}`,
    `   出版社: ${book.publisher || '未知'}${book.publish_year ? ' (' + book.publish_year + ')' : ''}`,
    `   索书号: ${book.call_number || '未知'}`,
    `   ID: ${book.record_id}`,
  ];
  return lines.join('\n');
}

/**
 * 格式化馆藏信息输出
 * 将馆藏列表格式化为 CLI 友好的字符串，支持按图书馆筛选
 * @function formatHoldings
 * @param {Array<Object>} holdings - 馆藏信息列表
 * @param {string|null} [libraryFilter=null] - 图书馆筛选条件
 * @returns {string} 格式化后的馆藏信息字符串
 */
function formatHoldings(holdings, libraryFilter = null) {
  const filtered = libraryFilter
    ? holdings.filter(h => h.library.includes(libraryFilter))
    : holdings;

  if (filtered.length === 0) {
    return '  暂无馆藏信息';
  }

  const available = filtered.filter(h => h.available);
  const lines = [
    `  可借: ${available.length}/${filtered.length} 本`,
    '',
  ];

  const grouped = {};
  for (const h of filtered) {
    if (!grouped[h.library]) grouped[h.library] = [];
    grouped[h.library].push(h);
  }

  for (const [lib, items] of Object.entries(grouped)) {
    const libAvailable = items.filter(h => h.available).length;
    lines.push(`  【${lib}】可借 ${libAvailable}/${items.length} 本`);
    for (const item of items.slice(0, 3)) {
      const statusIcon = item.available ? '✓' : '✗';
      lines.push(`    ${statusIcon} ${item.call_number || '-'} | ${item.status}`);
    }
    if (items.length > 3) {
      lines.push(`    ... 还有 ${items.length - 3} 本`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 显示图书详情
 * 获取并输出图书详情和馆藏信息
 * @function showBookDetail
 * @async
 * @param {string} recordId - 图书记录 ID
 * @returns {Promise<void>}
 */
async function showBookDetail(recordId) {
  console.log(`\n正在获取图书详情...\n`);

  const [detail, holdings] = await Promise.all([
    getBookDetail(recordId),
    getHoldings(recordId),
  ]);

  console.log(`《${detail.title}》`);
  console.log(`作者: ${detail.author || '未知'}`);
  console.log(`出版社: ${detail.publisher || '未知'} ${detail.publish_year || ''}`);
  console.log(`ISBN: ${detail.isbn || '未知'}`);
  console.log(`索书号: ${detail.call_number || '未知'}`);
  if (detail.summary) {
    console.log(`\n简介: ${detail.summary.substring(0, 200)}${detail.summary.length > 200 ? '...' : ''}`);
  }
  console.log('\n--- 馆藏信息 ---');
  console.log(formatHoldings(holdings));
}

/**
 * CLI 主函数
 * 解析命令行参数并执行相应操作
 * @function main
 * @async
 * @returns {Promise<void>}
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version')) {
    showVersion();
    process.exit(0);
  }

  let keyword = '';
  let library = null;
  let searchType = 'all';
  let page = 1;
  let limit = 20;
  let detailId = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-t' || arg === '--type') {
      searchType = args[++i] || 'all';
    } else if (arg === '-p' || arg === '--page') {
      page = parseInt(args[++i], 10) || 1;
    } else if (arg === '-l' || arg === '--limit') {
      limit = Math.min(parseInt(args[++i], 10) || 20, 50);
    } else if (arg === '-d' || arg === '--detail') {
      detailId = args[++i];
    } else if (!arg.startsWith('-')) {
      if (!keyword) {
        keyword = arg;
      } else if (!library) {
        library = resolveLibraryName(arg);
      }
    }
  }

  if (detailId) {
    await showBookDetail(detailId);
    process.exit(0);
  }

  if (!keyword) {
    console.error('错误: 请提供搜索关键词');
    console.error('使用 shlib -h 查看帮助');
    process.exit(1);
  }

  console.log(`\n搜索: "${keyword}"${library ? ` (场馆: ${library})` : ''}`);
  console.log(`类型: ${searchType} | 页码: ${page}\n`);

  try {
    const result = await search(keyword, searchType, page, library);

    if (result.books.length === 0) {
      console.log('未找到相关图书');
      process.exit(0);
    }

    console.log(`找到 ${result.totalResults > 0 ? result.totalResults + '+' : result.books.length} 条结果 (第 ${result.currentPage}/${result.totalPages} 页)\n`);

    const displayBooks = result.books.slice(0, limit);

    for (let i = 0; i < displayBooks.length; i++) {
      const book = displayBooks[i];
      console.log(formatBook(book, (page - 1) * 20 + i + 1));
      console.log('');
    }

    if (result.totalPages > 1) {
      console.log(`--- 第 ${result.currentPage}/${result.totalPages} 页 ---`);
      if (result.currentPage < result.totalPages) {
        console.log(`使用 -p ${result.currentPage + 1} 查看下一页`);
      }
    }

    console.log('\n使用 shlib -d <ID> 查看图书详情和馆藏信息');

  } catch (e) {
    console.error(`搜索失败: ${e.message}`);
    process.exit(1);
  }
}

main();
