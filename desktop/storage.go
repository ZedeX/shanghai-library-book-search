// storage.go - SQLite 存储层
// 使用 modernc.org/sqlite（纯 Go 实现，无需 CGO）
// 提供搜索历史和收藏的增删查功能
package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

var db *sql.DB

// SearchHistoryEntry 搜索历史条目
type SearchHistoryEntry struct {
	ID          int64     `json:"id"`
	Keyword     string    `json:"keyword"`
	SearchType  string    `json:"search_type"`
	ResultCount int       `json:"result_count"`
	CreatedAt   time.Time `json:"created_at"`
}

// BookmarkEntry 收藏条目
type BookmarkEntry struct {
	ID        int64     `json:"id"`
	RecordID  string    `json:"record_id"`
	Title     string    `json:"title"`
	Author    string    `json:"author"`
	CoverURL  string    `json:"cover_url"`
	CreatedAt time.Time `json:"created_at"`
}

// getDBPath 获取数据库文件路径
func getDBPath() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
	}
	dbDir := filepath.Join(appData, "shlib-desktop")
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return "", fmt.Errorf("创建数据库目录失败: %w", err)
	}
	return filepath.Join(dbDir, "data.db"), nil
}

// InitDB 初始化数据库连接和表结构
func InitDB() error {
	dbPath, err := getDBPath()
	if err != nil {
		return err
	}
	log.Printf("数据库路径: %s", dbPath)

	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("打开数据库失败: %w", err)
	}

	// 设置连接池参数
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	// 创建表
	if err := createTables(); err != nil {
		return fmt.Errorf("创建表失败: %w", err)
	}

	return nil
}

// createTables 创建数据库表
func createTables() error {
	// 搜索历史表
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS search_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			keyword TEXT NOT NULL,
			search_type TEXT NOT NULL DEFAULT 'all',
			result_count INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
		)
	`)
	if err != nil {
		return err
	}

	// 收藏表
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS bookmarks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			record_id TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL DEFAULT '',
			author TEXT NOT NULL DEFAULT '',
			cover_url TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

// CloseDB 关闭数据库连接
func CloseDB() {
	if db != nil {
		db.Close()
	}
}

// SaveSearchHistory 保存搜索历史
func SaveSearchHistory(keyword, searchType string, resultCount int) error {
	if db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	_, err := db.Exec(
		"INSERT INTO search_history (keyword, search_type, result_count) VALUES (?, ?, ?)",
		keyword, searchType, resultCount,
	)
	return err
}

// GetSearchHistory 获取搜索历史
func GetSearchHistory(limit int) ([]SearchHistoryEntry, error) {
	if db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}
	if limit <= 0 {
		limit = 50
	}

	rows, err := db.Query(
		"SELECT id, keyword, search_type, result_count, created_at FROM search_history ORDER BY created_at DESC LIMIT ?",
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []SearchHistoryEntry
	for rows.Next() {
		var e SearchHistoryEntry
		if err := rows.Scan(&e.ID, &e.Keyword, &e.SearchType, &e.ResultCount, &e.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// DeleteSearchHistory 删除搜索历史条目
func DeleteSearchHistory(id int64) error {
	if db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	_, err := db.Exec("DELETE FROM search_history WHERE id = ?", id)
	return err
}

// SaveBookmark 保存收藏
func SaveBookmark(recordID, title, author, coverURL string) error {
	if db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	_, err := db.Exec(
		"INSERT OR REPLACE INTO bookmarks (record_id, title, author, cover_url) VALUES (?, ?, ?, ?)",
		recordID, title, author, coverURL,
	)
	return err
}

// GetBookmarks 获取所有收藏
func GetBookmarks() ([]BookmarkEntry, error) {
	if db == nil {
		return nil, fmt.Errorf("数据库未初始化")
	}

	rows, err := db.Query(
		"SELECT id, record_id, title, author, cover_url, created_at FROM bookmarks ORDER BY created_at DESC",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []BookmarkEntry
	for rows.Next() {
		var e BookmarkEntry
		if err := rows.Scan(&e.ID, &e.RecordID, &e.Title, &e.Author, &e.CoverURL, &e.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// DeleteBookmark 删除收藏条目
func DeleteBookmark(id int64) error {
	if db == nil {
		return fmt.Errorf("数据库未初始化")
	}
	_, err := db.Exec("DELETE FROM bookmarks WHERE id = ?", id)
	return err
}

// IsBookmarked 检查是否已收藏
func IsBookmarked(recordID string) (bool, error) {
	if db == nil {
		return false, fmt.Errorf("数据库未初始化")
	}
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM bookmarks WHERE record_id = ?", recordID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
