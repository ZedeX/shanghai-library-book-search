// parser.go - HTML 解析器
// 从上海图书馆 VuFind 系统返回的 HTML 页面中提取结构化数据
// 移植自 TypeScript 版本的 parser.ts
package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Book 搜索结果中的图书信息
type Book struct {
	RecordID            string `json:"record_id"`
	Title               string `json:"title"`
	Author              string `json:"author"`
	Publisher           string `json:"publisher"`
	PublishYear         string `json:"publish_year"`
	CallNumber          string `json:"call_number"`
	CoverURL            string `json:"cover_url"`
	AvailabilitySummary string `json:"availability_summary"`
}

// SearchResult 搜索结果
type SearchResult struct {
	Books        []Book `json:"books"`
	TotalResults int    `json:"total_results"`
	TotalPages   int    `json:"total_pages"`
	CurrentPage  int    `json:"current_page"`
}

// BookDetail 图书详情
type BookDetail struct {
	RecordID    string `json:"record_id"`
	Title       string `json:"title"`
	Author      string `json:"author"`
	Publisher   string `json:"publisher"`
	PublishYear string `json:"publish_year"`
	CallNumber  string `json:"call_number"`
	CoverURL    string `json:"cover_url"`
	ISBN        string `json:"isbn"`
	Summary     string `json:"summary"`
}

// Holding 馆藏信息
type Holding struct {
	Library   string `json:"library"`
	Location  string `json:"location"`
	CallNumber string `json:"call_number"`
	Status    string `json:"status"`
	RecordID  string `json:"record_id"`
}

// decodeHtmlEntities 解码 HTML 实体
func decodeHtmlEntities(text string) string {
	replacements := []struct {
		entity  string
		decoded string
	}{
		{"&amp;", "&"},
		{"&lt;", "<"},
		{"&gt;", ">"},
		{"&quot;", "\""},
		{"&#39;", "'"},
		{"&nbsp;", " "},
		{"&#x2F;", "/"},
		{"&#x3B;", ";"},
		{"&#x3D;", "="},
		{"&#x20;", " "},
	}
	result := text
	for _, r := range replacements {
		result = strings.ReplaceAll(result, r.entity, r.decoded)
	}
	return result
}

// stripTags 移除 HTML 标签，返回纯文本
func stripTags(html string) string {
	re := regexp.MustCompile(`<[^>]+>`)
	result := re.ReplaceAllString(html, " ")
	// 合并多余空白
	spaceRe := regexp.MustCompile(`\s+`)
	result = spaceRe.ReplaceAllString(result, " ")
	return strings.TrimSpace(result)
}

