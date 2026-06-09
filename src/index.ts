/**
 * @file index.ts
 * @description Cloudflare Workers 入口文件 - HTTP 请求路由处理
 * 
 * 本文件是 Cloudflare Workers 的主入口，负责处理所有 HTTP 请求的路由分发。
 * 
 * 【项目地位】
 * - 作为 Web 应用的后端入口，是整个系统的核心路由层
 * - 连接前端静态资源与后端 API 服务
 * 
 * 【主要功能】
 * 1. API 路由：处理 /api/* 路径的 API 请求
 * 2. 静态资源代理：将非 API 请求转发到静态资源服务
 * 3. URL 重写：将旧版 URL 格式重定向到新的前端页面
 * 4. CORS 支持：为所有 API 响应添加跨域头
 * 
 * 【API 端点】
 * - GET /api/search?q={keyword}&type={type}&page={page} - 搜索图书
 * - GET /api/detail/{recordId} - 获取图书详情
 * - GET /api/holdings/{recordId} - 获取馆藏信息
 * - GET /api/record/{recordId} - 获取完整记录（详情+馆藏）
 * - GET /api/cover/{recordId} - 获取封面图片 URL
 * - GET /api/ranking/categories - 获取排行榜分类列表
 * - GET /api/ranking?type={type}&date={date}&clc={clc}&lan={lan} - 获取排行榜数据
 * 
 * 【依赖关系】
 * - 依赖 library-client.ts 提供的数据获取功能
 * - 依赖 Cloudflare Workers 的 ASSETS 绑定提供静态资源
 * 
 * @author ZedeX
 * @version 1.0.0
 * @date 2026-04-18
 * @license Apache-2.0
 */

import { search, getBookDetail, getFullHoldings, getCoverUrl } from './library-client';

/**
 * AAT Token 缓存
 * CF Workers 全局变量，缓存 token 以减少重复请求
 */
let cachedAatToken: string | null = null;
let cachedAatTokenTime = 0;
const AAT_TOKEN_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * CLC 分类列表
 */
const CLC_CATEGORIES = [
  { clc: '', name: '总榜', lan: 'chi' },
  { clc: 'A', name: '马列主义、毛泽东思想', lan: 'chi' },
  { clc: 'B', name: '哲学', lan: 'chi' },
  { clc: 'C', name: '社会科学总论', lan: 'chi' },
  { clc: 'D', name: '政治、法律', lan: 'chi' },
  { clc: 'E', name: '军事', lan: 'chi' },
  { clc: 'F', name: '经济', lan: 'chi' },
  { clc: 'G', name: '文化、科学、教育、体育', lan: 'chi' },
  { clc: 'H', name: '语言、文字', lan: 'chi' },
  { clc: 'I', name: '文学', lan: 'chi' },
  { clc: 'J', name: '艺术', lan: 'chi' },
  { clc: 'K', name: '历史、地理', lan: 'chi' },
  { clc: 'N', name: '自然科学总论', lan: 'chi' },
  { clc: 'O', name: '数理科学和化学', lan: 'chi' },
  { clc: 'P', name: '天文学、地球科学', lan: 'chi' },
  { clc: 'Q', name: '生物科学', lan: 'chi' },
  { clc: 'R', name: '医药、卫生', lan: 'chi' },
  { clc: 'S', name: '农业科学', lan: 'chi' },
  { clc: 'T', name: '工业技术', lan: 'chi' },
  { clc: 'U', name: '交通运输', lan: 'chi' },
  { clc: 'V', name: '航空、航天', lan: 'chi' },
  { clc: 'X', name: '环境科学', lan: 'chi' },
  { clc: 'Z', name: '综合性图书', lan: 'chi' },
];

/**
 * Cloudflare Workers 环境变量接口
 * @interface Env
 * @property {Fetcher} ASSETS - Cloudflare Pages 静态资源服务绑定
 */
interface Env {
  ASSETS: Fetcher;
}

