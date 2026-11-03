import { useLayoutEffect, useRef, useState, type RefObject } from "react";

type Widths = [number, number, number];
const rail = 44;
const handles = 9;
const initialMinimums: Widths = [170, 400, 320];

/** Three adjacent panes share the available width; collapsed panes retain a restore rail. */
export function usePaneLayout(root: RefObject<HTMLDivElement | null>) {
  const minimums = useRef<Widths>(initialMinimums);
  const [widths, setWidths] = useState<Widths>([235, 590, 678]);
  const widthsRef = useRef(widths);
  const remembered = useRef<Widths>([235, 590, 678]);
  const available = useRef(window.innerWidth - handles);
  const drag = useRef<{
    boundary: number;
    widths: Widths;
    stopped: boolean;
  } | null>(null);
  const pending = useRef<{
    pane: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  function cancelPending() {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  }
  function commit(next: Widths) {
    widthsRef.current = next;
    setWidths(next);
  }
  function fit(next: Widths, protect = -1): Widths {
    const mins = minimums.current;
    next = next.map((w, i) =>
      w === rail ? rail : Math.max(w, mins[i]!),
    ) as Widths;
    let excess = next.reduce((a, b) => a + b, 0) - available.current;
    for (const i of [2, 1, 0]) {
      const take = Math.min(
        Math.max(0, next[i]! - mins[i]!),
        Math.max(0, excess),
      );
      next[i]! -= take;
      excess -= take;
    }
    for (const i of [2, 0, 1].filter((i) => i !== protect)) {
      if (excess <= 0) break;
      if (next[i] === rail) continue;
      remembered.current[i] = next[i]!;
      excess -= next[i]! - rail;
      next[i] = rail;
    }
    const recipient = [2, 1, 0].find((i) => next[i] !== rail) ?? 2;
    next[recipient]! -= excess;
    return next;
  }
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    function measure() {
      if (!element || window.innerWidth <= 800) return;
      available.current = element.clientWidth - handles;
      const mins: Widths = [...initialMinimums];
      const brand = element.querySelector<HTMLElement>(".brand");
      if (brand && brand.offsetWidth) {
        const children = [...brand.children] as HTMLElement[];
        mins[0] = Math.max(
          mins[0],
          Math.ceil(
            children
              .slice(0, 2)
              .reduce((n, child) => n + child.offsetWidth, 0) + 60,
          ),
        );
      }
      for (const tools of element.querySelectorAll<HTMLElement>(
        ".composer-tools",
      )) {
        if (!tools.offsetWidth) continue;
        const pane = tools.closest(".main-chat") ? 1 : 2;
        const content = [...tools.children].reduce(
          (n, child) => n + (child as HTMLElement).offsetWidth,
          0,
        );
        mins[pane] = Math.max(
          mins[pane]!,
          Math.ceil(
            content +
              parseFloat(getComputedStyle(tools).columnGap || "0") +
              [
                tools.closest(".composer"),
                tools.closest(".composer-area"),
              ].reduce((sum, item) => {
                if (!item) return sum;
                const style = getComputedStyle(item);
                return (
                  sum +
                  parseFloat(style.paddingLeft) +
                  parseFloat(style.paddingRight) +
                  parseFloat(style.borderLeftWidth) +
                  parseFloat(style.borderRightWidth)
                );
              }, 0),
          ),
        );
      }
      minimums.current = mins;
      commit(fit([...widthsRef.current]));
    }
    const observer = new ResizeObserver(measure);
    function observe() {
      observer.disconnect();
      observer.observe(element!);
      element!
        .querySelectorAll(".brand, .composer-tools")
        .forEach((item) => observer.observe(item));
      measure();
    }
    const mutations = new MutationObserver(observe);
    mutations.observe(element, { childList: true, subtree: true });
    observe();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      cancelPending();
    };
  }, [root]);
  function resize(boundary: number, proposed: number) {
    const start = drag.current?.widths ?? widthsRef.current;
    if (
      drag.current?.stopped ||
      start[boundary] === rail ||
      start[boundary + 1] === rail
    )
      return;
    const total = start[boundary]! + start[boundary + 1]!;
    const minLeft = minimums.current[boundary]!;
    const minRight = minimums.current[boundary + 1]!;
    const left = Math.max(minLeft, Math.min(total - minRight, proposed));
    const next: Widths = [...widthsRef.current];
    next[boundary] = left;
    next[boundary + 1] = total - left;
    commit(next);
    const pane =
      proposed < minLeft - 12
        ? boundary
        : proposed > total - minRight + 12
          ? boundary + 1
          : -1;
    if (pane === pending.current?.pane) return;
    cancelPending();
    if (pane < 0 || !drag.current) return;
    pending.current = {
      pane,
      timer: setTimeout(() => {
        const next: Widths = [...widthsRef.current];
        remembered.current[pane] = next[pane]!;
        const neighbor = pane === boundary ? boundary + 1 : boundary;
        next[neighbor]! += next[pane]! - rail;
        next[pane] = rail;
        if (drag.current) drag.current.stopped = true;
        pending.current = null;
        commit(next);
      }, 180),
    };
  }
  return {
    widths,
    collapsed: widths.map((w) => w === rail),
    restore(pane: number) {
      if (widthsRef.current[pane] !== rail) return;
      const next: Widths = [...widthsRef.current];
      next[pane] = Math.max(minimums.current[pane]!, remembered.current[pane]!);
      commit(fit(next, pane));
    },
    handle(boundary: number) {
      const total = widths[boundary]! + widths[boundary + 1]!;
      return {
        value: widths[boundary]!,
        min: widths[boundary] === rail ? rail : minimums.current[boundary]!,
        max: Math.max(
          widths[boundary]!,
          total - minimums.current[boundary + 1]!,
        ),
        onChange: (value: number) => resize(boundary, value),
        onDragStart: () => {
          cancelPending();
          drag.current = {
            boundary,
            widths: [...widthsRef.current],
            stopped: false,
          };
        },
        onDragEnd: () => {
          cancelPending();
          drag.current = null;
        },
      };
    },
  };
}
