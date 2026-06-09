// server.go - 本地 HTTP 服务器和 API 代理
// 负责提供前端静态文件和代理上海图书馆 API 请求
package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 上海图书馆 VuFind 系统基础 URL
const BaseURL = "https://vufind.library.sh.cn"

// 搜索类型映射表：前端参数 -> VuFind 搜索类型
var searchTypeMap = map[string]string{
	"all":        "AllFields",
	"title":      "Title",
	"author":     "Author",
	"publisher":  "Publisher",
	"subject":    "Subject",
	"callnumber": "CallNumber",
}

// HTTP 请求默认请求头，模拟浏览器访问
var defaultHeaders = map[string]string{
	"User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
	"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

// 排行榜 API 相关常量和缓存
const LibraryAPIBase = "https://www.library.sh.cn/library-api"

var (
	cachedAATToken string
	aatTokenTime   time.Time
	aatTokenMutex  sync.Mutex
)

// 排行榜 API 请求头
var rankingHeaders = map[string]string{
	"Content-Type": "application/json;charset=UTF-8",
	"Origin":       "https://www.library.sh.cn",
	"Referer":      "https://www.library.sh.cn/info/billboard",
	"User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

// CLC 分类列表
var clcCategories = []map[string]string{
	{"clc": "", "name": "总榜", "lan": "chi"},
	{"clc": "A", "name": "马列主义、毛泽东思想", "lan": "chi"},
	{"clc": "B", "name": "哲学", "lan": "chi"},
	{"clc": "C", "name": "社会科学总论", "lan": "chi"},
	{"clc": "D", "name": "政治、法律", "lan": "chi"},
	{"clc": "E", "name": "军事", "lan": "chi"},
	{"clc": "F", "name": "经济", "lan": "chi"},
	{"clc": "G", "name": "文化、科学、教育、体育", "lan": "chi"},
	{"clc": "H", "name": "语言、文字", "lan": "chi"},
	{"clc": "I", "name": "文学", "lan": "chi"},
	{"clc": "J", "name": "艺术", "lan": "chi"},
	{"clc": "K", "name": "历史、地理", "lan": "chi"},
	{"clc": "N", "name": "自然科学总论", "lan": "chi"},
	{"clc": "O", "name": "数理科学和化学", "lan": "chi"},
	{"clc": "P", "name": "天文学、地球科学", "lan": "chi"},
	{"clc": "Q", "name": "生物科学", "lan": "chi"},
	{"clc": "R", "name": "医药、卫生", "lan": "chi"},
	{"clc": "S", "name": "农业科学", "lan": "chi"},
	{"clc": "T", "name": "工业技术", "lan": "chi"},
	{"clc": "U", "name": "交通运输", "lan": "chi"},
	{"clc": "V", "name": "航空、航天", "lan": "chi"},
	{"clc": "X", "name": "环境科学", "lan": "chi"},
	{"clc": "Z", "name": "综合性图书", "lan": "chi"},
}

// NewRouter 创建并配置 HTTP 路由
func NewRouter() *http.ServeMux {
	mux := http.NewServeMux()

	// API 路由
	mux.HandleFunc("/api/search", corsMiddleware(handleSearch))
	mux.HandleFunc("/api/detail/", corsMiddleware(handleDetail))
	mux.HandleFunc("/api/holdings/", corsMiddleware(handleHoldings))
	mux.HandleFunc("/api/record/", corsMiddleware(handleRecord))
	mux.HandleFunc("/api/cover/", corsMiddleware(handleCover))
	mux.HandleFunc("/api/history", corsMiddleware(handleHistory))
	mux.HandleFunc("/api/history/", corsMiddleware(handleHistoryDelete))
	mux.HandleFunc("/api/bookmarks", corsMiddleware(handleBookmarks))
	mux.HandleFunc("/api/bookmarks/", corsMiddleware(handleBookmarkDelete))
	mux.HandleFunc("/api/update", corsMiddleware(handleUpdate))
	mux.HandleFunc("/api/ranking/categories", corsMiddleware(handleRankingCategories))
	mux.HandleFunc("/api/ranking/lookup", corsMiddleware(handleLookupByISBN))
	mux.HandleFunc("/api/ranking", corsMiddleware(handleRanking))

	// 静态文件服务
	mux.HandleFunc("/", handleStaticFiles)

	return mux
}

// corsMiddleware 为响应添加 CORS 头
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

// jsonResponse 返回 JSON 格式的响应
func jsonResponse(w http.ResponseWriter, data interface{}, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		DebugLog("JSON 编码失败: %v", err)
	}
}

// fetchWithRetry 带重试机制的 HTTP GET 请求
func fetchWithRetry(targetURL string, retries int) (string, error) {
	var lastErr error
	for i := 0; i < retries; i++ {
		req, err := http.NewRequest("GET", targetURL, nil)
		if err != nil {
			return "", err
		}
		for k, v := range defaultHeaders {
			req.Header.Set(k, v)
		}

		// 跳过 TLS 证书验证（部分国内网站证书链不完整）
		client := &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			DebugLog("请求失败 (第%d次): %s, 错误: %v", i+1, targetURL, err)
			if i < retries-1 {
				time.Sleep(time.Duration(500*(i+1)) * time.Millisecond)
				continue
			}
			return "", lastErr
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
			DebugLog("请求返回非200 (第%d次): %s, 状态: %s", i+1, targetURL, resp.Status)
			if i < retries-1 {
				time.Sleep(time.Duration(500*(i+1)) * time.Millisecond)
				continue
			}
			return "", lastErr
		}

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return "", err
		}
		return string(body), nil
	}
	return "", lastErr
}