/**
 * 创建 JSON 响应
 * 将数据序列化为 JSON 并添加 CORS 头
 * @function jsonResponse
 * @param {unknown} data - 要返回的数据
 * @param {number} [status=200] - HTTP 状态码
 * @returns {Response} 包含 JSON 数据的 Response 对象
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * 获取 AAT Token（带缓存）
 * 向上海图书馆 API 请求 AAT 令牌，缓存 5 分钟
 * @function getAatToken
 * @async
 * @returns {Promise<string>} AAT Token
 */
async function getAatToken(): Promise<string> {
  const now = Date.now();
  if (cachedAatToken && (now - cachedAatTokenTime) < AAT_TOKEN_TTL) {
    return cachedAatToken;
  }

  const tokenResponse = await fetch(
    'https://www.library.sh.cn/library-api/st/token/aatTokenAcquire',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Origin': 'https://www.library.sh.cn',
        'Referer': 'https://www.library.sh.cn/info/billboard',
      },
      body: JSON.stringify({}),
    }
  );

  const tokenData = await tokenResponse.json() as {
    code: string;
    data?: { aat?: string };
  };

  if (tokenData.code === '200' && tokenData.data?.aat) {
    cachedAatToken = tokenData.data.aat;
    cachedAatTokenTime = now;
    return cachedAatToken;
  }

  throw new Error('Failed to acquire AAT token');
}

/**
 * 处理 API 请求
 * 根据请求路径分发到对应的处理函数
 * @function handleApiRequest
 * @async
 * @param {string} path - 请求路径
 * @param {URL} url - 完整的 URL 对象
 * @returns {Promise<Response>} API 响应
 */
