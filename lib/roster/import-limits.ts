/**
 * Constants for the CSV import flow. Kept out of `actions.ts` because
 * "use server" files can't export non-async values.
 */

/** Server-side hard cap on rows per import. Keep in sync with the check
 * inside `importRosterCsv`. */
export const IMPORT_ROW_LIMIT = 5000;

/** Client-side cap on the CSV file size (1 MiB). The import wizard rejects
 * larger files before uploading. */
export const IMPORT_MAX_BYTES = 1024 * 1024;
