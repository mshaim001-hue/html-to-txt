package converter

import (
	"bytes"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/net/html"
)

// TelegramExportToTXT converts Telegram HTML export to readable plain text.
func TelegramExportToTXT(htmlBytes []byte) ([]byte, error) {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(htmlBytes))
	if err != nil {
		return nil, err
	}

	var out strings.Builder
	out.Grow(len(htmlBytes) / 2)

	// Chat title from page_header
	doc.Find(".page_header .text.bold").Each(func(i int, s *goquery.Selection) {
		title := strings.TrimSpace(s.Text())
		if title != "" {
			out.WriteString(title)
			out.WriteString("\n")
			out.WriteString(strings.Repeat("=", len(title)))
			out.WriteString("\n\n")
		}
	})

	// Messages container
	history := doc.Find(".history")
	if history.Length() == 0 {
		history = doc.Find("body")
	}

	history.Children().Each(func(i int, s *goquery.Selection) {
		// Pagination link - skip or note
		if s.HasClass("pagination") || s.HasClass("block_link") {
			text := strings.TrimSpace(s.Text())
			if strings.Contains(strings.ToLower(text), "previous") || strings.Contains(strings.ToLower(text), "message") {
				out.WriteString("\n[ ")
				out.WriteString(text)
				out.WriteString(" ]\n\n")
			}
			return
		}

		// Service message (date separator)
		if s.HasClass("service") {
			details := s.Find(".body.details").First()
			dateStr := strings.TrimSpace(details.Text())
			if dateStr != "" {
				out.WriteString("\n")
				out.WriteString("--- ")
				out.WriteString(dateStr)
				out.WriteString(" ---\n\n")
			}
			return
		}

		// Regular message
		if s.HasClass("message") && s.HasClass("default") {
			body := s.Find(".body").First()
			if body.Length() == 0 {
				return
			}

			// Time (prefer short "15:11" from text, then full from title)
			timeEl := body.Find(".date.details").First()
			timeStr := strings.TrimSpace(timeEl.Text())
			if timeStr == "" {
				timeStr = strings.TrimSpace(timeEl.AttrOr("title", ""))
			}

			// Sender
			fromName := strings.TrimSpace(body.Find(".from_name").First().Text())

			// Build header: [HH:MM] Sender:
			if timeStr != "" || fromName != "" {
				out.WriteString("[")
				if timeStr != "" {
					out.WriteString(timeStr)
				}
				out.WriteString("]")
				if fromName != "" {
					out.WriteString(" ")
					out.WriteString(fromName)
					out.WriteString(":")
				}
				out.WriteString("\n")
			}

			// Media (photo, video, voice, etc.)
			body.Find(".media_wrap .media").Each(func(_ int, m *goquery.Selection) {
				titleEl := m.Find(".title.bold").First()
				descEl := m.Find(".description").First()
				title := strings.TrimSpace(titleEl.Text())
				desc := strings.TrimSpace(descEl.Text())
				if title != "" {
					out.WriteString("[")
					out.WriteString(title)
					if desc != "" {
						out.WriteString(" — ")
						out.WriteString(desc)
					}
					out.WriteString("]\n")
				}
			})

			// Message text (strip HTML, keep newlines)
			textEl := body.Find(".text").First()
			if textEl.Length() > 0 {
				txt := htmlToPlainText(textEl)
				txt = strings.TrimSpace(txt)
				if txt != "" {
					out.WriteString(txt)
					out.WriteString("\n")
				}
			}

			// Reactions
			body.Find(".reactions .reaction").Each(func(_ int, r *goquery.Selection) {
				emoji := strings.TrimSpace(r.Find(".emoji").First().Text())
				count := strings.TrimSpace(r.Find(".count").First().Text())
				if emoji != "" {
					out.WriteString(emoji)
					if count != "" {
						out.WriteString(" ")
						out.WriteString(count)
					}
					out.WriteString(" ")
				}
			})
			if body.Find(".reactions .reaction").Length() > 0 {
				out.WriteString("\n")
			}

			out.WriteString("\n")
		}
	})

	return []byte(strings.TrimSpace(out.String())), nil
}

// htmlToPlainText converts inline HTML (strong, br, a) to plain text.
func htmlToPlainText(s *goquery.Selection) string {
	var b strings.Builder
	slice := s.Nodes
	if len(slice) == 0 {
		return ""
	}
	renderNodeText(slice[0], &b)
	return b.String()
}

func renderNodeText(n *html.Node, b *strings.Builder) {
	if n.Type == html.TextNode {
		b.WriteString(n.Data)
		return
	}
	if n.Type != html.ElementNode {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			renderNodeText(c, b)
		}
		return
	}
	switch n.Data {
	case "br":
		b.WriteString("\n")
	case "strong", "b":
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			renderNodeText(c, b)
		}
	case "a":
		var linkText strings.Builder
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			renderNodeText(c, &linkText)
		}
		href := ""
		for _, a := range n.Attr {
			if a.Key == "href" {
				href = a.Val
				break
			}
		}
		t := linkText.String()
		if href != "" && t != "" {
			b.WriteString(t)
			b.WriteString(" (")
			b.WriteString(href)
			b.WriteString(")")
		} else if t != "" {
			b.WriteString(t)
		} else if href != "" {
			b.WriteString(href)
		}
	default:
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			renderNodeText(c, b)
		}
	}
}
