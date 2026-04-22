"use client";

import { useState, useRef, useEffect, useId } from "react";
import JSZip from "jszip";
import styles from "./page.module.scss";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

/** Сообщения с префиксом [html-to-txt:save] — фильтр в DevTools. Отключить: NEXT_PUBLIC_DEBUG_SAVE=0 */
const DEBUG_SAVE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEBUG_SAVE === "0"
    ? false
    : true;

let showSavePickerCallSeq = 0;

/**
 * После выбора файлов через input[type=file] Chrome иногда оставляет
 * нативный пикер «активным» и тогда showSaveFilePicker падает с
 * "File picker already active". Blur + сброс value снимают это.
 */
function releaseHtmlFileInput(
  el: HTMLInputElement | null,
  traceId: string,
  reason: string
) {
  if (!el) return;
  try {
    el.blur();
    el.value = "";
  } catch {
    /* ignore */
  }
  saveLog(traceId, `releaseHtmlFileInput:${reason}`, {});
}

function saveLog(
  traceId: string,
  event: string,
  detail?: Record<string, unknown>
) {
  if (!DEBUG_SAVE) return;
  const t = Math.round(performance.now());
  const el =
    typeof document !== "undefined" && document.activeElement
      ? {
          tag: document.activeElement.tagName,
          id: (document.activeElement as HTMLElement).id,
          type: (document.activeElement as HTMLInputElement).type,
        }
      : null;
  const vis =
    typeof document !== "undefined" ? document.visibilityState : "n/a";
  console.info(`[html-to-txt:save] t=${t}ms`, traceId, event, {
    ...detail,
    activeElement: el,
    visibilityState: vis,
  });
}

/** Надёжный триггер скачивания. */
function downloadBlob(blob: Blob, name: string) {
  if (DEBUG_SAVE) {
    console.info(`[html-to-txt:save] t=${Math.round(performance.now())}ms downloadBlob`, {
      name,
      size: blob.size,
    });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 2000);
}

const INVALID_PREFIX = /[<>:"/\\|?*\u0000-\u001f\n\r\u202e]/g;

/** Префикс для hjk1.txt, hjk2.txt — пусто после очистки = нельзя. */
function sanitizeNamePrefix(input: string): string {
  return input.replace(INVALID_PREFIX, "").replace(/^\.+/, "").trim();
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
};

function filePickerOptions(kind: "zip" | "txt") {
  return kind === "zip"
    ? [{ description: "ZIP", accept: { "application/zip": [".zip"] } }]
    : [{ description: "Текст", accept: { "text/plain": [".txt"] } }];
}

/**
 * Показ «Сохранить как» должен быть первым await после клика: любой await до него
 * (сборка ZIP, arrayBuffer) снимает user activation — на мобильном Chrome будет ошибка.
 */
type SavePickResult =
  | { status: "handle"; handle: FileSystemFileHandle }
  | { status: "aborted" }
  | { status: "unsupported" };

async function pickSaveFileLocation(
  suggestedName: string,
  kind: "zip" | "txt",
  traceId: string
): Promise<SavePickResult> {
  const w = window as SavePickerWindow;
  const callId = ++showSavePickerCallSeq;
  if (typeof w.showSaveFilePicker !== "function") {
    saveLog(traceId, "pickSaveFileLocation:unsupported (no API)", { callId });
    return { status: "unsupported" };
  }
  saveLog(traceId, "pickSaveFileLocation:before showSaveFilePicker", {
    callId,
    suggestedName,
    kind,
  });
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName,
      types: filePickerOptions(kind),
    });
    saveLog(traceId, "pickSaveFileLocation:after showSaveFilePicker (ok)", {
      callId,
    });
    return { status: "handle", handle };
  } catch (e) {
    const err = e as Error;
    const isAbort = err.name === "AbortError";
    const isUserAct =
      /user activation|User activation/i.test(err.message);
    const isAlreadyActive = /already active|File picker already/i.test(
      err.message
    );
    saveLog(traceId, "pickSaveFileLocation:catch", {
      callId,
      name: err.name,
      message: err.message,
      isAbort,
      isUserAct,
      isAlreadyActive,
      stack: err.stack,
    });
    if (isAbort) {
      return { status: "aborted" };
    }
    if (isUserAct) {
      return { status: "unsupported" };
    }
    if (isAlreadyActive) {
      saveLog(traceId, "pickSaveFileLocation:already_active → fallback download", {
        callId,
      });
      return { status: "unsupported" };
    }
    throw e;
  }
}

