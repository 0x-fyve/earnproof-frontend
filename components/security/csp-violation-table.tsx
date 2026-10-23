"use client";

import { ExternalLink } from "@/components/common/external-link";
import { Timestamp } from "@/components/common/timestamp";
import Link from "next/link";
import {
  getCspRemediation,
  isRegression,
  type CspViolationGroup,
} from "@/lib/api/csp-violations";
import { defineMessages, formatMessage, formatNumber } from "@/lib/i18n";

const messages = defineMessages("cspViolations", {
  caption: "CSP violation groups for the selected window, newest activity first",
  regressionBadge: "New in {release}",
  recoveryLabel: "Recovery for {directive} on {routeCategory}",
});

const blockedKindLabels: Record<CspViolationGroup["blockedKind"], string> = {
  inline: "Inline code or style",
  eval: "eval or Function",
  data: "data: resource",
  blob: "blob: resource",
  "same-origin": "Same origin",
  "third-party": "Third party",
  unknown: "Unknown",
};

const routeCategoryLabels: Record<CspViolationGroup["routeCategory"], string> = {
  public: "Public pages",
  verify: "Verification",
  embed: "Embedded verification",
  proofs: "Proofs",
  settings: "Settings",
  issuers: "Issuers",
  developers: "Developers",
  other: "Other",
};

/**
 * Sample-free rows: nothing here can show a URL, a script sample or DOM text,
 * because `lib/api/csp-violations.ts` never lets those fields through.
 */
export function CspViolationTable({
  groups,
  currentRelease,
}: {
  groups: CspViolationGroup[];
  currentRelease: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full min-w-[56rem] border-collapse text-left text-sm" data-testid="csp-violation-table">
        <caption className="sr-only">{messages.caption}</caption>
        <thead className="bg-white/[0.04] text-xs uppercase text-slate-400">
          <tr>
            <th className="px-3 py-2 font-semibold" scope="col">Directive</th>
            <th className="px-3 py-2 font-semibold" scope="col">Route category</th>
            <th className="px-3 py-2 font-semibold" scope="col">Release</th>
            <th className="px-3 py-2 font-semibold" scope="col">Blocked source</th>
            <th className="px-3 py-2 text-right font-semibold" scope="col">Count</th>
            <th className="px-3 py-2 font-semibold" scope="col">First seen</th>
            <th className="px-3 py-2 font-semibold" scope="col">Last seen</th>
            <th className="px-3 py-2 font-semibold" scope="col">Recovery</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const regression = isRegression(group, currentRelease);
            const remediation = getCspRemediation(group);
            return (
              <tr className="border-t border-white/10 align-top" data-testid="csp-violation-row" key={group.id}>
                <th className="px-3 py-3 font-mono text-xs font-normal text-white" scope="row">
                  {group.directive}
                </th>
                <td className="px-3 py-3 text-slate-300">{routeCategoryLabels[group.routeCategory]}</td>
                <td className="px-3 py-3 text-slate-300">
                  <span className="font-mono text-xs">{group.release}</span>
                  {regression && (
                    <span
                      className="ml-2 inline-flex rounded-lg border border-rose-300/30 bg-rose-300/10 px-2 py-0.5 text-xs font-semibold text-rose-100"
                      data-testid="csp-regression-badge"
                    >
                      {formatMessage(messages.regressionBadge, { release: group.release })}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-slate-300">{blockedKindLabels[group.blockedKind]}</td>
                <td className="px-3 py-3 text-right font-semibold text-white">{formatNumber(group.count)}</td>
                <td className="px-3 py-3 text-xs text-slate-400"><Timestamp value={group.firstSeenAt} /></td>
                <td className="px-3 py-3 text-xs text-slate-400"><Timestamp value={group.lastSeenAt} /></td>
                <td className="px-3 py-3">
                  <details>
                    <summary
                      aria-label={formatMessage(messages.recoveryLabel, {
                        directive: group.directive,
                        routeCategory: routeCategoryLabels[group.routeCategory],
                      })}
                      className="cursor-pointer text-xs font-semibold text-cyan-200"
                    >
                      Steps
                    </summary>
                    <div className="mt-2 grid max-w-sm gap-2 text-xs text-slate-300">
                      <p className="font-semibold text-white">{remediation.title}</p>
                      <ol className="grid list-decimal gap-1 pl-4">
                        {remediation.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                      <ul className="flex flex-wrap gap-3">
                        {remediation.links.map((link) => (
                          <li key={link.href}>
                            {link.external ? (
                              <ExternalLink className="text-cyan-200 underline" href={link.href}>
                                {link.label}
                              </ExternalLink>
                            ) : (
                              <Link className="text-cyan-200 underline" href={link.href}>
                                {link.label}
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
