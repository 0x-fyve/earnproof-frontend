"use client";

import { useState } from "react";
import { useAuthSession } from "@/lib/auth";
import { exportSecurityPosture } from "@/lib/api/security-posture";

interface SecurityExportButtonProps {
  organizationId: string;
}

/**
 * Button to export security posture as JSON.
 */
export function SecurityExportButton({ organizationId }: SecurityExportButtonProps) {
  const { token } = useAuthSession();
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    if (!token || loading) return;

    setLoading(true);

    try {
      const controller = new AbortController();
      const data = await exportSecurityPosture(
        token,
        organizationId,
        controller.signal
      );

      // Create blob and download
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `security-posture-${new Date().toISOString().split("T")[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-md bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>
      {loading ? "Exporting..." : "Export"}
    </button>
  );
}
