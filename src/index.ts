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
