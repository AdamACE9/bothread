import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Scroll reveal for the home page. Like Reveal, but renders any element
 *  (so it can be an <li> inside a list) and staggers with `i`. */
export default function Rv({
  as = "div",
  i = 0,
  className = "",
  children,
  id,
}: {
  as?: keyof JSX.IntrinsicElements;
  i?: number;
  className?: string;
  children?: ReactNode;
  id?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return createElement(
    as,
    { ref, id, className: `rv ${seen ? "is-in" : ""} ${className}`, style: { "--i": i } as CSSProperties },
    children
  );
}
