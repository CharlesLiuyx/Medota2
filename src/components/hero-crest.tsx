export function HeroCrest({
  name,
  attribute,
  large = false,
}: {
  name: string;
  attribute: string;
  large?: boolean;
}) {
  const initials = name
    .split(/[\s-]+/u)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const palette =
    attribute === "strength"
      ? "from-[#852e28] via-[#3b1c1a] to-[#171313] text-[#f3a090]"
      : attribute === "agility"
        ? "from-[#316b4a] via-[#193526] to-[#111713] text-[#8be0ae]"
        : attribute === "intelligence"
          ? "from-[#315b7c] via-[#192d3e] to-[#11151a] text-[#93c9ec]"
          : "from-[#79662b] via-[#40371c] to-[#171611] text-[#ead081]";

  return (
    <div
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-white/12 bg-gradient-to-br ${palette} ${large ? "size-28 sm:size-36" : "size-16"}`}
      aria-label="英雄图片占位"
    >
      <span
        className={`${large ? "text-3xl" : "text-xl"} font-black tracking-[-0.08em] opacity-85`}
      >
        {initials}
      </span>
      <span className="absolute inset-x-2 bottom-2 h-px bg-current opacity-35" />
      <span className="absolute -right-5 -top-5 size-14 rotate-45 border border-current opacity-15" />
    </div>
  );
}