async function writeToFileHandle(
  handle: FileSystemFileHandle,
  data: Blob | ArrayBuffer
) {
  const stream = await handle.createWritable();
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  await stream.write(buf);
  await stream.close();
}

async function buildZipBlob(
  blobs: Blob[],
  innerNames: string[]
): Promise<Blob> {
  const zip = new JSZip();
  for (let i = 0; i < blobs.length; i++) {
    const buf = await blobs[i].arrayBuffer();
    zip.file(innerNames[i], buf);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

function defaultPrefixFromFirstFileName(name: string) {
  const stem = name.replace(/\.(html?|htm)$/i, "");
  return sanitizeNamePrefix(stem).slice(0, 64) || "";
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneHint, setDoneHint] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [pending, setPending] = useState<Blob[] | null>(null);
  const [namePrefix, setNamePrefix] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prefixInputRef = useRef<HTMLInputElement>(null);
  const saveInFlightRef = useRef(false);
  const saveTraceCounterRef = useRef(0);
  const titleId = useId();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    saveLog("fileInput", "change: HTML files selected", {
      fileCount: list?.length ?? 0,
    });
    setError(null);
    setDoneHint(null);
    setPending(null);
    setNameError(null);
    if (!list?.length) {
      setFiles([]);
      return;
    }
    const valid: File[] = [];
    const invalid: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const ext = f.name.toLowerCase().slice(f.name.lastIndexOf("."));
      if (ext === ".html" || ext === ".htm") {
        valid.push(f);
      } else {
        invalid.push(f.name);
      }
    }
    if (invalid.length) {
      setError(
        valid.length
          ? `Пропущены не-HTML: ${invalid.join(", ")}`
          : "Выберите файлы .html или .htm"
      );
    }
    setFiles(valid);
  };

  const closeSaveModal = () => {
    saveLog("ui", "closeSaveModal", {});
    setPending(null);
    setNameError(null);
    setSaving(false);
  };

  const openSaveModal = (blobs: Blob[], firstName: string) => {
    saveLog("ui", "openSaveModal", { blobCount: blobs.length, firstName });
    releaseHtmlFileInput(inputRef.current, "ui", "after convert, before name modal");
    setNamePrefix(defaultPrefixFromFirstFileName(firstName) || "export");
    setPending(blobs);
    setNameError(null);
    setDoneHint(null);
  };

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length) {
      setError("Сначала выберите один или несколько файлов");
      return;
    }
    setLoading(true);
    setError(null);
    setDoneHint(null);
    setProgress({ current: 0, total: files.length });
    const ok: Blob[] = [];
    const failed: string[] = [];
    let firstSuccessName = "";
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress({ current: i + 1, total: files.length });
        try {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch(`${API_URL}/api/convert`, {
            method: "POST",
            body: formData,
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            failed.push(
              `${file.name}: ${data.error || res.statusText || "ошибка"}`
            );
            continue;
          }
          const blob = await res.blob();
          ok.push(blob);
          if (!firstSuccessName) firstSuccessName = file.name;
        } catch (err) {
          failed.push(
            `${file.name}: ${err instanceof Error ? err.message : "ошибка сети"}`
          );
        }
      }
      if (ok.length) {
        openSaveModal(ok, firstSuccessName);
      }
      if (failed.length) {
        setError(
          failed.length === files.length
            ? failed.join(" · ")
            : `Часть файлов не удалось: ${failed.join(" · ")}`
        );
      }
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  useEffect(() => {
    if (pending && prefixInputRef.current) {
      saveLog("modal", "useEffect: focus+select name prefix", {
        pendingBlobs: pending.length,
      });
      prefixInputRef.current.focus();
      prefixInputRef.current.select();
    }
  }, [pending]);

  const handleConfirmSave = async () => {
    const traceId = `trace-${++saveTraceCounterRef.current}`;
    saveLog(traceId, "handleConfirmSave:enter", {
      hasPending: !!pending?.length,
      saveInFlight: saveInFlightRef.current,
    });
    if (!pending?.length) {
      saveLog(traceId, "handleConfirmSave:exit no pending", {});
      return;
    }
    if (saveInFlightRef.current) {
      saveLog(traceId, "handleConfirmSave:exit duplicate (saveInFlight)", {});
      return;
    }
    const base = sanitizeNamePrefix(namePrefix);
    if (!base) {
      saveLog(traceId, "handleConfirmSave:exit empty prefix", {});
      setNameError("Введите префикс (как hjk в hjk1.txt, hjk2.txt …).");
      return;
    }
    saveInFlightRef.current = true;
    releaseHtmlFileInput(inputRef.current, traceId, "right before save dialog");
    saveLog(traceId, "handleConfirmSave:lock set, first await next is picker", {
      base,
    });
    setNameError(null);
    setSaving(true);
    setDoneHint(null);
    const n = pending.length;
    const innerNames: string[] = Array.from(
      { length: n },
      (_, i) => `${base}${i + 1}.txt`
    );
    const zipName = `${base}.zip`;
    try {
      if (n === 1) {
        saveLog(traceId, "branch: single file → pick txt", { inner: innerNames[0] });
        // Первый await = только диалог «Сохранить как» (иначе user activation).
        const pick = await pickSaveFileLocation(innerNames[0], "txt", traceId);
        if (pick.status === "aborted") {
          saveLog(traceId, "branch: aborted after pick", {});
          return;
        }
        if (pick.status === "unsupported") {
          saveLog(traceId, "branch: fallback download (txt)", {});
          const b = await pending[0].arrayBuffer();
          downloadBlob(
            new Blob([b], { type: "text/plain; charset=utf-8" }),
            innerNames[0]
          );
          setDoneHint(
            `Скачан ${innerNames[0]} в «Загрузки», если не открылся диалог «Сохранить как».`
          );
          closeSaveModal();
          return;
        }
        saveLog(traceId, "writeToFileHandle:txt (after user picked place)", {});
        const b = await pending[0].arrayBuffer();
        await writeToFileHandle(
          pick.handle,
          new Blob([b], { type: "text/plain; charset=utf-8" })
        );
        setDoneHint(`Сохранено: ${innerNames[0]}`);
        closeSaveModal();
        return;
      }

      saveLog(traceId, "branch: zip → pick", { zipName, n });
      const pick = await pickSaveFileLocation(zipName, "zip", traceId);
      if (pick.status === "aborted") {
        saveLog(traceId, "branch: aborted after zip pick", {});
        return;
      }
      if (pick.status === "unsupported") {
        saveLog(traceId, "branch: fallback download (zip)", {});
        const zipBlob = await buildZipBlob(pending, innerNames);
        downloadBlob(zipBlob, zipName);
        setDoneHint(
          `Скачан ${zipName} в папку «Загрузки» (система не дала открыть «Сохранить как»). Внутри: ${base}1.txt … ${base}${n}.txt`
        );
        closeSaveModal();
        return;
      }
      saveLog(traceId, "buildZip+write", { n });
      const zipBlob = await buildZipBlob(pending, innerNames);
      await writeToFileHandle(pick.handle, zipBlob);
      setDoneHint(
        `Сохранён архив. Внутри: ${base}1.txt … ${base}${n}.txt (${n} файлов).`
      );
      closeSaveModal();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      saveLog(traceId, "handleConfirmSave:catch", {
        name: e.name,
        message: e.message,
        stack: e.stack,
      });
      setNameError(
        err instanceof Error ? err.message : "Не удалось записать файл"
      );
    } finally {
      saveInFlightRef.current = false;
      saveLog(traceId, "handleConfirmSave:finally (unlock)", {});
      setSaving(false);
    }
  };

  const handleReset = () => {
    setFiles([]);
    setError(null);
    setDoneHint(null);
    closeSaveModal();
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <h1 className={styles.title}>HTML → TXT</h1>
        <div className={styles.lead}>
          <p className={styles.subtitle}>
            Конвертация экспорта чата Telegram в удобный текст для чтения
          </p>
          {files.length > 1 && (
            <p className={styles.hint}>
              После конвертации укажите <strong>префикс</strong> — в ZIP попадут{" "}
              <strong>префикс1.txt, префикс2.txt…</strong> по порядку выбранных
              чатов. Система спросит, <strong>куда</strong> сохранить архив (Chrome,
              Edge) или скачает в «Загрузки».
            </p>
          )}
        </div>

        <form onSubmit={handleConvert} className={styles.form}>
          <label className={styles.label}>
            <span className={styles.labelText}>
              Файлы экспорта (.html) — можно выбрать несколько
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".html,.htm"
              multiple
              onChange={handleFileChange}
              className={styles.input}
              disabled={loading || !!pending}
            />
            {!!files.length && (
              <ul className={styles.fileList} aria-live="polite">
                {files.map((f) => (
                  <li
                    key={`${f.name}-${f.size}-${f.lastModified}`}
                    className={styles.fileListItem}
                  >
                    {f.name}
                  </li>
                ))}
              </ul>
            )}
          </label>

          {loading && progress && (
            <p className={styles.progress} aria-live="polite">
              Конвертация: {progress.current} из {progress.total}
            </p>
          )}

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          {doneHint && !error && !pending && (
            <p className={styles.success} role="status">
              {doneHint}
            </p>
          )}

          <div className={styles.actions}>
            <button
              type="submit"
              disabled={!files.length || loading || !!pending}
              className={styles.button}
            >
              {loading
                ? "Обработка…"
                : files.length > 1
                  ? `Конвертировать ${files.length} файлов`
                  : "Конвертировать и сохранить"}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className={styles.buttonSecondary}
              disabled={loading || saving}
            >
              Сбросить
            </button>
          </div>
        </form>
      </div>

      {pending && (
        <div
          className={styles.modalRoot}
          role="presentation"
          onClick={() => !saving && closeSaveModal()}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => {
              if (ev.key === "Escape" && !saving) closeSaveModal();
            }}
          >
            <h2 id={titleId} className={styles.modalTitle}>
              Сохранение
            </h2>
            <p className={styles.modalText}>
              Укажите <strong>префикс</strong> имён.{" "}
              {pending.length > 1 ? (
                <>
                  Внутри ZIP:{" "}
                  <code className={styles.code}>
                    {(() => {
                      const p = sanitizeNamePrefix(namePrefix) || "hjk";
                      return `${p}1.txt, ${p}2.txt${pending.length > 2 ? ", …" : ""}`;
                    })()}
                  </code>
                </>
              ) : (
                <>
                  Файл:{" "}
                  <code className={styles.code}>
                    {(sanitizeNamePrefix(namePrefix) || "hjk") + "1.txt"}
                  </code>
                </>
              )}
            </p>
            {pending.length > 1 && (
              <p className={styles.modalHint}>
                Всего: <strong>{pending.length}</strong> .txt в архиве. Далее —
                системный диалог: <strong>куда</strong> и <strong>как назвать</strong>{" "}
                <code className={styles.code}>.zip</code>.
              </p>
            )}
            {pending.length === 1 && (
              <p className={styles.modalHint}>
                Далее — выбор места и имени для{" "}
                <code className={styles.code}>.txt</code>.
              </p>
            )}

            <label className={styles.modalLabel} htmlFor="name-prefix">
              Префикс (например hjk → hjk1.txt, hjk2.txt…)
            </label>
            <input
              id="name-prefix"
              ref={prefixInputRef}
              type="text"
              className={styles.textInput}
              value={namePrefix}
              onChange={(e) => {
                setNamePrefix(e.target.value);
                setNameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleConfirmSave();
                }
              }}
              disabled={saving}
              autoComplete="off"
              placeholder="hjk"
            />
            {nameError && (
              <p className={styles.error} role="alert">
                {nameError}
              </p>
            )}

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.button}
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleConfirmSave();
                }}
              >
                {saving
                  ? "Сохранение…"
                  : pending.length > 1
                    ? "Дальше: место и имя ZIP"
                    : "Дальше: место и имя файла"}
              </button>
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={closeSaveModal}
                disabled={saving}
              >
                Отмена
              </button>
            </div>
            <p className={styles.modalFootnote}>
              В Chrome и Edge сначала появляется наше поле, затем — системный диалог
              «Сохранить как». В других браузерах файл скачается в «Загрузки» с
              выбранным именем.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
