import type { ButtonHTMLAttributes, ReactNode } from "react";
import { buttonClass } from "./buttonStyles";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "outline";
}) {
  return (
    <button
      type="button"
      className={buttonClass(variant, className)}
      {...props}
    >
      {children}
    </button>
  );
}
