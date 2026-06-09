// shlib-desktop - 上海图书馆图书检索桌面应用
// 本文件是应用的入口点，负责启动本地 HTTP 服务器和 WebView2 窗口
package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/jchv/go-webview2"
)

// 当前版本号
const AppVersion = "1.0.0"

// 应用名称
const AppName = "上海图书馆图书检索"

// DebugMode 全局调试模式开关
var DebugMode = false

// DebugLog 调试日志输出（同时写文件和控制台）
var debugLogFile *os.File

func DebugLog(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	log.Print(msg)
	if debugLogFile != nil {
		fmt.Fprintf(debugLogFile, "%s\n", msg)
	}
}

func main() {
	// 解析命令行参数
	for _, arg := range os.Args[1:] {
		if arg == "--debug" || arg == "-d" {
			DebugMode = true
		}
	}

	// 初始化调试日志文件
	if DebugMode {
		logDir := filepath.Join(os.Getenv("APPDATA"), "shlib-desktop")
		os.MkdirAll(logDir, 0755)
		logPath := filepath.Join(logDir, "debug.log")
		var err error
		debugLogFile, err = os.Create(logPath)
		if err != nil {
			log.Printf("无法创建调试日志文件: %v", err)
		} else {
			log.Printf("调试日志写入: %s", logPath)
		}
	}

	DebugLog("应用启动, 版本: %s, 调试模式: %v", AppVersion, DebugMode)

	// 初始化数据库
	if err := InitDB(); err != nil {
		log.Fatalf("初始化数据库失败: %v", err)
	}
	defer CloseDB()

	// 在随机可用端口启动本地 HTTP 服务器
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("启动监听失败: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port

	// 创建路由并启动服务器
	mux := NewRouter()
	server := &http.Server{Handler: mux}

	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("HTTP 服务器错误: %v", err)
		}
	}()

	serverURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	log.Printf("本地服务器启动: %s", serverURL)
	DebugLog("本地服务器启动: %s", serverURL)

	// 创建 WebView2 窗口
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		Debug:     DebugMode, // debug模式下启用WebView2开发者工具
		WindowOptions: webview2.WindowOptions{
			Title:  AppName,
			Width:  1200,
			Height: 800,
			Center: true,
		},
	})
	if w == nil {
		log.Fatal("创建 WebView2 窗口失败，请确保已安装 WebView2 运行时")
	}
	defer w.Destroy()

	// 导航到本地服务器
	w.Navigate(serverURL)

	// 监听窗口关闭事件，优雅关闭服务器
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		server.Close()
		os.Exit(0)
	}()

	// 运行 WebView2 主循环（阻塞直到窗口关闭）
	w.Run()

	// 窗口关闭后关闭服务器
	server.Close()
	if debugLogFile != nil {
		debugLogFile.Close()
	}
	log.Println("应用已退出")
}
