import { redirect } from "next/navigation";

/** Legacy route - dashboard was removed from the main workflow. */
export default function DashboardRedirectPage() {
  redirect("/projects");
}
