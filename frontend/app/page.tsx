"use client";

import { useState, useRef } from "react";
import styles from "./page.module.scss";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    setError(null);
    if (chosen) {
      const ext = chosen.name.toLowerCase().slice(chosen.name.lastIndexOf("."));
      if (ext !== ".html" && ext !== ".htm") {
        setError("Выберите файл .html или .htm");
        setFile(null);
        return;
      }
      setFile(chosen);
    } else {
      setFile(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Сначала выберите файл");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/api/convert`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || res.statusText || "Ошибка конвертации");
      }
      const blob = await res.blob();
      const name = file.name.replace(/\.(html?|htm)$/i, ".txt");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка конвертации");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <h1 className={styles.title}>HTML → TXT</h1>
        <p className={styles.subtitle}>
          Конвертация экспорта чата Telegram в удобный текст для чтения
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            <span className={styles.labelText}>Файл экспорта (.html)</span>
            <input
              ref={inputRef}
              type="file"
              accept=".html,.htm"
              onChange={handleFileChange}
              className={styles.input}
              disabled={loading}
            />
            {file && (
              <span className={styles.fileName}>{file.name}</span>
            )}
          </label>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <div className={styles.actions}>
            <button
              type="submit"
              disabled={!file || loading}
              className={styles.button}
            >
              {loading ? "Обработка…" : "Конвертировать и скачать"}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className={styles.buttonSecondary}
              disabled={loading}
            >
              Сбросить
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
