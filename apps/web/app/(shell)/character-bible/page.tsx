import { redirect } from "next/navigation";

/** Old URL — Character Bible is now the Characters page. */
export default function CharacterBibleRedirectPage() {
  redirect("/characters");
}