// ParseSearchResults 解析搜索结果页面
func ParseSearchResults(html string) SearchResult {
	books := []Book{}
	totalResults := 0
	totalPages := 1
	currentPage := 1
	perPage := 20

	// 提取总结果数
	totalRe := regexp.MustCompile(`共\s*(\d[\d,]*)\s*条`)
	if m := totalRe.FindStringSubmatch(html); len(m) > 1 {
		totalResults, _ = strconv.Atoi(strings.ReplaceAll(m[1], ",", ""))
	}

	// 英文格式：Showing <strong>1 - 20</strong>
	showingRe := regexp.MustCompile(`(?i)Showing\s+<strong>(\d+)\s*-\s*(\d+)</strong>`)
	if m := showingRe.FindStringSubmatch(html); len(m) > 2 {
		end, _ := strconv.Atoi(m[2])
		start, _ := strconv.Atoi(m[1])
		perPage = end - start + 1
	}

	// 中文格式：第 <strong>1 - 20</strong> 条
	cnRangeRe := regexp.MustCompile(`第\s*<strong>(\d+)\s*-\s*(\d+)\s*条</strong>`)
	if m := cnRangeRe.FindStringSubmatch(html); len(m) > 2 {
		end, _ := strconv.Atoi(m[2])
		start, _ := strconv.Atoi(m[1])
		perPage = end - start + 1
	}

	// 提取总页数
	pageRe := regexp.MustCompile(`page=(\d+)`)
	pageMatches := pageRe.FindAllStringSubmatch(html, -1)
	if len(pageMatches) > 0 {
		maxPage := 0
		for _, m := range pageMatches {
			if p, err := strconv.Atoi(m[1]); err == nil && p > maxPage {
				maxPage = p
			}
		}
		if maxPage > 0 {
			totalPages = maxPage
		}
	}

	// 如果没有总结果数但有总页数，估算
	if totalResults == 0 && totalPages > 0 {
		totalResults = totalPages * perPage
	}

	// 提取当前页
	activePageRe := regexp.MustCompile(`class="active"[^>]*><span>(\d+)</span>`)
	if m := activePageRe.FindStringSubmatch(html); len(m) > 1 {
		currentPage, _ = strconv.Atoi(m[1])
	} else {
		urlPageRe := regexp.MustCompile(`[?&]page=(\d+)`)
		if m := urlPageRe.FindStringSubmatch(html); len(m) > 1 {
			currentPage, _ = strconv.Atoi(m[1])
		}
	}

	// 按 result div 分割（Go RE2 不支持 (?=) 前瞻，改用 FindAllStringSubmatchIndex 定位）
	resultDivRe := regexp.MustCompile(`<div[^>]*id="result(\d+)"`)
	resultDivMatches := resultDivRe.FindAllStringSubmatchIndex(html, -1)

	for idx, loc := range resultDivMatches {
		// 当前 block 从此匹配开始到下一个匹配开始（或末尾）
		blockStart := loc[0]
		var blockEnd int
		if idx+1 < len(resultDivMatches) {
			blockEnd = resultDivMatches[idx+1][0]
		} else {
			blockEnd = len(html)
		}
		block := html[blockStart:blockEnd]

		book := Book{}

		// 提取记录 ID
		recordIdRe := regexp.MustCompile(`/Record/([^"?/]+)`)
		if m := recordIdRe.FindStringSubmatch(block); len(m) > 1 {
			book.RecordID = m[1]
		}

		// 提取标题
		titleRe := regexp.MustCompile(`<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)</a>`)
		if m := titleRe.FindStringSubmatch(block); len(m) > 1 {
			book.Title = strings.TrimSpace(decodeHtmlEntities(stripTags(m[1])))
		}

		// 提取作者
		authorRe := regexp.MustCompile(`<a[^>]*href="[^"]*type=Author[^"]*"[^>]*>([\s\S]*?)</a>`)
		authorMatches := authorRe.FindAllStringSubmatch(block, -1)
		if len(authorMatches) > 0 {
			authors := []string{}
			for _, m := range authorMatches {
				authors = append(authors, strings.TrimSpace(decodeHtmlEntities(stripTags(m[1]))))
			}
			book.Author = strings.Join(authors, "; ")
		}

		// 提取封面
		coverRe := regexp.MustCompile(`<img[^>]*src="([^"]*Cover[^"]*)"`)
		if m := coverRe.FindStringSubmatch(block); len(m) > 1 {
			book.CoverURL = decodeHtmlEntities(m[1])
		}

		// 提取纯文本用于解析出版信息
		bodyText := stripTags(block)

		// 提取出版社（英文格式）
		pubEnRe := regexp.MustCompile(`Published:\s*(.+?)(?:\s+Publication Dates:|\s+Call Number:|\s+查询馆藏|$)`)
		if m := pubEnRe.FindStringSubmatch(bodyText); len(m) > 1 {
			book.Publisher = strings.TrimSpace(m[1])
		} else {
			// 中文格式
			pubCnRe := regexp.MustCompile(`出版社[：:]\s*(.+?)(?:\s+出版时间[：:]|\s+索书号[：:]|\s+查询馆藏|$)`)
			if m := pubCnRe.FindStringSubmatch(bodyText); len(m) > 1 {
				book.Publisher = strings.TrimSpace(m[1])
			}
		}

		// 提取出版年（英文格式）
		yearEnRe := regexp.MustCompile(`Publication Dates:\s*(\d{4})`)
		if m := yearEnRe.FindStringSubmatch(bodyText); len(m) > 1 {
			book.PublishYear = m[1]
		} else {
			// 中文格式
			yearCnRe := regexp.MustCompile(`出版时间[：:]\s*(\d{4})`)
			if m := yearCnRe.FindStringSubmatch(bodyText); len(m) > 1 {
				book.PublishYear = m[1]
			}
		}

		// 提取索书号（英文格式）
		callEnRe := regexp.MustCompile(`Call Number:\s*(\S+)`)
		if m := callEnRe.FindStringSubmatch(bodyText); len(m) > 1 {
			book.CallNumber = m[1]
		} else {
			// 中文格式
			callCnRe := regexp.MustCompile(`索书号[：:]\s*(\S+)`)
			if m := callCnRe.FindStringSubmatch(bodyText); len(m) > 1 {
				book.CallNumber = m[1]
			}
		}

		if book.RecordID != "" {
			books = append(books, book)
		}
	}

	return SearchResult{
		Books:        books,
		TotalResults: totalResults,
		TotalPages:   totalPages,
		CurrentPage:  currentPage,
	}
}