async function handleApiRequest(path: string, url: URL): Promise<Response> {
  if (path === '/api/search') {
    const q = url.searchParams.get('q') || '';
    if (!q) {
      return jsonResponse({ success: false, error: 'Missing query parameter' }, 400);
    }
    const searchType = url.searchParams.get('type') || 'all';
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    const filters: Record<string, string> = {};
    if (url.searchParams.get('publishDate')) filters.publishDate = url.searchParams.get('publishDate')!;
    if (url.searchParams.get('language')) filters.language = url.searchParams.get('language')!;
    if (url.searchParams.get('format')) filters.format = url.searchParams.get('format')!;
    if (url.searchParams.get('clc')) filters.callnumber_first = url.searchParams.get('clc')!;
    if (url.searchParams.get('lcc')) filters.callnumber_lcc = url.searchParams.get('lcc')!;
    if (url.searchParams.get('loanType')) filters.loanType = url.searchParams.get('loanType')!;
    if (url.searchParams.get('library')) filters.library_name = url.searchParams.get('library')!;

    const result = await search(q, searchType, page, limit, Object.keys(filters).length > 0 ? filters : undefined);
    return jsonResponse(result);
  }

  const detailMatch = path.match(/^\/api\/detail\/([^/]+)$/);
  if (detailMatch) {
    const recordId = detailMatch[1];
    const book = await getBookDetail(recordId);
    if (book) {
      return jsonResponse({ success: true, book });
    }
    return jsonResponse({ success: false, error: 'Book not found' }, 404);
  }

  const recordMatch = path.match(/^\/api\/record\/([^/]+)$/);
  if (recordMatch) {
    const recordId = recordMatch[1];
    const [book, holdingsData] = await Promise.all([
      getBookDetail(recordId),
      getFullHoldings(recordId),
    ]);
    return jsonResponse({
      success: true,
      book: book || null,
      holdings: holdingsData,
    });
  }

  const holdingsMatch = path.match(/^\/api\/(holdings|detail)\/([^/]+)\/holdings$/);
  if (holdingsMatch) {
    const recordId = holdingsMatch[2];
    const result = await getFullHoldings(recordId);
    return jsonResponse(result);
  }

  const simpleHoldingsMatch = path.match(/^\/api\/holdings\/([^/]+)$/);
  if (simpleHoldingsMatch) {
    const recordId = simpleHoldingsMatch[1];
    const result = await getFullHoldings(recordId);
    return jsonResponse(result);
  }

  // Ranking categories endpoint
  if (path === '/api/ranking/categories') {
    return jsonResponse({ success: true, categories: CLC_CATEGORIES });
  }

  // ISBN lookup endpoint - find record ID by ISBN
  if (path === '/api/ranking/lookup') {
    const isbn = url.searchParams.get('isbn') || '';
    const title = url.searchParams.get('title') || '';
    if (!isbn && !title) return jsonResponse({ success: false, error: 'Missing isbn or title parameter' }, 400);
    const VUFIND_BASE = 'https://vufind.library.sh.cn';
    const strategies = [
      { name: 'isbn', lookfor: isbn, type: 'ISN' },
      { name: 'title', lookfor: title, type: 'Title' },
      { name: 'allfields', lookfor: title, type: 'AllFields' },
    ];
    for (const s of strategies) {
      if (!s.lookfor) continue;
      try {
        const apiURL = `${VUFIND_BASE}/api/v1/search?lookfor=${encodeURIComponent(s.lookfor)}&type=${s.type}&limit=1`;
        const resp = await fetch(apiURL, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        const data = await resp.json() as any;
        if (data.status === 'OK' && data.records && data.records.length > 0) {
          return jsonResponse({ success: true, recordId: data.records[0].id });
        }
      } catch (e) {
        // continue to next strategy
      }
    }
    return jsonResponse({ success: false, error: 'Book not found' });
  }

  // Ranking data endpoint
  if (path === '/api/ranking') {
    const type = url.searchParams.get('type') || 'adult_month';
    const date = url.searchParams.get('date') || '';
    const clc = url.searchParams.get('clc') || '';
    const lan = url.searchParams.get('lan') || 'chi';

    if (!date) {
      return jsonResponse({ success: false, error: 'Missing date parameter' }, 400);
    }

    try {
      // Get AAT token (with cache)
      const token = await getAatToken();

      // Choose endpoint based on clc parameter
      const rankingUrl = clc
        ? 'https://www.library.sh.cn/library-api/st/dataEastPavilion/queryBookBillboard'
        : 'https://www.library.sh.cn/library-api/st/dataEastPavilion/queryBookBillboardGather';

      const rankingResponse = await fetch(rankingUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'Origin': 'https://www.library.sh.cn',
          'Referer': 'https://www.library.sh.cn/info/billboard',
        },
        body: JSON.stringify({ aat: token, date, type, clc, lan }),
      });

      const rankingData = await rankingResponse.json() as {
        code: string;
        data?: { result?: Array<Record<string, string>> } | string;
        msg?: string;
      };

      if (rankingData.code === '200' && typeof rankingData.data === 'object' && rankingData.data?.result) {
        return jsonResponse({
          success: true,
          ranking: rankingData.data.result,
          date,
          type,
        });
      }

      // 少儿榜等可能返回非200或空data，返回空列表
      return jsonResponse({
        success: true,
        ranking: [],
        date,
        type,
      });
    } catch (e) {
      return jsonResponse({
        success: false,
        error: (e as Error).message,
      }, 500);
    }
  }

  const coverMatch = path.match(/^\/api\/cover\/([^/]+)$/);
  if (coverMatch) {
    const recordId = coverMatch[1];
    const coverUrl = getCoverUrl(recordId);
    return jsonResponse({ success: true, url: coverUrl });
  }

  return jsonResponse({ success: false, error: 'Not found' }, 404);
}

/**
 * Cloudflare Workers 导出处理对象
 * 实现 ExportedHandler 接口，处理所有 fetch 请求
 * @type {ExportedHandler<Env>}
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (path.startsWith('/api/')) {
      return handleApiRequest(path, url);
    }

    if (path === '/Search/Results') {
      return env.ASSETS.fetch(new Request(new URL('/search.html', url.origin)));
    }

    const recordPageMatch = path.match(/^\/Record\/([^/]+)$/);
    if (recordPageMatch) {
      return env.ASSETS.fetch(new Request(new URL('/record.html', url.origin)));
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
