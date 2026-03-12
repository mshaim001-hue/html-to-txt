package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"html-to-txt/config"
	"html-to-txt/converter"

	"github.com/gin-gonic/gin"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery(), corsMiddleware(cfg))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.POST("/api/convert", convertHandler(cfg))

	addr := fmt.Sprintf("%s:%s", cfg.Server.Host, cfg.Server.Port)
	log.Printf("Server listening on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func corsMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		for _, o := range cfg.CORS.AllowedOrigins {
			if o == "*" || o == origin {
				c.Header("Access-Control-Allow-Origin", o)
				break
			}
		}
		// If no match (e.g. config not loaded), allow localhost for dev
		if c.GetHeader("Access-Control-Allow-Origin") == "" && (origin == "http://localhost:3000" || origin == "http://127.0.0.1:3000") {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func convertHandler(cfg *config.Config) gin.HandlerFunc {
	maxBytes := int64(cfg.Upload.MaxSizeMB) * 1024 * 1024
	return func(c *gin.Context) {
		file, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "need file in form field 'file'"})
			return
		}
		if file.Size > maxBytes {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("file too large (max %d MB)", cfg.Upload.MaxSizeMB),
			})
			return
		}
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if ext != ".html" && ext != ".htm" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "expected .html or .htm file"})
			return
		}

		f, err := file.Open()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
			return
		}
		defer f.Close()

		htmlBytes, err := io.ReadAll(io.LimitReader(f, maxBytes))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
			return
		}

		txt, err := converter.TelegramExportToTXT(htmlBytes)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid HTML: " + err.Error()})
			return
		}

		outName := strings.TrimSuffix(file.Filename, filepath.Ext(file.Filename)) + ".txt"
		c.Header("Content-Disposition", "attachment; filename=\""+outName+"\"")
		c.Data(http.StatusOK, "text/plain; charset=utf-8", txt)
	}
}
