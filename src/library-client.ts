/**
 * @file library-client.ts
 * @description 上海图书馆 API 客户端 - 与上海图书馆 VuFind 系统交互
 * 
 * 本文件封装了与上海图书馆 VuFind 系统的所有 HTTP 交互逻辑。
 * 
 * 【项目地位】
 * - 作为数据获取层的核心组件，负责与外部系统通信
 * - 被 index.ts（Web API）和 cli.js（命令行工具）调用
 * 
 * 【主要功能】
 * 1. 图书搜索：构建搜索 URL 并获取搜索结果
 * 2. 图书详情：获取单本图书的详细信息
 * 3. 馆藏查询：获取图书在各分馆的馆藏状态
 * 4. 封面获取：获取图书封面图片 URL
 * 
 * 【技术实现】
 * - 使用 fetch API 发送 HTTP 请求
 * - 支持请求重试机制（最多 3 次）
 * - 模拟浏览器请求头绕过反爬虫检测
 * 
 * @author ZedeX
 * @version 1.0.0
 * @date 2026-04-18
 * @license Apache-2.0
 */

import { parseSearchResults, parseBookDetail, parseHoldings, ParsedBook, ParsedHolding } from './parser';

/**
 * 上海图书馆 VuFind 系统基础 URL
 * @constant {string}
 */
const BASE_URL = 'https://vufind.library.sh.cn';

/**
 * 搜索类型映射表
 * 将前端参数映射到 VuFind 系统的搜索类型
 * @constant {Record<string, string>}
 */
const SEARCH_TYPE_MAP: Record<string, string> = {
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
 * @constant {Record<string, string>}
 */
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

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
async function fetchWithRetry(url: string, retries = 3): Promise<string> {
  let lastError: Error | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: DEFAULT_HEADERS,
        redirect: 'follow',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.text();
    } catch (e) {
      lastError = e as Error;
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * 构建搜索 URL
 * 根据搜索参数生成上海图书馆搜索 URL
 * @function buildSearchUrl
 * @param {string} keyword - 搜索关键词
 * @param {string} [searchType='all'] - 搜索类型
 * @param {number} [page=1] - 页码
 * @param {Record<string, string>} [filters] - 筛选条件
 * @returns {string} 完整的搜索 URL
 */
function buildSearchUrl(keyword: string, searchType: string = 'all', page: number = 1, filters?: Record<string, string>): string {
  const vufindType = SEARCH_TYPE_MAP[searchType.toLowerCase()] || 'AllFields';
  const params = new URLSearchParams();
  params.append('lookfor', keyword);
  params.append('type', vufindType);
  params.append('page', String(page));

  if (filters) {
    if (filters.publishDate) params.append('filter[]', `publishDate:"${filters.publishDate}"`);
    if (filters.language) params.append('filter[]', `language:"${filters.language}"`);
    if (filters.format) params.append('filter[]', `format:"${filters.format}"`);
    if (filters.callnumber_first) params.append('filter[]', `callnumber-first:"${filters.callnumber_first}"`);
    if (filters.callnumber_lcc) params.append('filter[]', `callnumber-lcc:"${filters.callnumber_lcc}"`);
    if (filters.loanType) params.append('filter[]', `loan_type:"${filters.loanType}"`);
    if (filters.library_name) params.append('filter[]', `library_name:"${filters.library_name}"`);
  }

  return `${BASE_URL}/Search/Results?${params.toString()}`;
}

/**
 * 搜索结果接口
 * @interface SearchResult
 */
export interface SearchResult {
  success: boolean;
  query: { keyword: string; search_type: string };
  statistics: { total_results: number; returned_results: number; page: number; total_pages: number };
  books: ParsedBook[];
  error?: string;
}

/**
 * 搜索图书
 * 调用上海图书馆 API 进行图书搜索
 * @function search
 * @async
 * @param {string} keyword - 搜索关键词
 * @param {string} [searchType='all'] - 搜索类型
 * @param {number} [page=1] - 页码
 * @param {number} [limit=20] - 每页结果数
 * @param {Record<string, string>} [filters] - 筛选条件
 * @returns {Promise<SearchResult>} 搜索结果对象
 */
export async function search(keyword: string, searchType: string = 'all', page: number = 1, limit: number = 20, filters?: Record<string, string>): Promise<SearchResult> {
  try {
    const url = buildSearchUrl(keyword, searchType, page, filters);
    const html = await fetchWithRetry(url);
    const parsed = parseSearchResults(html);

    const books = parsed.books.slice(0, limit);

    return {
      success: true,
      query: { keyword, search_type: searchType },
      statistics: {
        total_results: parsed.total_results || books.length,
        returned_results: books.length,
        page: parsed.current_page || page,
        total_pages: parsed.total_pages || 1,
      },
      books,
    };
  } catch (e) {
    return {
      success: false,
      query: { keyword, search_type: searchType },
      statistics: { total_results: 0, returned_results: 0, page, total_pages: 0 },
      books: [],
      error: (e as Error).message,
    };
  }
}

/**
 * 获取图书详情
 * 根据记录 ID 获取图书详细信息
 * @function getBookDetail
 * @async
 * @param {string} recordId - 图书记录 ID
 * @returns {Promise<ParsedBookDetail|null>} 图书详情对象，失败返回 null
 */
export async function getBookDetail(recordId: string) {
  try {
    const url = `${BASE_URL}/Record/${recordId}`;
    const html = await fetchWithRetry(url);
    return parseBookDetail(html, recordId);
  } catch {
    return null;
  }
}

/**
 * 获取馆藏信息
 * 根据记录 ID 获取图书在各分馆的馆藏状态
 * @function getHoldings
 * @async
 * @param {string} recordId - 图书记录 ID
 * @returns {Promise<ParsedHolding[]>} 馆藏信息列表
 */
export async function getHoldings(recordId: string): Promise<ParsedHolding[]> {
  try {
    const url = `${BASE_URL}/Record/${recordId}/AjaxTab?tab=holdings`;
    const html = await fetchWithRetry(url);
    return parseHoldings(html, recordId);
  } catch {
    return [];
  }
}

/**
 * 获取完整馆藏信息（含统计）
 * 获取馆藏信息并计算可借数量
 * @function getFullHoldings
 * @async
 * @param {string} recordId - 图书记录 ID
 * @returns {Promise<Object>} 包含馆藏列表和统计信息的对象
 */
export async function getFullHoldings(recordId: string) {
  const holdings = await getHoldings(recordId);
  const availableCount = holdings.filter(h => {
    const s = h.status || '';
    if (s.includes('流转中')) return false;
    return s.includes('可借') || s.includes('在馆') || (s.includes('已归还') && !s.includes('流转中'));
  }).length;

  return {
    success: true,
    record_id: recordId,
    holdings,
    available_count: availableCount,
    total_count: holdings.length,
  };
}

/**
 * 获取封面图片 URL
 * 根据记录 ID 生成封面图片的 URL
 * @function getCoverUrl
 * @param {string} recordId - 图书记录 ID
 * @returns {string} 封面图片 URL
 */
export function getCoverUrl(recordId: string): string {
  return `${BASE_URL}/Cover/Show?instanceId=${recordId}`;
}
