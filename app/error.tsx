"use client";

import { useEffect } from "react";
import Link from "next/link";
import { pageContainer } from "@/components/common/production-ui";
import { PublicShell } from "@/components/layout/public-shell";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log error to console for debugging in development
    // In production, you would typically send this to an error reporting service
    console.error("Global error boundary caught:", error);
  }, [error]);

  return (
    <PublicShell>
      <div className={pageContainer}>
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-3xl font-bold text-white sm:text-4xl">
              Something went wrong
            </h1>
            <p className="text-lg text-slate-300">
              An unexpected error occurred while loading this page. We apologize for the inconvenience.
            </p>
          </div>

          <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-6">
            <h2 className="text-lg font-semibold text-rose-100 mb-3">
              Error details
            </h2>
            <p className="text-sm text-slate-300">
              An internal application error has occurred. The technical team has been notified 
              and is working to resolve the issue.
            </p>
            {process.env.NODE_ENV === "development" && (
              <details className="mt-4 text-left">
                <summary className="text-sm text-slate-400 cursor-pointer hover:text-slate-300">
                  Developer details
                </summary>
                <pre className="mt-2 text-xs text-slate-400 bg-slate-900/50 p-3 rounded overflow-auto">
                  {error.message}
                </pre>
              </details>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">What you can do</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                <h3 className="font-semibold text-white mb-2">Try again</h3>
                <p className="text-sm text-slate-300 mb-4">
                  This might be a temporary issue. Click below to reload the page and try again.
                </p>
                <button
                  onClick={reset}
                  className="w-full inline-flex h-10 items-center justify-center rounded-lg border border-cyan-300/50 bg-cyan-300 px-6 text-sm font-medium text-slate-950 transition hover:bg-cyan-200"
                >
                  Try again
                </button>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                <h3 className="font-semibold text-white mb-2">Check system status</h3>
                <p className="text-sm text-slate-300 mb-4">
                  View the current status of EarnProof services to see if there are any known issues.
                </p>
                <Link
                  href="/status"
                  className="w-full inline-flex h-10 items-center justify-center rounded-lg border border-white/15 px-6 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  System status
                </Link>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Alternative actions</h2>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-white/15 px-6 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Go to homepage
              </Link>
              <Link
                href="/verify"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-white/15 px-6 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Verify a proof
              </Link>
              <Link
                href="/proofs"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-white/15 px-6 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Create a proof
              </Link>
            </div>
          </div>

          <div className="text-sm text-slate-400">
            <p>
              If this problem persists, please contact our support team through the{" "}
              <Link href="/accessibility" className="text-cyan-300 hover:text-cyan-200 underline">
                accessibility page
              </Link>{" "}
              for assistance.
            </p>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
