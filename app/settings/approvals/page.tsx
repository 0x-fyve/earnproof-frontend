/**
 * Approvals Settings Page
 * 
 * Displays the privileged operation approval queue for organization admins.
 * Features:
 * - Consolidated queue for role, export, recovery, key, and governance operations
 * - Typed filters and detailed review interface
 * - Approval and rejection workflows with conflict detection
 * - Age and expiry indicators
 * - Authorization enforcement (admin/owner only)
 */

"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApprovalQueue } from "@/components/approvals/approval-queue";
import { ApprovalDetail } from "@/components/approvals/approval-detail";
import { ApprovalOperation } from "@/lib/validation/operations";

/**
 * Main approvals settings page component
 */
export default function ApprovalsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  // Detail view state
  const [selectedOperation, setSelectedOperation] = useState<ApprovalOperation | null>(null);

  // Authorization check
  if (status === "loading") {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-gray-200 rounded animate-pulse w-1/3" />
        <div className="h-12 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    router.push("/auth/signin");
    return null;
  }

  // Check if user has approval permissions
  const userRole = session.user?.role as "OWNER" | "ADMIN" | "MEMBER" | null | undefined;
  const canAccessApprovals = userRole === "OWNER" || userRole === "ADMIN";

  if (!canAccessApprovals) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <h1 className="text-xl font-semibold text-red-900">Access Denied</h1>
        <p className="text-red-700 mt-2">
          Only organization owners and admins can view and manage approval operations.
        </p>
      </div>
    );
  }

  const organizationId = (session.user as any)?.organizationId;
  const userId = session.user?.id;
  const token = (session as any)?.token?.accessToken;

  if (!organizationId || !userId || !token) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <h1 className="text-xl font-semibold text-yellow-900">Configuration Error</h1>
        <p className="text-yellow-700 mt-2">
          Missing required session information. Please sign in again.
        </p>
      </div>
    );
  }

  const handleActionComplete = () => {
    // Clear selection after action
    setSelectedOperation(null);
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Operation Approvals</h1>
        <p className="text-gray-600 mt-2">
          Review and manage pending role changes, exports, recoveries, key rotations, and governance
          operations.
        </p>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-blue-400"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium text-blue-800">
              All operations must be approved before taking effect. You cannot approve your own
              requests. Operations expire if not acted upon within the specified time window.
            </p>
          </div>
        </div>
      </div>

      {/* Main content: Queue and Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Queue list (takes 2/3 on large screens) */}
        <div className="lg:col-span-2">
          <ApprovalQueue
            userId={userId}
            organizationId={organizationId}
            token={token}
            userRole={userRole as any}
            onSelectOperation={setSelectedOperation}
            onOperationActioned={handleActionComplete}
            showPendingByDefault={true}
          />
        </div>

        {/* Detail panel (takes 1/3 on large screens, full width on mobile) */}
        {selectedOperation && (
          <div className="lg:col-span-1">
            <ApprovalDetail
              operation={selectedOperation}
              userId={userId}
              organizationId={organizationId}
              token={token}
              userRole={userRole as any}
              onActionComplete={handleActionComplete}
              onClose={() => setSelectedOperation(null)}
            />
          </div>
        )}

        {/* Empty state when no operation selected */}
        {!selectedOperation && (
          <div className="lg:col-span-1 bg-gray-50 rounded-lg border border-gray-200 p-6 flex items-center justify-center min-h-96">
            <div className="text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900">No operation selected</h3>
              <p className="mt-2 text-sm text-gray-600">
                Select an operation from the queue to view details and take action
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer information */}
      <div className="border-t border-gray-200 pt-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h3 className="text-sm font-medium text-gray-900">Role Changes</h3>
            <p className="mt-1 text-sm text-gray-600">
              Manage member role promotions and demotions within your organization.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-900">Sensitive Operations</h3>
            <p className="mt-1 text-sm text-gray-600">
              Review data exports, account recoveries, and key rotations requiring approval.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-900">Governance</h3>
            <p className="mt-1 text-sm text-gray-600">
              Approve policy updates, fee adjustments, and other organizational changes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
