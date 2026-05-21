"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";

export function BodyClassSync() {
  const { state } = useStore();
  const pathname = usePathname() || "/";

  useEffect(() => {
    const b = document.body;
    b.classList.toggle("is-public", pathname.startsWith("/public"));
    b.classList.toggle("is-private", pathname.startsWith("/private"));
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle(
      "match-kata",
      state.match.discipline === "kata"
    );
  }, [state.match.discipline]);

  return null;
}
