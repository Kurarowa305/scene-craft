import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../shared/contracts";
import { write } from "./api";
import { Popup } from "./ui";

export function ChatEntry({
  chat,
  title,
  selected,
  status,
  disabled,
  onSelect,
  onRename,
}: {
  chat: Conversation;
  title: string;
  selected: boolean;
  status: string;
  disabled: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  async function save() {
    if (saving || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await write(`/api/conversations/${chat.id}/name`, { name });
      onRename(name);
      setEditing(false);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className={`chat-entry ${selected ? "active" : ""}`}>
      <div className="chat-entry-row">
        {editing ? (
          <input
            ref={input}
            className="chat-name-input"
            aria-label="チャット名を編集"
            maxLength={100}
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
              if (event.key === "Escape") {
                setEditing(false);
                setError("");
              }
            }}
          />
        ) : (
          <button
            className={`chat-link ${selected ? "active" : ""}`}
            aria-label={title}
            title={title}
            disabled={disabled}
            onClick={onSelect}
          >
            <span className="chat-title">{title}</span>
            <span
              className={`state-icon ${status}`}
              aria-label={
                status === "running"
                  ? "処理中"
                  : status === "attention"
                    ? "確認が必要"
                    : status === "stopped"
                      ? "停止中"
                      : "通常"
              }
            >
              {status === "attention" ? "!" : status === "stopped" ? "Ⅱ" : ""}
            </span>
          </button>
        )}
        {!editing && (
          <Popup
            label={`${title}のメニュー`}
            className="chat-menu"
            disabled={disabled}
            icon={<span aria-hidden="true">⋯</span>}
          >
            {(close) => (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  setName(title);
                  setEditing(true);
                }}
              >
                編集
              </button>
            )}
          </Popup>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
