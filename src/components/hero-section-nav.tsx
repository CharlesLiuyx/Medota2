"use client";
import { useEffect, useRef, useState } from "react";

const sections = [
  ["abilities", "技能"],
  ["talents", "天赋树"],
  ["facets", "命石"],
  ["stats", "属性"],
  ["lore", "英雄故事"],
] as const;

export function HeroSectionNav() {
  const nav = useRef<HTMLElement>(null);
  const chosen = useRef("abilities");
  const clicked = useRef<string | null>(null);
  const [active, setActive] = useState("abilities");
  useEffect(() => {
    const nodes = sections.map(([id]) => document.getElementById(id));
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = (nav.current?.getBoundingClientRect().bottom ?? 76) + 20;
      const visible = nodes.map((node, index) => ({
        id: sections[index][0],
        top: node?.getBoundingClientRect().top ?? Infinity,
      }));
      const passed = visible.filter((section) => section.top <= line);
      const closest = Math.max(...passed.map((section) => section.top));
      // Adjacent desktop columns share a heading position; retain the clicked tab.
      const row = passed.filter(
        (section) => Math.abs(section.top - closest) < 2,
      );
      let next =
        row.find((section) => section.id === chosen.current)?.id ??
        row[0]?.id ??
        "abilities";
      if (
        window.scrollY > 0 &&
        window.scrollY + window.innerHeight >=
          document.documentElement.scrollHeight - 2
      ) {
        // A short final section cannot align with the top; honor an explicit
        // click while its heading is visible, until the reader scrolls again.
        const target = visible.find(
          (section) => section.id === clicked.current,
        );
        next =
          target && target.top >= line && target.top < window.innerHeight
            ? target.id
            : "lore";
      } else clicked.current = null;
      chosen.current = next;
      setActive(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const hash = () => {
      const id = window.location.hash.slice(1);
      if (sections.some(([section]) => section === id)) {
        chosen.current = id;
        clicked.current = id;
      }
      schedule();
    };
    const manualScroll = () => {
      clicked.current = null;
      schedule();
    };
    const keyboardScroll = (event: KeyboardEvent) => {
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "PageDown",
          "PageUp",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        manualScroll();
    };
    window.addEventListener("wheel", manualScroll, { passive: true });
    window.addEventListener("touchmove", manualScroll, { passive: true });
    window.addEventListener("keydown", keyboardScroll);
    const observer = new ResizeObserver(schedule);
    if (nav.current?.parentElement) observer.observe(nav.current.parentElement);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", hash);
    hash();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("wheel", manualScroll);
      window.removeEventListener("touchmove", manualScroll);
      window.removeEventListener("keydown", keyboardScroll);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  return (
    <nav ref={nav} aria-label="英雄详情" className="game-tabs">
      {sections.map(([id, title]) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={active === id ? "location" : undefined}
          onClick={() => {
            chosen.current = id;
            clicked.current = id;
            setActive(id);
          }}
        >
          {title}
        </a>
      ))}
    </nav>
  );
}