// handleSearch 处理搜索 API 请求
func handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		jsonResponse(w, map[string]interface{}{
			"success": false,
			"error":   "缺少搜索关键词",
		}, http.StatusBadRequest)
		return
	}

	searchType := r.URL.Query().Get("type")
	if searchType == "" {
		searchType = "all"
	}
	page := r.URL.Query().Get("page")
	if page == "" {
		page = "1"
	}

	// 映射搜索类型
	vufindType, ok := searchTypeMap[strings.ToLower(searchType)]
	if !ok {
		vufindType = "AllFields"
	}

	// 构建搜索 URL
	params := url.Values{}
	params.Set("lookfor", q)
	params.Set("type", vufindType)
	params.Set("page", page)

	// 处理筛选条件
	if library := r.URL.Query().Get("library"); library != "" {
		params.Add("filter[]", fmt.Sprintf("library_name:\"%s\"", library))
	}
	if publishDate := r.URL.Query().Get("publishDate"); publishDate != "" {
		params.Add("filter[]", fmt.Sprintf("publishDate:\"%s\"", publishDate))
	}
	if language := r.URL.Query().Get("language"); language != "" {
		params.Add("filter[]", fmt.Sprintf("language:\"%s\"", language))
	}
	if format := r.URL.Query().Get("format"); format != "" {
		params.Add("filter[]", fmt.Sprintf("format:\"%s\"", format))
	}

	searchURL := fmt.Sprintf("%s/Search/Results?%s", BaseURL, params.Encode())
	DebugLog("搜索请求: %s", searchURL)

	html, err := fetchWithRetry(searchURL, 3)
	if err != nil {
		DebugLog("搜索请求失败: %v", err)
		jsonResponse(w, map[string]interface{}{
			"success":    false,
			"query":      map[string]string{"keyword": q, "search_type": searchType},
			"statistics": map[string]interface{}{"total_results": 0, "returned_results": 0, "page": page, "total_pages": 0},
			"books":      []interface{}{},
			"error":      err.Error(),
		}, http.StatusOK)
		return
	}

	parsed := ParseSearchResults(html)
	DebugLog("搜索解析完成: 总结果=%d, 当前页=%d, 总页=%d, 本页=%d条",
		parsed.TotalResults, parsed.CurrentPage, parsed.TotalPages, len(parsed.Books))

	result := map[string]interface{}{
		"success": true,
		"query":   map[string]string{"keyword": q, "search_type": searchType},
		"statistics": map[string]interface{}{
			"total_results":   parsed.TotalResults,
			"returned_results": len(parsed.Books),
			"page":            parsed.CurrentPage,
			"total_pages":     parsed.TotalPages,
		},
		"books": parsed.Books,
	}

	// 保存搜索历史（异步）
	go func() {
		if err := SaveSearchHistory(q, searchType, parsed.TotalResults); err != nil {
			log.Printf("保存搜索历史失败: %v", err)
		}
	}()

	jsonResponse(w, result, http.StatusOK)
}

