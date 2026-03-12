# HTML to TXT — конвертер экспортов Telegram

Веб-сервис для конвертации HTML-экспортов чатов Telegram в удобный для чтения текст (.txt).

## Стек

- **Frontend:** Next.js 15, React 18, TypeScript, Tailwind CSS 4, Sass, PostCSS
- **Backend:** Go 1.22+, Gin, Viper (конфиг)

## Запуск

### 1. Бэкенд (Go)

```bash
cd backend
go build -o server .
./server
```

По умолчанию сервер слушает `http://0.0.0.0:8080`. Конфиг: `backend/config.yaml` (порт, CORS, лимит размера файла).

### 2. Фронтенд (Next.js)

```bash
cd frontend
cp .env.example .env   # при необходимости поменять NEXT_PUBLIC_API_URL
npm install
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

### 3. Использование

1. Нажмите «Выберите файл» и прикрепите `.html` экспорт чата Telegram.
2. Нажмите «Конвертировать и скачать».
3. Скачается файл `.txt` с тем же именем.

## Формат вывода

- Заголовок чата и разделители дат (`--- 12 January 2026 ---`).
- Сообщения в виде: `[15:11] Имя отправителя:` + текст.
- Медиа выводятся как `[Photo — Not included...]` и т.п.
- Ссылки в тексте в формате `текст (url)`.
- Реакции (эмодзи и счётчик) в конце сообщения.

## Конфигурация бэкенда

Файл `backend/config.yaml`:

```yaml
server:
  port: "8080"
  host: "0.0.0.0"

cors:
  allowed_origins:
    - "http://localhost:3000"

upload:
  max_size_mb: 50
```

Переменные окружения с префиксом `APP_` переопределяют настройки (например, `APP_SERVER_PORT=9000`).
