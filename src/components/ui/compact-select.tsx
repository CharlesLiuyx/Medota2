"use client";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";

/** Shares the filter-menu surface with multi-select filters; no OS select popup. */
export function CompactSelect({
  name,
  label,
  value,
  children,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  children: ReactNode;
  onChange: (data: FormData, composing: boolean) => void;
}) {
  const options = Children.toArray(children).flatMap((child) =>
    isValidElement<{ value: string; children: ReactNode }>(child)
      ? [{ value: child.props.value, label: child.props.children }]
      : [],
  );
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const typeahead = useRef({ text: "", time: 0 });
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const focusOption = (index: number) => {
    const option =
      details.current?.querySelectorAll<HTMLElement>('[role="option"]')[index];
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: "nearest" });
  };
  const close = (restoreFocus = false) => {
    if (details.current) details.current.open = false;
    if (restoreFocus) details.current?.querySelector("summary")?.focus();
  };
  const choose = (next: string) => {
    if (!input.current?.form) return;
    const data = new FormData(input.current.form);
    data.set(name, next);
    onChange(data, false);
    close(true);
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !details.current?.contains(event.target)
      ) {
        if (details.current) details.current.open = false;
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const keys = (event: KeyboardEvent, index: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") close();
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!details.current?.open) {
        if (details.current) details.current.open = true;
      } else
        focusOption(
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  options.length) %
                options.length,
        );
    } else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const now = event.timeStamp;
      typeahead.current = {
        text:
          (now - typeahead.current.time < 700 ? typeahead.current.text : "") +
          event.key.toLocaleLowerCase(),
        time: now,
      };
      const match = options.findIndex((option) =>
        String(option.label)
          .toLocaleLowerCase()
          .startsWith(typeahead.current.text),
      );
      if (match >= 0 && details.current?.open) {
        event.preventDefault();
        focusOption(match);
      }
    }
  };
  return (
    <details
      ref={details}
      data-filter-menu
      className="compact-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onToggle={(event) => {
        const current = event.currentTarget;
        setOpen(current.open);
        if (current.open) {
          document
            .querySelectorAll<HTMLDetailsElement>(
              "details[data-filter-menu][open]",
            )
            .forEach((other) => {
              if (other !== current) other.open = false;
            });
          const popup = current.querySelector<HTMLElement>("[role=listbox]")!;
          popup.style.translate = "0px";
          const bounds = popup.getBoundingClientRect();
          popup.style.translate = `${Math.min(0, window.innerWidth - 8 - bounds.right)}px`;
          focusOption(selected);
        }
      }}
    >
      <input ref={input} type="hidden" name={name} value={value} />
      <summary
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        className="compact-menu-trigger"
        onKeyDown={(event) => keys(event, selected)}
      >
        <span className="text-[var(--text-muted)]">{label}</span>
        <span className="max-w-28 truncate">{options[selected]?.label}</span>
        <span aria-hidden="true" className="compact-menu-chevron">
          ⌄
        </span>
      </summary>
      <div
        id={id}
        role="listbox"
        aria-label={label}
        className="compact-menu-popup"
      >
        {options.map((option, index) => (
          <div
            key={option.value}
            role="option"
            aria-selected={option.value === value}
            tabIndex={-1}
            className="compact-menu-option"
            onClick={() => choose(option.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                choose(option.value);
              } else keys(event, index);
            }}
          >
            <span className="w-3 shrink-0" aria-hidden="true">
              {option.value === value ? "✓" : ""}
            </span>
            {option.label}
          </div>
        ))}
      </div>
    </details>
  );
}