// ParseBookDetail 解析图书详情页面
func ParseBookDetail(html string, recordId string) BookDetail {
	detail := BookDetail{
		RecordID: recordId,
	}

	// 提取标题
	titleRe := regexp.MustCompile(`<h3[^>]*property="name"[^>]*>([\s\S]*?)</h3>`)
	if m := titleRe.FindStringSubmatch(html); len(m) > 1 {
		detail.Title = decodeHtmlEntities(stripTags(m[1]))
	}

	// 提取作者
	authorRe := regexp.MustCompile(`<span[^>]*class="[^"]*author-data[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)</a>`)
	authorMatches := authorRe.FindAllStringSubmatch(html, -1)
	if len(authorMatches) > 0 {
		authors := []string{}
		for _, m := range authorMatches {
			authors = append(authors, strings.TrimSpace(decodeHtmlEntities(stripTags(m[1]))))
		}
		detail.Author = strings.Join(authors, "; ")
	}

	// 提取出版社
	pubRe := regexp.MustCompile(`<span[^>]*property="publisher"[^>]*>([\s\S]*?)</span>`)
	if m := pubRe.FindStringSubmatch(html); len(m) > 1 {
		detail.Publisher = decodeHtmlEntities(stripTags(m[1]))
	}

	// 提取封面
	coverRe := regexp.MustCompile(`<img[^>]*src="([^"]*Cover[^"]*)"`)
	if m := coverRe.FindStringSubmatch(html); len(m) > 1 {
		detail.CoverURL = decodeHtmlEntities(m[1])
	}

	// 提取摘要
	summaryRe := regexp.MustCompile(`<div[^>]*class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)</div>`)
	if m := summaryRe.FindStringSubmatch(html); len(m) > 1 {
		detail.Summary = decodeHtmlEntities(stripTags(m[1]))
	}

	// 解析详情表格
	tableRe := regexp.MustCompile(`<table[^>]*id="table-detail"[^>]*>([\s\S]*?)</table>`)
	if m := tableRe.FindStringSubmatch(html); len(m) > 1 {
		tableHtml := m[1]
		rowRe := regexp.MustCompile(`<tr[^>]*>([\s\S]*?)</tr>`)
		rows := rowRe.FindAllStringSubmatch(tableHtml, -1)

		for _, row := range rows {
			rowHtml := row[1]
			thRe := regexp.MustCompile(`<th[^>]*>([\s\S]*?)</th>`)
			tdRe := regexp.MustCompile(`<td[^>]*>([\s\S]*?)</td>`)

			thMatch := thRe.FindStringSubmatch(rowHtml)
			tdMatch := tdRe.FindStringSubmatch(rowHtml)

			if len(thMatch) > 1 && len(tdMatch) > 1 {
				th := strings.TrimSpace(stripTags(thMatch[1]))
				td := strings.TrimSpace(stripTags(tdMatch[1]))

				// ISBN
				if matched, _ := regexp.MatchString(`(?i)isbn`, th); matched {
					isbnRe := regexp.MustCompile(`[\d\-Xx]+`)
					if m := isbnRe.FindStringSubmatch(td); len(m) > 0 {
						detail.ISBN = m[0]
					}
				} else if matched, _ := regexp.MatchString(`出版`, th); matched {
					if matched2, _ := regexp.MatchString(`日期|时间|年`, th); matched2 {
						yearRe := regexp.MustCompile(`(\d{4})`)
						if m := yearRe.FindStringSubmatch(td); len(m) > 1 {
							detail.PublishYear = m[1]
						}
					}
				} else if strings.Contains(th, "索书号") {
					detail.CallNumber = td
				}
			}
		}
	}

	// 默认封面 URL
	if detail.CoverURL == "" {
		detail.CoverURL = fmt.Sprintf("/Cover/Show?instanceId=%s", recordId)
	}

	return detail
}