// handleDetail 处理图书详情 API 请求
func handleDetail(w http.ResponseWriter, r *http.Request) {
	recordId := strings.TrimPrefix(r.URL.Path, "/api/detail/")
	if recordId == "" {
		jsonResponse(w, map[string]interface{}{"success": false, "error": "缺少记录ID"}, http.StatusBadRequest)
		return
	}

	detailURL := fmt.Sprintf("%s/Record/%s", BaseURL, recordId)
	html, err := fetchWithRetry(detailURL, 3)
	if err != nil {
		jsonResponse(w, map[string]interface{}{"success": false, "error": err.Error()}, http.StatusOK)
		return
	}

	detail := ParseBookDetail(html, recordId)
	jsonResponse(w, map[string]interface{}{"success": true, "book": detail}, http.StatusOK)
}

// handleHoldings 处理馆藏信息 API 请求
func handleHoldings(w http.ResponseWriter, r *http.Request) {
	recordId := strings.TrimPrefix(r.URL.Path, "/api/holdings/")
	if recordId == "" {
		jsonResponse(w, map[string]interface{}{"success": false, "error": "缺少记录ID"}, http.StatusBadRequest)
		return
	}

	holdingsURL := fmt.Sprintf("%s/Record/%s/AjaxTab?tab=holdings", BaseURL, recordId)
	html, err := fetchWithRetry(holdingsURL, 3)
	if err != nil {
		jsonResponse(w, map[string]interface{}{"success": false, "error": err.Error()}, http.StatusOK)
		return
	}

	holdings := ParseHoldings(html, recordId)
	availableCount := 0
	for _, h := range holdings {
		if strings.Contains(h.Status, "可借") || strings.Contains(h.Status, "在馆") ||
			(strings.Contains(h.Status, "已归还") && !strings.Contains(h.Status, "流转中")) {
			availableCount++
		}
	}

	jsonResponse(w, map[string]interface{}{
		"success":         true,
		"record_id":       recordId,
		"holdings":        holdings,
		"available_count": availableCount,
		"total_count":     len(holdings),
	}, http.StatusOK)
}

// handleRecord 处理完整记录 API 请求（详情+馆藏）
func handleRecord(w http.ResponseWriter, r *http.Request) {
	recordId := strings.TrimPrefix(r.URL.Path, "/api/record/")
	if recordId == "" {
		jsonResponse(w, map[string]interface{}{"success": false, "error": "缺少记录ID"}, http.StatusBadRequest)
		return
	}

	// 并发获取详情和馆藏
	type detailResult struct {
		detail  *BookDetail
		holdings []Holding
	}

	ch := make(chan detailResult, 2)

	go func() {
		detailURL := fmt.Sprintf("%s/Record/%s", BaseURL, recordId)
		html, err := fetchWithRetry(detailURL, 3)
		if err != nil {
			ch <- detailResult{detail: nil}
			return
		}
		d := ParseBookDetail(html, recordId)
		ch <- detailResult{detail: &d}
	}()

	go func() {
		holdingsURL := fmt.Sprintf("%s/Record/%s/AjaxTab?tab=holdings", BaseURL, recordId)
		html, err := fetchWithRetry(holdingsURL, 3)
		if err != nil {
			ch <- detailResult{holdings: nil}
			return
		}
		ch <- detailResult{holdings: ParseHoldings(html, recordId)}
	}()

	r1 := <-ch
	r2 := <-ch

	var detail *BookDetail
	var holdings []Holding

	if r1.detail != nil {
		detail = r1.detail
		holdings = r2.holdings
	} else {
		detail = r2.detail
		holdings = r1.holdings
	}

	if holdings == nil {
		holdings = []Holding{}
	}

	availableCount := 0
	for _, h := range holdings {
		if strings.Contains(h.Status, "可借") || strings.Contains(h.Status, "在馆") ||
			(strings.Contains(h.Status, "已归还") && !strings.Contains(h.Status, "流转中")) {
			availableCount++
		}
	}

	jsonResponse(w, map[string]interface{}{
		"success":   true,
		"book":      detail,
		"holdings":  map[string]interface{}{"holdings": holdings, "available_count": availableCount, "total_count": len(holdings), "record_id": recordId, "success": true},
	}, http.StatusOK)
}

