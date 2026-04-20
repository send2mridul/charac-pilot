"use client";

import { useEffect, useState } from "react";

/** True after mount — use to avoid hydration mismatches from browser extensions (e.g. Dark Reader) mutating SVG/DOM. */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}
