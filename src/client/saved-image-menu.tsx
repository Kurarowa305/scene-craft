import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SavedState } from "../shared/files";
import { read } from "./api";

export function SavedImageSubmenu({
  workId,
  onSelect,
  onDone,
}: {
  workId: string;
  onSelect: (file: File) => Promise<void>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [states, setStates] = useState<SavedState[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setStates(null);
    setError("");
    read<{ states: SavedState[] }>(`/api/works/${workId}/states`)
      .then((result) => {
        if (active) setStates(result.states);
      })
      .catch(() => {
        if (active) setError("保存済み画像を取得できません。");
      });
    return () => {
      active = false;
    };
  }, [open, workId]);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!trigger.current || !panel.current) return;
      const parent = trigger.current
        .closest(".floating-menu")!
        .getBoundingClientRect();
      const button = trigger.current.getBoundingClientRect();
      const width = Math.min(260, window.innerWidth - 16);
      const right = parent.right + 6;
      setPosition({
        left:
          right + width <= window.innerWidth - 8
            ? right
            : Math.max(8, parent.left - width - 6),
        top: Math.max(
          8,
          Math.min(
            button.top,
            window.innerHeight - panel.current.offsetHeight - 8,
          ),
        ),
      });
    }
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open]);
  useEffect(() => {
    if (open && states)
      panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open, states]);
  const files =
    states?.flatMap((state) =>
      state.files
        .filter((file) => /\.(png|jpe?g|webp)$/i.test(file.source.relativePath))
        .map((file) => ({ state, file })),
    ) ?? [];
  return (
    <div className="submenu-anchor">
      <button
        ref={trigger}
        type="button"
        role="menuitem"
        className="submenu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!workId || busy}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        保存済み成果物<span aria-hidden="true">›</span>
      </button>
      {open && (
        <div
          ref={panel}
          className="artifact-submenu"
          role="menu"
          aria-label="添付する保存済み画像"
          style={position}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "ArrowLeft") {
              event.stopPropagation();
              event.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          {!states && !error && <p role="status">画像を読み込み中…</p>}
          {states && !files.length && (
            <p>添付できる保存済み画像はありません。</p>
          )}
          {error && <p role="alert">{error}</p>}
          {files.map(({ state, file }) => (
            <button
              key={`${state.id}-${file.id}`}
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const response = await fetch(
                    `/api/states/${state.id}/files/${file.id}`,
                    { credentials: "same-origin" },
                  );
                  if (!response.ok) throw new Error("画像を取得できません。");
                  const name = file.source.relativePath.split("/").at(-1)!;
                  const type = /\.png$/i.test(name)
                    ? "image/png"
                    : /\.webp$/i.test(name)
                      ? "image/webp"
                      : "image/jpeg";
                  await onSelect(
                    new File([await response.blob()], name, { type }),
                  );
                  onDone();
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <img
                src={`/api/states/${state.id}/files/${file.id}?inline=1`}
                alt=""
              />
              <span>{file.source.relativePath.split("/").at(-1)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
