import { useState } from "react";
export function ImagePreview({
  title,
  url,
  imageUrl,
  subtitle,
}: {
  title: string;
  url: string;
  imageUrl?: string;
  subtitle?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  return (
    <div className="preview-wrap">
      <div className="panel-top">
        <div>
          <h2>{title}</h2>
          <span className="muted">{subtitle}</span>
        </div>
      </div>
      {imageUrl && !failed ? (
        <div
          className="preview-canvas"
          onWheel={(e) =>
            setZoom((z) =>
              Math.max(0.2, Math.min(5, z * (e.deltaY < 0 ? 1.1 : 0.9))),
            )
          }
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              setPan((p) => ({ x: p.x + e.movementX, y: p.y + e.movementY }));
          }}
          onPointerUp={(e) =>
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        >
          <img
            src={imageUrl}
            onError={() => setFailed(true)}
            draggable={false}
            alt={`${title}のプレビュー`}
            style={{
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
          />
        </div>
      ) : (
        <div className="empty">
          <p>
            {failed
              ? "画像を取得できません。実体の欠落・破損や接続を確認してください。"
              : "このファイルの画像プレビューは未取得です。"}
          </p>
          <p>本文と出典の記録は残っています。</p>
        </div>
      )}
      <div className="preview-toolbar">
        <a href={url}>ファイルを開く</a>
        <div className="row">
          <button
            aria-label="縮小"
            onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="拡大"
            onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
          >
            ＋
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            フィット
          </button>
        </div>
      </div>
    </div>
  );
}