// ParseHoldings 解析馆藏信息页面
func ParseHoldings(html string, recordId string) []Holding {
	holdings := []Holding{}
	currentLibrary := ""

	// 提取图书馆名称和位置
	h3Re := regexp.MustCompile(`<h3[^>]*>([\s\S]*?)</h3>`)
	h3Matches := h3Re.FindAllStringSubmatchIndex(html, -1)

	type libPosition struct {
		pos     int
		library string
	}
	libPositions := []libPosition{}

	for _, m := range h3Matches {
		text := strings.TrimSpace(stripTags(html[m[2]:m[3]]))
		libMatchRe := regexp.MustCompile(`所属馆[：:]\s*(.+)`)
		if lm := libMatchRe.FindStringSubmatch(text); len(lm) > 1 {
			libPositions = append(libPositions, libPosition{pos: m[0], library: strings.TrimSpace(lm[1])})
		} else if text != "" {
			libPositions = append(libPositions, libPosition{pos: m[0], library: text})
		}
	}

	// 提取表格行
	trRe := regexp.MustCompile(`<tr[^>]*>([\s\S]*?)</tr>`)
	trMatches := trRe.FindAllStringSubmatchIndex(html, -1)

	callnumberRe := regexp.MustCompile(`<span[^>]*class="[^"]*callnumber[^"]*"[^>]*>([\s\S]*?)</span>`)
	barcodeRe := regexp.MustCompile(`<span[^>]*class="[^"]*barcode[^"]*"[^>]*>([\s\S]*?)</span>`)
	availabilityRe := regexp.MustCompile(`<span[^>]*class="[^"]*availability[^"]*"[^>]*>([\s\S]*?)</span>`)

	for _, tr := range trMatches {
		trHtml := html[tr[2]:tr[3]]
		trPos := tr[0]

		// 确定当前所属图书馆
		for _, lp := range libPositions {
			if lp.pos < trPos {
				currentLibrary = lp.library
			}
		}

		callNumber := ""
		barcode := ""
		status := ""

		if m := callnumberRe.FindStringSubmatch(trHtml); len(m) > 1 {
			callNumber = strings.TrimSpace(stripTags(m[1]))
		}
		if m := barcodeRe.FindStringSubmatch(trHtml); len(m) > 1 {
			barcode = strings.TrimSpace(stripTags(m[1]))
		}
		if m := availabilityRe.FindStringSubmatch(trHtml); len(m) > 1 {
			status = strings.TrimSpace(stripTags(m[1]))
		}

		// 如果没有从 class 中提取到状态，尝试从纯文本中提取
		if status == "" {
			statusText := stripTags(trHtml)
			if matched, _ := regexp.MatchString(`已归还|可借|在馆`, statusText); matched {
				sRe := regexp.MustCompile(`(已归还[^\s]*|可借[^\s]*|在馆[^\s]*)`)
				if m := sRe.FindStringSubmatch(statusText); len(m) > 1 {
					status = m[1]
				}
			} else if matched, _ := regexp.MatchString(`借出|外借`, statusText); matched {
				sRe := regexp.MustCompile(`(已借出[^\s]*|外借[^\s]*)`)
				if m := sRe.FindStringSubmatch(statusText); len(m) > 1 {
					status = m[1]
				}
			} else if strings.Contains(statusText, "丢失") {
				status = "馆藏丢失"
			}
		}

		// 翻译英文状态
		status = strings.ReplaceAll(status, "Available", "已归还")
		status = strings.ReplaceAll(status, "Loaned out", "已借出")
		status = strings.ReplaceAll(status, "Lost", "馆藏丢失")

		if callNumber != "" || status != "" {
			holdings = append(holdings, Holding{
				Library:    currentLibrary,
				Location:   barcode,
				CallNumber: callNumber,
				Status:     status,
				RecordID:   recordId,
			})
		}
	}

	return holdings
}
