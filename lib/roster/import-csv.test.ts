import { describe, expect, it } from "vitest";

import {
  dedupeAgainstExisting,
  parseRosterCsvText,
  type ContactSummary,
} from "./import-csv";

const CLEAN_CSV = `first_name,last_name,display_name,email,phone,preferred_contact,primary_role,roles,qualifications,notes,active
Robert,Owner,Robert O.,robert@calabogie.com,613-555-0101,both,Incident Lead,"Incident Lead;Rescue Crew","Extrication;First Aid",,true
Jane,Doe,,jane.doe@example.com,+14155552671,email,Medical,"Medical","First Aid,Medical",Trained 2024,true
`;

describe("parseRosterCsvText", () => {
  it("parses a clean CSV and normalizes contacts", () => {
    const { rows, errors } = parseRosterCsvText(CLEAN_CSV);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].displayName).toBe("Robert O.");
    expect(rows[0].emailNormalized).toBe("robert@calabogie.com");
    expect(rows[0].phoneE164).toBe("+16135550101");
    expect(rows[0].roles).toEqual(["Incident Lead", "Rescue Crew"]);
    expect(rows[0].qualifications).toEqual(["Extrication", "First Aid"]);
    expect(rows[1].displayName).toBe("Jane Doe"); // synthesized from first/last
    expect(rows[1].preferredContact).toBe("email");
  });

  it("returns empty rows for header-only CSV", () => {
    const { rows, errors } = parseRosterCsvText(
      "first_name,last_name,display_name,email,phone\n",
    );
    expect(rows).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it("flags rows missing a name as invalid", () => {
    // include a phone so the row isn't dropped as empty
    const csv = `display_name,email,phone\n,,613-555-0101\n`;
    const { rows } = parseRosterCsvText(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].errors.some((e) => e.startsWith("display_name:"))).toBe(
      true,
    );
  });

  it("flags malformed email", () => {
    const csv = `display_name,email,phone\nFoo,not-an-email,613-555-0101\n`;
    const { rows } = parseRosterCsvText(csv);
    expect(rows[0].errors.some((e) => e.startsWith("email:"))).toBe(true);
  });

  it("forces preferred_contact to manual_only when both phone and email are missing", () => {
    const csv = `display_name,email,phone,preferred_contact\nFoo,,,both\n`;
    const { rows } = parseRosterCsvText(csv);
    expect(rows[0].preferredContact).toBe("manual_only");
  });
});

describe("dedupeAgainstExisting", () => {
  it("marks rows whose email matches an existing contact as duplicate", () => {
    const { rows } = parseRosterCsvText(CLEAN_CSV);
    const existing: ContactSummary[] = [
      {
        staff_member_id: "abc-123",
        display_name: "Robert (existing)",
        contact_keys: ["email:robert@calabogie.com"],
      },
    ];
    const result = dedupeAgainstExisting(rows, existing);
    expect(result[0].status).toBe("duplicate");
    expect(result[0].matchedStaffMemberId).toBe("abc-123");
    expect(result[1].status).toBe("new");
  });

  it("marks rows with invalid email/no name as invalid", () => {
    const csv = `display_name,email,phone\n,bogus,not-a-phone\n`;
    const { rows } = parseRosterCsvText(csv);
    const result = dedupeAgainstExisting(rows, []);
    expect(result[0].status).toBe("invalid");
    expect(result[0].defaultDecision).toBe("skip");
  });

  it("returns 'new' for clean rows that don't match anything", () => {
    const { rows } = parseRosterCsvText(CLEAN_CSV);
    const result = dedupeAgainstExisting(rows, []);
    expect(result.every((r) => r.status === "new")).toBe(true);
  });
});
