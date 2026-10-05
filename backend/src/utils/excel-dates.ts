const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export const EXCEL_DATETIME_FORMAT = "mmm dd, yyyy, hh:mm AM/PM";
export const EXCEL_DATE_FORMAT = "mmm dd, yyyy";

// Excel cells hold wall-clock time without a zone, and ExcelJS writes Date values
// as UTC. Shift by Manila's fixed offset (no daylight saving) so cells show the
// same Philippine time as the printed report.
export function manilaExcelDate(value: string | Date) {
  return new Date(new Date(value).getTime() + MANILA_OFFSET_MS);
}
