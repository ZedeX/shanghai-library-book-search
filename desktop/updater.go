// updater.go - GitHub 更新检查器
// 检查 GitHub 仓库的最新版本并返回更新信息
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// GitHub 仓库信息
const (
	GitHubOwner = "ZedeX"
	GitHubRepo  = "shanghai-library-book-search-cloudflare"
)

// UpdateInfo 更新信息
type UpdateInfo struct {
	HasUpdate      bool   `json:"has_update"`
	LatestVersion  string `json:"latest_version"`
	CurrentVersion string `json:"current_version"`
	DownloadURL    string `json:"download_url"`
	ReleaseNotes   string `json:"release_notes"`
}

// GitHubRelease GitHub 发布信息
type GitHubRelease struct {
	TagName string `json:"tag_name"`
	Body    string `json:"body"`
	HTMLURL string `json:"html_url"`
	Assets  []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

// CheckUpdate 检查是否有新版本
func CheckUpdate(currentVersion string) UpdateInfo {
	info := UpdateInfo{
		HasUpdate:      false,
		CurrentVersion: currentVersion,
	}

	client := &http.Client{Timeout: 10 * time.Second}
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", GitHubOwner, GitHubRepo)

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return info
	}
	req.Header.Set("User-Agent", "shlib-desktop/"+currentVersion)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(req)
	if err != nil {
		return info
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return info
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return info
	}

	var release GitHubRelease
	if err := json.Unmarshal(body, &release); err != nil {
		return info
	}

	// 清理版本号（去除 v 前缀）
	latestVersion := strings.TrimPrefix(release.TagName, "v")
	info.LatestVersion = latestVersion
	info.ReleaseNotes = release.Body

	// 查找 Windows 可执行文件的下载链接
	for _, asset := range release.Assets {
		if strings.HasSuffix(strings.ToLower(asset.Name), ".exe") {
			info.DownloadURL = asset.BrowserDownloadURL
			break
		}
	}

	// 如果没有找到 exe 文件，使用发布页面 URL
	if info.DownloadURL == "" {
		info.DownloadURL = release.HTMLURL
	}

	// 比较版本号
	info.HasUpdate = compareVersions(latestVersion, currentVersion) > 0

	return info
}

// compareVersions 比较两个版本号
// 返回: 1 表示 v1 > v2, -1 表示 v1 < v2, 0 表示相等
func compareVersions(v1, v2 string) int {
	parts1 := strings.Split(v1, ".")
	parts2 := strings.Split(v2, ".")

	maxLen := len(parts1)
	if len(parts2) > maxLen {
		maxLen = len(parts2)
	}

	for i := 0; i < maxLen; i++ {
		var n1, n2 int
		if i < len(parts1) {
			fmt.Sscanf(parts1[i], "%d", &n1)
		}
		if i < len(parts2) {
			fmt.Sscanf(parts2[i], "%d", &n2)
		}

		if n1 > n2 {
			return 1
		} else if n1 < n2 {
			return -1
		}
	}

	return 0
}
