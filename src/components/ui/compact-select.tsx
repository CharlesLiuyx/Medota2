"use client";
import { ChevronDown } from "lucide-react";
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
  name = "selection",
  label,
  value,
  defaultValue,
  children,
  onChange,
  onValueChange,
  disabled = false,
  hideLabel = false,
  className = "",
}: {
  name?: string;
  label: string;
  value?: string | number;
  defaultValue?: string | number;
  children: ReactNode;
  onChange?: (data: FormData, composing: boolean) => void;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  className?: string;
}) {
  const options = Children.toArray(children).flatMap((child) =>
    isValidElement<{
      value: string | number;
      children: ReactNode;
      disabled?: boolean;
    }>(child)
      ? [
          {
            value: String(child.props.value),
            label: child.props.children,
            disabled: child.props.disabled,
          },
        ]
      : [],
  );
  const [formValue, setFormValue] = useState(
    defaultValue ?? options[0]?.value ?? "",
  );
  const currentValue = value ?? formValue;
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const typeahead = useRef({ text: "", time: 0 });
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === String(currentValue)),
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
    if (disabled || options.find((o) => o.value === next)?.disabled) return;
    if (value === undefined) setFormValue(next);
    onValueChange?.(next);
    if (onChange && input.current?.form) {
      const data = new FormData(input.current.form);
      data.set(name, next);
      onChange(data, false);
    }
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
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") close();
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!details.current?.open) {
        if (details.current) details.current.open = true;
      } else {
        const direction =
          event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
        let next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : (index + direction + options.length) % options.length;
        for (let n = 0; n < options.length && options[next]?.disabled; n++)
          next = (next + direction + options.length) % options.length;
        if (!options[next]?.disabled) focusOption(next);
      }
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
      const match = options.findIndex(
        (option) =>
          !option.disabled &&
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
      className={`compact-menu ${className}`}
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
          focusOption(
            options[selected]?.disabled
              ? options.findIndex((o) => !o.disabled)
              : selected,
          );
        }
      }}
    >
      <input ref={input} type="hidden" name={name} value={currentValue} />
      <summary
        role="combobox"
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={(e) => {
          if (disabled) e.preventDefault();
        }}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        className="compact-menu-trigger"
        onKeyDown={(event) => keys(event, selected)}
      >
        {!hideLabel && (
          <span className="text-[var(--text-muted)]">{label}</span>
        )}
        <span className="min-w-0 flex-1 truncate">
          {options[selected]?.label}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="compact-menu-chevron"
          strokeWidth={2.5}
        />
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
            aria-selected={option.value === String(currentValue)}
            aria-disabled={option.disabled || undefined}
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
              {option.value === String(currentValue) ? "✓" : ""}
            </span>
            {option.label}
          </div>
        ))}
      </div>
    </details>
  );
}
