import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function SignIn() {
  // Already signed in -> go to the app.
  const session = await auth();
  if (session) redirect("/");

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0a1018]">
      <div className="w-full max-w-sm rounded-2xl border border-[#1c2838] bg-[#0d1622] p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#1e3a5f] text-xl font-bold text-white">
          N
        </div>
        <h1 className="text-xl font-semibold text-[#e6eefb]">IntelBot</h1>
        <p className="mt-1 text-sm text-[#6b7d94]">Noonan · private executive assistant</p>

        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: "/" });
          }}
          className="mt-6"
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2b6fb3] px-4 py-3 text-sm font-medium text-white hover:bg-[#357ec7] transition-colors"
          >
            <span className="text-base">⊞</span> Sign in with Microsoft
          </button>
        </form>

        <p className="mt-4 text-xs text-[#5b6b80]">
          Access is restricted to authorised Noonan accounts.
        </p>
      </div>
    </div>
  );
}