// handleCover 处理封面 URL API 请求
func handleCover(w http.ResponseWriter, r *http.Request) {
	recordId := strings.TrimPrefix(r.URL.Path, "/api/cover/")
	if recordId == "" {
		jsonResponse(w, map[string]interface{}{"success": false, "error": "缺少记录ID"}, http.StatusBadRequest)
		return
	}

	coverURL := fmt.Sprintf("%s/Cover/Show?instanceId=%s", BaseURL, recordId)
	jsonResponse(w, map[string]interface{}{
		"success": true,
		"url":     coverURL,
	}, http.StatusOK)
}

// handleHistory 处理搜索历史 API 请求
func handleHistory(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		history, err := GetSearchHistory(50)
		if err != nil {
			jsonResponse(w, map[string]interface{}{"success": false, "error": err.Error()}, http.StatusInternalServerError)
			return
		}
		jsonResponse(w, map[string]interface{}{"success": true, "history": history}, http.StatusOK)

	case http.MethodPost:
		var req struct {
			Keyword     string `json:"keyword"`
			SearchType  string `json:"search_type"`
			ResultCount int    `json:"result_count"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonResponse(w, map[string]interface{}{"success": false, "error": "无效的请求体"}, http.StatusBadRequest)
			return
		}
		if err := SaveSearchHistory(req.Keyword, req.SearchType, req.ResultCount); err != nil {
			jsonResponse(w, map[string]interface{}{"success": false, "error": err.Error()}, http.StatusInternalServerError)
			return
		}
		jsonResponse(w, map[string]interface{}{"success": true}, http.StatusOK)

	default:
		jsonResponse(w, map[string]interface{}{"success": false, "error": "不支持的方法"}, http.StatusMethodNotAllowed)
	}
}

// handleHistoryDelete 处理删除搜索历史 API 请求
func handleHistoryDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		jsonResponse(w, map[string]interface{}{"success": false, "error": "不支持的方法"}, http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/history/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		jsonResponse(w, map[string]interface{}{"success": false, "error": "无效的ID"}, http.StatusBadRequest)
		return
	}

	if err := DeleteSearchHistory(id); err != nil {
		jsonResponse(w, map[string]interface{}{"success": false, "error": err.Error()}, http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]interface{}{"success": true}, http.StatusOK)
}

// handleBookmarks 处理收藏 API 请求
func handleBookmarks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		bookmarks, err := GetBookmarks()
		if err != nil {
			jsonResponse(w, map[string]interface{}{"success": false, "error": err.Error()}, http.StatusInternalServerError)
			return
		}
		jsonResponse(w, map[string]interface{}{"success": true, "bookmarks": bookmarks}, http.StatusOK)

	case http.MethodPost:
		var req struct {
			RecordID string `json:"record_id"`
			Title    string `json:"title"`
			Author   string `json:"author"`
			CoverURL string `json:"cover_url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonResponse(w, map[string]interface{}{"success": false, "error": "无效的请求体"}, http.StatusBadRequest)
			return
		}
		if err := SaveBookmark(req.RecordID, req.Title, req.Author, req.CoverURL); err != nil {
			jsonResponse(w, map[string]interface{}{"success": false, "error": err.Error()}, http.StatusInternalServerError)
			return
		}
		jsonResponse(w, map[string]interface{}{"success": true}, http.StatusOK)

	default:
		jsonResponse(w, map[string]interface{}{"success": false, "error": "不支持的方法"}, http.StatusMethodNotAllowed)
	}
}

