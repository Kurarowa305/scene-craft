import {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

export function Icon({
  name,
}: {
  name:
    | "plus"
    | "chat"
    | "leaf"
    | "settings"
    | "folder"
    | "history"
    | "shield"
    | "image"
    | "attach";
}) {
  const paths = {
    plus: "M8 2v12M2 8h12",
    chat: "M2 3h12v9H6l-4 3z",
    leaf: "M3 13C0 5 6 1 14 2c0 8-3 13-11 11ZM3 13l8-8",
    settings:
      "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 1v2m0 10v2M1 8h2m10 0h2M3 3l1 1m8 8 1 1M3 13l1-1m8-8 1-1",
    folder: "M1 4h5l2 2h7v8H1z",
    history: "M3 4a6 6 0 1 1-1 5M1 1v4h4M8 4v4l3 2",
    shield: "M8 1 14 4v5c0 3-6 6-6 6S2 12 2 9V4zM5 8l2 2 4-4",
    image: "M1 2h14v12H1zM2 11l4-4 3 3 2-2 4 4M11 5h.1",
    attach: "m5 8 5-5a3 3 0 0 1 4 4l-7 7a4 4 0 0 1-6-6l7-7m-4 9 7-7",
  };
  return (
    <span className="icon" aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path d={paths[name]} />
      </svg>
    </span>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      <div className="row between">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon"
          aria-label="閉じる"
          onClick={close}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ResizeHandle({
  label,
  value,
  onChange,
  min,
  max,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const start = useRef({ x: 0, value: 0 });
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={Math.round(max)}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        onChange(
          e.key === "Home"
            ? min
            : e.key === "End"
              ? max
              : Math.max(
                  min,
                  Math.min(max, value + (e.key === "ArrowRight" ? 20 : -20)),
                ),
        );
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        start.current = { x: e.clientX, value };
        onDragStart?.();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          onChange(start.current.value + e.clientX - start.current.x);
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        onDragEnd?.();
      }}
      onLostPointerCapture={() => onDragEnd?.()}
      onPointerCancel={() => onDragEnd?.()}
    />
  );
}
export function Unavailable({ children }: { children: ReactNode }) {
  return (
    <p className="note" role="status">
      {children}は未実装です。現在は画面の外観のみ確認できます。
    </p>
  );
}
export function shellStyle(sidebar: number, main: number): CSSProperties {
  return {
    "--sidebar": `${sidebar}px`,
    "--main": `${main}px`,
  } as CSSProperties;
}

/** Render above adjacent panes and dismiss on outside input without stealing editor focus. */
export function Popup({
  label,
  icon,
  children,
  disabled,
  className = "",
}: {
  label: string;
  icon: ReactNode;
  children: (close: () => void) => ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxWidth: 240 });
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    function place() {
      if (!anchor.current || !panel.current) return;
      const button = anchor.current.getBoundingClientRect();
      const region = anchor.current
        .closest(".inspector, .main-chat, .sidebar")
        ?.getBoundingClientRect();
      const leftEdge = Math.max(8, (region?.left ?? 0) + 8);
      const rightEdge = Math.min(
        window.innerWidth - 8,
        (region?.right ?? window.innerWidth) - 8,
      );
      const width = Math.min(panel.current.offsetWidth, rightEdge - leftEdge);
      const height = panel.current.offsetHeight;
      setPosition({
        left: Math.max(leftEdge, Math.min(button.left, rightEdge - width)),
        top: Math.max(8, button.top - height - 8),
        maxWidth: rightEdge - leftEdge,
      });
    }
    function dismiss(event: Event) {
      if (
        event.target instanceof Node &&
        !anchor.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    place();
    panel.current
      .querySelector<HTMLElement>(
        "button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex='0']",
      )
      ?.focus();
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className={`popup-anchor ${className}`} ref={anchor}>
      <button
        type="button"
        className="icon popup-trigger"
        ref={trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
      </button>
      {open &&
        createPortal(
          <div
            className="floating-menu"
            role="menu"
            aria-label={label}
            ref={panel}
            style={position}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}
