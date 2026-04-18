/**
 * @file parser.ts
 * @description HTML 解析器 - 从上海图书馆网页中提取结构化数据
 * 
 * 本文件负责将上海图书馆 VuFind 系统返回的 HTML 页面解析为结构化的 JSON 数据。
 * 
 * 【项目地位】
 * - 作为数据处理层的核心组件，是数据获取与业务逻辑之间的桥梁
 * - 被 library-client.ts 和 cli.js 共同使用
 * 
 * 【主要功能】
 * 1. 搜索结果解析：从搜索结果页面提取图书列表和分页信息
 * 2. 图书详情解析：从图书详情页面提取完整元数据
 * 3. 馆藏信息解析：从馆藏页面提取各分馆的借阅状态
 * 
 * 【解析策略】
 * - 使用正则表达式匹配 HTML 结构
 * - 支持中英文两种页面格式
 * - 自动解码 HTML 实体
 * 
 * @author ZedeX
 * @version 1.0.0
 * @date 2026-04-18
 * @license Apache-2.0
 */

/**
 * 解析后的图书信息接口（搜索结果）
 * @interface ParsedBook
 */
export interface ParsedBook {
  record_id: string;
  title: string;
  author: string;
  publisher: string;
  publish_year: string;
  call_number: string;
  cover_url: string;
  availability_summary: string;
}

/**
 * 解析后的搜索结果接口
 * @interface ParsedSearchResult
 */
export interface ParsedSearchResult {
  books: ParsedBook[];
  total_results: number;
  total_pages: number;
  current_page: number;
}

/**
 * 解析后的图书详情接口
 * @interface ParsedBookDetail
 */
export interface ParsedBookDetail {
  record_id: string;
  title: string;
  author: string;
  publisher: string;
  publish_year: string;
  call_number: string;
  cover_url: string;
  isbn: string;
  summary: string;
}

/**
 * 解析后的馆藏信息接口
 * @interface ParsedHolding
 */
export interface ParsedHolding {
  library: string;
  location: string;
  call_number: string;
  status: string;
  record_id: string;
}

/**
 * 解码 HTML 实体
 * 将 HTML 实体字符转换为对应的 Unicode 字符
 * @function decodeHtmlEntities
 * @param {string} text - 包含 HTML 实体的文本
 * @returns {string} 解码后的文本
 */
