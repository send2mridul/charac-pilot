import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";
import Image from "next/image";

export const metadata = { title: "Sign in — CastWeave" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const callbackUrl = params.callbackUrl || "/projects";

  if (session?.user) redirect(callbackUrl);

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background layer — blurred product screenshot */}
      <Image
        src="/signin-bg.png"
        alt=""
        fill
        priority
        className="object-cover scale-110 blur-xl brightness-[0.35]"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-br from-black/40 via-black/20 to-black/50" />

      {/* Foreground card */}
      <div className="relative z-10 w-full max-w-[400px] mx-auto px-5">
        <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl shadow-2xl px-8 py-10">
          <div className="text-center mb-8">
            <div className="size-14 rounded-xl bg-white text-black flex items-center justify-center text-2xl font-bold mx-auto mb-5 shadow-lg">
              C
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Sign in to CastWeave
            </h1>
            <p className="text-[14px] text-white/60 mt-2 leading-relaxed">
              Import video, build your cast, and generate dubbed audio.
            </p>
          </div>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: callbackUrl });
            }}
          >
            <button
              type="submit"
              className="w-full h-12 rounded-lg bg-white text-[14px] font-semibold text-black flex items-center justify-center gap-3 hover:bg-white/90 transition-colors shadow-md"
            >
              <svg className="size-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>
          </form>

          <p className="text-[12px] text-white/40 text-center mt-6 leading-relaxed">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