// handleBookmarkDelete 处理删除收藏 API 请求
func handleBookmarkDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		jsonResponse(w, map[string]interface{}{"success": false, "error": "不支持的方法"}, http.StatusMethodNotAllowed)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/bookmarks/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		jsonResponse(w, map[string]interface{}{"success": false, "error": "无效的ID"}, http.StatusBadRequest)
		return
	}

	if err := DeleteBookmark(id); err != nil {
		jsonResponse(w, map[string]interface{}{"success": false, "error": err.Error()}, http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]interface{}{"success": true}, http.StatusOK)
}

// handleUpdate 处理版本更新检查 API 请求
func handleUpdate(w http.ResponseWriter, r *http.Request) {
	result := CheckUpdate(AppVersion)
	jsonResponse(w, result, http.StatusOK)
}

// handleStaticFiles 处理嵌入的静态文件请求
func handleStaticFiles(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}

	// 从嵌入的文件系统中读取文件（embed.FS 使用正斜杠）
	filePath := "frontend" + path
	data, err := FrontendFS.ReadFile(filePath)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	// 根据文件扩展名设置 Content-Type
	contentType := "application/octet-stream"
	switch strings.ToLower(filepath.Ext(path)) {
	case ".html":
		contentType = "text/html; charset=utf-8"
	case ".css":
		contentType = "text/css; charset=utf-8"
	case ".js":
		contentType = "application/javascript; charset=utf-8"
	case ".json":
		contentType = "application/json; charset=utf-8"
	case ".svg":
		contentType = "image/svg+xml"
	case ".png":
		contentType = "image/png"
	case ".jpg", ".jpeg":
		contentType = "image/jpeg"
	case ".ico":
		contentType = "image/x-icon"
	case ".woff":
		contentType = "font/woff"
	case ".woff2":
		contentType = "font/woff2"
	}

	w.Header().Set("Content-Type", contentType)
	// 允许 WebView2 加载外部图片和字体
	if strings.ToLower(filepath.Ext(path)) == ".html" {
		w.Header().Set("Content-Security-Policy", "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:* https://vufind.library.sh.cn https://*.library.sh.cn data: blob:; img-src * data: blob:; font-src * data:; connect-src * http://127.0.0.1:* https://*.library.sh.cn")
	}
	w.Write(data)
}

// getAATToken 获取上海图书馆 AAT Token（带缓存，24小时内复用）
func getAATToken() (string, error) {
	aatTokenMutex.Lock()
	defer aatTokenMutex.Unlock()

	// 缓存有效（24小时内），直接返回
	if cachedAATToken != "" && time.Since(aatTokenTime) < 24*time.Hour {
		DebugLog("使用缓存的 AAT Token, 获取时间: %s", aatTokenTime.Format("2006-01-02 15:04:05"))
		return cachedAATToken, nil
	}

	DebugLog("获取新的 AAT Token...")
	tokenURL := LibraryAPIBase + "/st/token/aatTokenAcquire"

	body := []byte("{}")
	req, err := http.NewRequest("POST", tokenURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("创建 AAT Token 请求失败: %w", err)
	}

	for k, v := range rankingHeaders {
		req.Header.Set(k, v)
	}

	client := &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求 AAT Token 失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取 AAT Token 响应失败: %w", err)
	}

	DebugLog("AAT Token 响应: %s", string(respBody))

	// 解析响应，提取 token
	var tokenResp struct {
		Code string `json:"code"`
		Data struct {
			Aat string `json:"aat"`
		} `json:"data"`
		Msg string `json:"msg"`
	}
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return "", fmt.Errorf("解析 AAT Token 响应失败: %w", err)
	}

	if tokenResp.Data.Aat == "" {
		return "", fmt.Errorf("AAT Token 为空, 响应: %s", string(respBody))
	}

	cachedAATToken = tokenResp.Data.Aat
	aatTokenTime = time.Now()
	DebugLog("获取 AAT Token 成功, 长度: %d", len(cachedAATToken))

	return cachedAATToken, nil
}