function decodeHtmlEntities(text: string): string {
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
 * 将 HTML 字符串转换为纯文本
 * @function stripTags
 * @param {string} html - HTML 字符串
 * @returns {string} 纯文本字符串
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 解析搜索结果页面
 * 从上海图书馆搜索结果 HTML 页面中提取图书列表和分页信息
 * @function parseSearchResults
 * @param {string} html - 搜索结果页面的 HTML 内容
 * @returns {ParsedSearchResult} 解析结果对象
 */
export function parseSearchResults(html: string): ParsedSearchResult {
  const books: ParsedBook[] = [];
  let totalResults = 0;
  let totalPages = 1;
  let currentPage = 1;
  let perPage = 20;

  const totalMatch = html.match(/共\s*(\d[\d,]*)\s*条/);
  if (totalMatch) {
    totalResults = parseInt(totalMatch[1].replace(/,/g, ''), 10);
  }

  const showingMatch = html.match(/Showing\s+<strong>(\d+)\s*-\s*(\d+)<\/strong>/i)
    || html.match(/Showing[^<]*<strong>(\d+)\s*-\s*(\d+)<\/strong>/i);
  if (showingMatch) {
    perPage = parseInt(showingMatch[2], 10) - parseInt(showingMatch[1], 10) + 1;
  }

  const cnRangeMatch = html.match(/第\s*<strong>(\d+)\s*-\s*(\d+)\s*条<\/strong>/);
  if (cnRangeMatch) {
    perPage = parseInt(cnRangeMatch[2], 10) - parseInt(cnRangeMatch[1], 10) + 1;
  }

  const pageMatches = [...html.matchAll(/page=(\d+)/g)];
  if (pageMatches.length > 0) {
    const pageNums = pageMatches.map(m => parseInt(m[1], 10)).filter(n => n > 0);
    if (pageNums.length > 0) {
      totalPages = Math.max(...pageNums);
    }
  }

  if (totalResults === 0 && totalPages > 0) {
    totalResults = totalPages * perPage;
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

    const book: ParsedBook = {
      record_id: '',
      title: '',
      author: '',
      publisher: '',
      publish_year: '',
      call_number: '',
      cover_url: '',
      availability_summary: '',
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

    const coverMatch = block.match(/<img[^>]*src="([^"]*Cover[^"]*)"/);
    if (coverMatch) {
      book.cover_url = decodeHtmlEntities(coverMatch[1]);
    }

    const bodyText = stripTags(block);

    const publisherMatch = bodyText.match(/Published:\s*(.+?)(?:\s+Publication Dates:|\s+Call Number:|\s+查询馆藏|$)/);
    if (publisherMatch) {
      book.publisher = publisherMatch[1].trim();
    } else {
      const pubMatch2 = bodyText.match(/出版社[：:]\s*(.+?)(?:\s+出版时间[：:]|\s+索书号[：:]|\s+查询馆藏|$)/);
      if (pubMatch2) {
        book.publisher = pubMatch2[1].trim();
      }
    }

    const yearMatch = bodyText.match(/Publication Dates:\s*(\d{4})/);
    if (yearMatch) {
      book.publish_year = yearMatch[1];
    } else {
      const yearMatch2 = bodyText.match(/出版时间[：:]\s*(\d{4})/);
      if (yearMatch2) {
        book.publish_year = yearMatch2[1];
      }
    }

    const callNumberMatch = bodyText.match(/Call Number:\s*(\S+)/);
    if (callNumberMatch) {
      book.call_number = callNumberMatch[1];
    } else {
      const cnMatch2 = bodyText.match(/索书号[：:]\s*(\S+)/);
      if (cnMatch2) {
        book.call_number = cnMatch2[1];
      }
    }

    if (book.record_id) {
      books.push(book);
    }
  }

  return { books, total_results: totalResults, total_pages: totalPages, current_page: currentPage };
}

/**
 * 解析图书详情页面
 * 从上海图书馆图书详情 HTML 页面中提取图书详细信息
 * @function parseBookDetail
 * @param {string} html - 图书详情页面的 HTML 内容
 * @param {string} recordId - 图书记录 ID
 * @returns {ParsedBookDetail} 图书详情对象
 */
export function parseBookDetail(html: string, recordId: string): ParsedBookDetail {
  const detail: ParsedBookDetail = {
    record_id: recordId,
    title: '',
    author: '',
    publisher: '',
    publish_year: '',
    call_number: '',
    cover_url: '',
    isbn: '',
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

  const coverMatch = html.match(/<img[^>]*src="([^"]*Cover[^"]*)"/);
  if (coverMatch) {
    detail.cover_url = decodeHtmlEntities(coverMatch[1]);
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

  if (!detail.cover_url) {
    detail.cover_url = `/Cover/Show?instanceId=${recordId}`;
  }

  return detail;
}

/**
 * 解析馆藏信息页面
 * 从上海图书馆馆藏 HTML 页面中提取各分馆的馆藏状态
 * @function parseHoldings
 * @param {string} html - 馆藏页面的 HTML 内容
 * @param {string} recordId - 图书记录 ID
 * @returns {ParsedHolding[]} 馆藏信息列表
 */
export function parseHoldings(html: string, recordId: string): ParsedHolding[] {
  const holdings: ParsedHolding[] = [];
  let currentLibrary = '';

  const libH3Matches = html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g);
  const libPositions: { pos: number; library: string }[] = [];
  for (const m of libH3Matches) {
    const text = stripTags(m[1]).trim();
    const libMatch = text.match(/所属馆[：:]\s*(.+)/);
    if (libMatch) {
      libPositions.push({ pos: m.index!, library: libMatch[1].trim() });
    } else if (text) {
      libPositions.push({ pos: m.index!, library: text });
    }
  }

  const trMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
  for (const tr of trMatches) {
    const trHtml = tr[1];
    const trPos = tr.index!;

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
        status: status,
        record_id: recordId,
      });
    }
  }

  return holdings;
}
