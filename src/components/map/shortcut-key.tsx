export function ShortcutKey({
  value,
  hidden = false,
}: {
  value: string;
  hidden?: boolean;
}) {
  return (
    <kbd
      aria-hidden="true"
      className={`${hidden ? "invisible" : ""} shrink-0 inline-flex h-[18px] min-w-5 items-center justify-center rounded-[4px] border border-white/25 bg-[#1d2831] px-1 font-mono text-[10px] font-medium leading-none text-[#c5d0d9] shadow-[0_2px_0_#080d12,inset_0_1px_0_#ffffff14]`}
    >
      {value}
    </kbd>
  );
}
