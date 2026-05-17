"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import type {
  CrewRole,
  PreferredContactMethod,
  Qualification,
} from "@/lib/db/types";
import type {
  ConsentSource,
  StaffMemberCreateInput,
} from "@/lib/validation/schemas";

import {
  createStaffMember,
  updateStaffMember,
  type ActionResult,
} from "@/app/dashboard/roster/actions";

export type StaffFormInitial = {
  id?: string;
  display_name?: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  preferred_contact?: PreferredContactMethod;
  notes?: string | null;
  active?: boolean;
  role_ids?: string[];
  primary_role_id?: string | null;
  qualification_ids?: string[];
  consent_sms?: boolean;
  consent_sms_source?: ConsentSource | null;
  consent_email?: boolean;
  consent_email_source?: ConsentSource | null;
};

type StaffFormProps = {
  mode: "create" | "edit";
  initial?: StaffFormInitial;
  roles: CrewRole[];
  qualifications: Qualification[];
};

export function StaffForm({ mode, initial, roles, qualifications }: StaffFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [firstName, setFirstName] = useState(initial?.first_name ?? "");
  const [lastName, setLastName] = useState(initial?.last_name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [preferred, setPreferred] = useState<PreferredContactMethod>(
    initial?.preferred_contact ?? "both",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [roleIds, setRoleIds] = useState<string[]>(initial?.role_ids ?? []);
  const [primaryRoleId, setPrimaryRoleId] = useState<string | null>(
    initial?.primary_role_id ?? null,
  );
  const [qualIds, setQualIds] = useState<string[]>(
    initial?.qualification_ids ?? [],
  );
  const [consentSms, setConsentSms] = useState(initial?.consent_sms ?? false);
  const [consentSmsSource, setConsentSmsSource] =
    useState<ConsentSource>(initial?.consent_sms_source ?? "verbal");
  const [consentEmail, setConsentEmail] = useState(
    initial?.consent_email ?? false,
  );
  const [consentEmailSource, setConsentEmailSource] =
    useState<ConsentSource>(initial?.consent_email_source ?? "web_form");

  function toggle(list: string[], id: string, setter: (v: string[]) => void) {
    if (list.includes(id)) setter(list.filter((x) => x !== id));
    else setter([...list, id]);
  }

  function fieldError(key: string): string | null {
    return fieldErrors[key]?.[0] ?? null;
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setFieldErrors({});

    const input: StaffMemberCreateInput = {
      display_name: displayName,
      first_name: firstName || null,
      last_name: lastName || null,
      phone: phone || null,
      email: email || null,
      preferred_contact: preferred,
      notes: notes || null,
      active,
      role_ids: roleIds,
      primary_role_id: primaryRoleId,
      qualification_ids: qualIds,
      consent_sms: consentSms,
      consent_sms_source: consentSms ? consentSmsSource : null,
      consent_email: consentEmail,
      consent_email_source: consentEmail ? consentEmailSource : null,
    };

    startTransition(async () => {
      let result: ActionResult<{ id: string }>;
      if (mode === "edit" && initial?.id) {
        result = await updateStaffMember(initial.id, input);
      } else {
        result = await createStaffMember(input);
      }
      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      router.push(`/dashboard/roster/${result.data.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} style={formStyle}>
      {error && (
        <Card
          style={{
            padding: 12,
            borderColor: "var(--bad)",
            color: "var(--bad)",
          }}
        >
          {error}
        </Card>
      )}

      <Card style={sectionStyle}>
        <Label>Display name *</Label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        {fieldError("display_name") && (
          <FieldErr>{fieldError("display_name")}</FieldErr>
        )}

        <div style={twoCol}>
          <div>
            <Label>First name</Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label>Last name</Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card style={sectionStyle}>
        <SectionTitle>Contact</SectionTitle>
        <Label>Phone</Label>
        <Input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 613 555 0142"
          inputMode="tel"
          autoComplete="tel"
        />
        {fieldError("phone") && <FieldErr>{fieldError("phone")}</FieldErr>}

        <Label>Email</Label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          inputMode="email"
          autoComplete="email"
        />
        {fieldError("email") && <FieldErr>{fieldError("email")}</FieldErr>}

        <Label>Preferred contact</Label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(
            ["sms", "email", "both", "manual_only"] as PreferredContactMethod[]
          ).map((opt) => (
            <RadioChip
              key={opt}
              checked={preferred === opt}
              onClick={() => setPreferred(opt)}
              label={
                opt === "manual_only"
                  ? "Manual only"
                  : opt[0].toUpperCase() + opt.slice(1)
              }
            />
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <Checkbox
            checked={consentSms}
            onChange={setConsentSms}
            label="Consent to SMS"
          />
          {consentSms && (
            <Select
              value={consentSmsSource}
              onChange={(v) => setConsentSmsSource(v as ConsentSource)}
              options={["verbal", "web_form", "import", "manual"]}
              label="SMS consent source"
            />
          )}
          <Checkbox
            checked={consentEmail}
            onChange={setConsentEmail}
            label="Consent to email"
          />
          {consentEmail && (
            <Select
              value={consentEmailSource}
              onChange={(v) => setConsentEmailSource(v as ConsentSource)}
              options={["verbal", "web_form", "import", "manual"]}
              label="Email consent source"
            />
          )}
        </div>
      </Card>

      <Card style={sectionStyle}>
        <SectionTitle>Roles</SectionTitle>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {roles.length === 0 && (
            <span style={mutedStyle}>No roles defined yet.</span>
          )}
          {roles.map((r) => (
            <RadioChip
              key={r.id}
              checked={roleIds.includes(r.id)}
              onClick={() => {
                toggle(roleIds, r.id, setRoleIds);
                if (primaryRoleId === r.id) setPrimaryRoleId(null);
              }}
              label={r.name}
            />
          ))}
        </div>
        {roleIds.length > 0 && (
          <>
            <Label style={{ marginTop: 12 }}>Primary role</Label>
            <select
              value={primaryRoleId ?? ""}
              onChange={(e) => setPrimaryRoleId(e.target.value || null)}
              style={inputStyle}
            >
              <option value="">— None —</option>
              {roles
                .filter((r) => roleIds.includes(r.id))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </>
        )}
      </Card>

      <Card style={sectionStyle}>
        <SectionTitle>Qualifications</SectionTitle>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {qualifications.length === 0 && (
            <span style={mutedStyle}>No qualifications defined yet.</span>
          )}
          {qualifications.map((q) => (
            <RadioChip
              key={q.id}
              checked={qualIds.includes(q.id)}
              onClick={() => toggle(qualIds, q.id, setQualIds)}
              label={q.name}
            />
          ))}
        </div>
      </Card>

      <Card style={sectionStyle}>
        <SectionTitle>Notes (owner-only)</SectionTitle>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
        />
        <Checkbox checked={active} onChange={setActive} label="Active" />
      </Card>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Btn>
        <Btn type="submit" variant="primary" disabled={isPending}>
          {isPending ? "Saving…" : mode === "edit" ? "Save changes" : "Create"}
        </Btn>
      </div>
    </form>
  );
}

/* ─── styling helpers, kept inline to stay self-contained ─── */

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  maxWidth: 720,
  margin: "0 auto",
  padding: "16px 16px 80px",
};

const sectionStyle: React.CSSProperties = {
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 12px",
  borderRadius: 4,
  border: "1px solid var(--line)",
  background: "var(--bg-2)",
  color: "var(--text)",
  font: "500 14px/1.2 inherit",
  minHeight: 44,
};

const twoCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
  marginTop: 8,
};

const mutedStyle: React.CSSProperties = {
  color: "var(--text-3)",
  fontSize: 12,
};

function Label({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="cs-label"
      style={{ display: "block", marginBottom: 4, ...style }}
    >
      {children}
    </span>
  );
}

function FieldErr({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        color: "var(--bad)",
        fontSize: 11,
        marginTop: -4,
      }}
    >
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="cs-h3">{children}</h2>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...inputStyle, ...props.style }} />;
}

function RadioChip({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 44,
        padding: "10px 14px",
        borderRadius: 4,
        cursor: "pointer",
        border: "1px solid var(--line)",
        background: checked ? "var(--accent)" : "var(--surface)",
        color: checked ? "var(--accent-ink)" : "var(--text)",
        fontWeight: 600,
        fontSize: 12,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </button>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        gap: 8,
        alignItems: "center",
        cursor: "pointer",
        minHeight: 44,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
      />
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace("_", " ")}
          </option>
        ))}
      </select>
    </div>
  );
}

