"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Btn } from "@/components/ui/Btn";
import type { ContactChannel } from "@/lib/db/types";
import {
  renderInviteEmail,
  renderInviteSms,
  formatEventWhenLong,
  type TemplateEvent,
} from "@/lib/messaging/render-templates";

import { InviteSelectStep, type InviteCandidate } from "./InviteSelectStep";
import { InviteComposeStep } from "./InviteComposeStep";
import { InviteConfirmStep } from "./InviteConfirmStep";
import { StepProgress } from "./StepProgress";

import type { SendInvitationCampaignResult } from "@/app/dashboard/events/[eventId]/invite/actions";

export type InviteWizardProps = {
  eventId: string;
  event: TemplateEvent;
  candidates: InviteCandidate[];
  /** Server action passed in to keep the wizard component self-contained. */
  sendAction: (input: {
    eventId: string;
    staffMemberIds: string[];
    channels: ContactChannel[];
  }) => Promise<SendInvitationCampaignResult>;
};

const STEP_TITLES = ["Select responders", "Compose & preview", "Confirm send"];

export function InviteWizard({
  eventId,
  event,
  candidates,
  sendAction,
}: InviteWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [channels, setChannels] = useState<Record<ContactChannel, boolean>>({
    sms: true,
    email: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const activeChannels: ContactChannel[] = useMemo(() => {
    const out: ContactChannel[] = [];
    if (channels.sms) out.push("sms");
    if (channels.email) out.push("email");
    return out;
  }, [channels]);

  // Live reachable counts (purely client-side estimate; the server is the
  // source of truth — see counts returned from `sendAction`).
  const selectedCandidates = useMemo(
    () => candidates.filter((c) => selected.has(c.id)),
    [candidates, selected],
  );
  const smsReachable = selectedCandidates.filter(
    (c) =>
      c.sms_present &&
      c.preferred_contact !== "manual_only" &&
      c.preferred_contact !== "email" &&
      c.sms_status !== "opted_out" &&
      c.sms_status !== "bounced" &&
      c.sms_status !== "suppressed" &&
      c.sms_status !== "invalid",
  ).length;
  const emailReachable = selectedCandidates.filter(
    (c) =>
      c.email_present &&
      c.preferred_contact !== "manual_only" &&
      c.preferred_contact !== "sms" &&
      c.email_status !== "bounced" &&
      c.email_status !== "opted_out" &&
      c.email_status !== "suppressed" &&
      c.email_status !== "invalid",
  ).length;
  const skippedOptOut = selectedCandidates.filter(
    (c) =>
      (c.sms_status === "opted_out" || c.email_status === "bounced") &&
      c.preferred_contact !== "manual_only",
  ).length;
  const skippedManualOnly = selectedCandidates.filter(
    (c) => c.preferred_contact === "manual_only",
  ).length;

  const smsPreview = useMemo(
    () =>
      renderInviteSms({
        event,
        recipient: {
          display_name: "{first name}",
          role_label: null,
        },
        rsvpUrl: `${process.env.NEXT_PUBLIC_APP_BASE_URL ?? ""}/r/{token}`.replace(
          /^\/r\//,
          "/r/",
        ),
      }),
    [event],
  );
  const emailPreview = useMemo(
    () =>
      renderInviteEmail({
        event,
        recipient: {
          display_name: "{first name}",
          role_label: null,
        },
        rsvpUrl: `${process.env.NEXT_PUBLIC_APP_BASE_URL ?? ""}/r/{token}`.replace(
          /^\/r\//,
          "/r/",
        ),
      }),
    [event],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    setSelected(new Set(candidates.map((c) => c.id)));
  };
  const toggleChannel = (c: ContactChannel) => {
    setChannels((prev) => ({ ...prev, [c]: !prev[c] }));
  };

  const onContinue = () => {
    setError(null);
    if (step < 2) setStep(step + 1);
  };

  const onSend = () => {
    setError(null);
    if (selectedIds.length === 0) {
      setError("Select at least one responder.");
      return;
    }
    if (activeChannels.length === 0) {
      setError("Pick at least one channel.");
      return;
    }
    startTransition(async () => {
      const result = await sendAction({
        eventId,
        staffMemberIds: selectedIds,
        channels: activeChannels,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const qs = new URLSearchParams({
        invited: String(result.invited),
        sms: String(result.sms_enqueued),
        email: String(result.email_enqueued),
        opt: String(result.skipped_opt_out),
        manual: String(result.skipped_manual_only),
        none: String(result.skipped_no_contact),
      });
      router.push(`/dashboard/events/${eventId}/invite/sent?${qs.toString()}`);
    });
  };

  return (
    <div style={{ position: "relative", paddingBottom: 120 }}>
      {/* Top bar */}
      <div
        style={{
          padding: "16px 16px 8px",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <Link
          href={`/dashboard/events/${eventId}`}
          className="cs-eyebrow"
          style={{
            textDecoration: "none",
            color: "var(--text-3)",
            display: "inline-block",
            marginBottom: 6,
          }}
        >
          ← BACK · EVENT
        </Link>
        <span className="cs-eyebrow">STEP {step + 1} OF 3 · {event.title}</span>
        <h1 className="cs-h1" style={{ marginTop: 6, fontSize: 22 }}>
          {STEP_TITLES[step]}
        </h1>
      </div>

      <StepProgress step={step} />

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {step === 0 && (
          <InviteSelectStep
            candidates={candidates}
            selected={selected}
            onToggle={toggle}
            onSelectAll={selectAll}
          />
        )}
        {step === 1 && (
          <InviteComposeStep
            channels={channels}
            smsReachable={smsReachable}
            emailReachable={emailReachable}
            smsPreview={smsPreview}
            emailPreview={emailPreview}
            onToggleChannel={toggleChannel}
          />
        )}
        {step === 2 && (
          <InviteConfirmStep
            eventTitle={event.title}
            eventWhen={formatEventWhenLong(event)}
            recipients={selectedIds.length}
            smsCount={channels.sms ? smsReachable : 0}
            emailCount={channels.email ? emailReachable : 0}
            skippedOptOut={skippedOptOut}
            skippedManualOnly={skippedManualOnly}
            skippedNoContact={0}
          />
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            bottom: 140,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            padding: "0 16px",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              maxWidth: 720,
              width: "100%",
              padding: "10px 14px",
              background: "color-mix(in srgb, var(--bad) 14%, transparent)",
              color: "var(--bad)",
              border: "1px solid var(--bad)",
              borderRadius: 4,
              fontSize: 13,
              pointerEvents: "auto",
            }}
          >
            {error}
          </div>
        </div>
      )}

      {/* Sticky action bar */}
      <div className="cs-event-actionbar-wrap">
        <div className="cs-event-actionbar">
          {step > 0 && (
            <Btn
              type="button"
              size="lg"
              onClick={() => setStep(step - 1)}
              disabled={pending}
            >
              BACK
            </Btn>
          )}
          {step < 2 ? (
            <Btn
              variant="primary"
              size="lg"
              style={{ flex: 1 }}
              onClick={onContinue}
              disabled={
                pending || (step === 0 && selected.size === 0) || (step === 1 && activeChannels.length === 0)
              }
            >
              CONTINUE · {selected.size} SELECTED
            </Btn>
          ) : (
            <Btn
              variant="primary"
              size="lg"
              style={{ flex: 1 }}
              onClick={onSend}
              disabled={pending || selectedIds.length === 0}
            >
              {pending ? "SENDING…" : `SEND TO ${selectedIds.length}`}
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}