// handleRankingCategories 处理排行榜分类列表 API 请求
func handleRankingCategories(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonResponse(w, map[string]interface{}{
			"success": false,
			"error":   "不支持的方法",
		}, http.StatusMethodNotAllowed)
		return
	}

	jsonResponse(w, map[string]interface{}{
		"success":    true,
		"categories": clcCategories,
	}, http.StatusOK)
}

// handleRanking 处理排行榜查询 API 请求
func handleRanking(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonResponse(w, map[string]interface{}{
			"success": false,
			"error":   "不支持的方法",
		}, http.StatusMethodNotAllowed)
		return
	}

	// 解析查询参数
	rankType := r.URL.Query().Get("type")
	if rankType == "" {
		rankType = "adult_month"
	}

	date := r.URL.Query().Get("date")
	if date == "" {
		// 默认当前月份，1月则用上年12月
		now := time.Now()
		year := now.Year()
		month := int(now.Month()) - 1
		if month < 1 {
			month = 12
			year--
		}
		date = fmt.Sprintf("%d%02d", year, month)
	}

	clc := r.URL.Query().Get("clc")
	lan := r.URL.Query().Get("lan")
	if lan == "" {
		lan = "chi"
	}

	DebugLog("排行榜查询: type=%s, date=%s, clc=%s, lan=%s", rankType, date, clc, lan)

	// 获取 AAT Token
	token, err := getAATToken()
	if err != nil {
		DebugLog("获取 AAT Token 失败: %v", err)
		jsonResponse(w, map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("获取 Token 失败: %v", err),
		}, http.StatusOK)
		return
	}

	// 构建请求体
	reqBody := map[string]string{
		"aat":  token,
		"date": date,
		"type": rankType,
		"clc":  clc,
		"lan":  lan,
	}
	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		jsonResponse(w, map[string]interface{}{
			"success": false,
			"error":   "构建请求体失败",
		}, http.StatusOK)
		return
	}

	// 根据是否有分类选择不同端点
	var apiURL string
	if clc == "" {
		apiURL = LibraryAPIBase + "/st/dataEastPavilion/queryBookBillboardGather"
	} else {
		apiURL = LibraryAPIBase + "/st/dataEastPavilion/queryBookBillboard"
	}

	DebugLog("排行榜 API 请求: %s", apiURL)

	req, err := http.NewRequest("POST", apiURL, bytes.NewReader(reqJSON))
	if err != nil {
		jsonResponse(w, map[string]interface{}{
			"success": false,
			"error":   "创建请求失败",
		}, http.StatusOK)
		return
	}

	for k, v := range rankingHeaders {
		req.Header.Set(k, v)
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		DebugLog("排行榜 API 请求失败: %v", err)
		jsonResponse(w, map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("请求排行榜数据失败: %v", err),
		}, http.StatusOK)
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		DebugLog("读取排行榜响应失败: %v", err)
		jsonResponse(w, map[string]interface{}{
			"success": false,
			"error":   "读取响应失败",
		}, http.StatusOK)
		return
	}

	DebugLog("排行榜 API 响应长度: %d", len(respBody))

	// 解析响应 - data字段可能是对象也可能是空字符串
	var rankResp struct {
		Code string          `json:"code"`
		Data json.RawMessage `json:"data"`
		Msg  string          `json:"msg"`
	}
	if err := json.Unmarshal(respBody, &rankResp); err != nil {
		DebugLog("解析排行榜响应失败: %v", err)
		jsonResponse(w, map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("解析响应失败: %v", err),
		}, http.StatusOK)
		return
	}

	if rankResp.Code != "200" {
		DebugLog("排行榜 API 返回非200: code=%s, msg=%s", rankResp.Code, rankResp.Msg)
		// 少儿榜等可能返回错误，返回空列表而不是报错
		jsonResponse(w, map[string]interface{}{
			"success":  true,
			"ranking":  []interface{}{},
			"date":     date,
			"type":     rankType,
			"category": clc,
		}, http.StatusOK)
		return
	}

	// 尝试解析data为对象
	var rankData struct {
		Result []map[string]interface{} `json:"result"`
	}
	var ranking []map[string]interface{}
	if err := json.Unmarshal(rankResp.Data, &rankData); err == nil {
		ranking = rankData.Result
	}
	if ranking == nil {
		ranking = []map[string]interface{}{}
	}

	DebugLog("排行榜查询成功, 返回 %d 条记录", len(ranking))

	jsonResponse(w, map[string]interface{}{
		"success":  true,
		"ranking":  ranking,
		"date":     date,
		"type":     rankType,
		"category": clc,
	}, http.StatusOK)
}

// 用于匹配路径参数的正则表达式
var detailPathRe = regexp.MustCompile(`^/api/detail/([^/]+)$`)
var holdingsPathRe = regexp.MustCompile(`^/api/holdings/([^/]+)$`)
var recordPathRe = regexp.MustCompile(`^/api/record/([^/]+)$`)
var coverPathRe = regexp.MustCompile(`^/api/cover/([^/]+)$`)

// handleLookupByISBN 通过ISBN或书名搜索获取record ID（使用VuFind JSON API）
func handleLookupByISBN(w http.ResponseWriter, r *http.Request) {
	isbn := r.URL.Query().Get("isbn")
	title := r.URL.Query().Get("title")
	if isbn == "" && title == "" {
		jsonResponse(w, map[string]interface{}{"success": false, "error": "缺少isbn或title参数"}, http.StatusBadRequest)
		return
	}

	// 尝试多种搜索策略，优先ISBN精确匹配
	strategies := []struct {
		name    string
		lookfor string
		typ     string
	}{
		{"isbn", isbn, "ISN"},
		{"title", title, "Title"},
		{"allfields", title, "AllFields"},
	}

	for _, s := range strategies {
		if s.lookfor == "" {
			continue
		}
		// 使用VuFind JSON API，直接返回结构化数据，无需解析HTML
		apiURL := fmt.Sprintf("%s/api/v1/search?lookfor=%s&type=%s&limit=1", BaseURL, url.QueryEscape(s.lookfor), s.typ)
		DebugLog("查找策略: %s, URL: %s", s.name, apiURL)

		resp, err := fetchWithRetry(apiURL, 3)
		if err != nil {
			DebugLog("查找失败 (%s): %v", s.name, err)
			continue
		}

		// 解析VuFind JSON API响应
		var apiResp struct {
			Status      string `json:"status"`
			ResultCount int    `json:"resultCount"`
			Records     []struct {
				ID    string `json:"id"`
				Title string `json:"title"`
			} `json:"records"`
		}
		if err := json.Unmarshal([]byte(resp), &apiResp); err != nil {
			DebugLog("解析JSON失败 (%s): %v", s.name, err)
			continue
		}

		if apiResp.Status == "OK" && len(apiResp.Records) > 0 {
			recordId := apiResp.Records[0].ID
			DebugLog("查找成功: strategy=%s, lookfor=%s, recordId=%s, title=%s", s.name, s.lookfor, recordId, apiResp.Records[0].Title)
			jsonResponse(w, map[string]interface{}{"success": true, "recordId": recordId}, http.StatusOK)
			return
		}
		DebugLog("策略%s未找到结果 (resultCount=%d)", s.name, apiResp.ResultCount)
	}

	jsonResponse(w, map[string]interface{}{"success": false, "error": "未找到对应图书记录"}, http.StatusOK)
}
