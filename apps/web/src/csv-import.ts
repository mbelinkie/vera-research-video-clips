import Papa from "papaparse";

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 500;
const MAX_CSV_COLUMNS = 50;
const preferredHeaders = new Set([
  "url",
  "youtube url",
  "youtube_url",
  "video url",
  "video_url",
  "link",
]);

export type CsvImportDocument = {
  columns: string[];
  rows: string[][];
  suggestedColumnIndex?: number;
  hasHeader: boolean;
};

export class CsvImportError extends Error {}

export function parseCsvImport(text: string): CsvImportDocument {
  const byteSize = new TextEncoder().encode(text).byteLength;
  if (byteSize > MAX_CSV_BYTES) {
    throw new CsvImportError("CSV files must be 2 MB or smaller.");
  }
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
  });
  const fatalError = parsed.errors.find(
    (error) => error.code !== "UndetectableDelimiter",
  );
  if (fatalError) {
    throw new CsvImportError(
      `CSV row ${(fatalError.row ?? 0) + 1}: ${fatalError.message}`,
    );
  }
  const rawRows = parsed.data.map((row) =>
    row.map((value, columnIndex) =>
      String(value ?? "")
        .replace(columnIndex === 0 ? /^\uFEFF/ : /$^/, "")
        .trim(),
    ),
  );
  if (!rawRows.length) throw new CsvImportError("The CSV file is empty.");
  const width = Math.max(...rawRows.map((row) => row.length));
  if (width > MAX_CSV_COLUMNS) {
    throw new CsvImportError("CSV files may contain at most 50 columns.");
  }
  const firstRow = rawRows[0]!;
  const matchedHeader = firstRow.findIndex((value) =>
    preferredHeaders.has(value.toLocaleLowerCase("en-US")),
  );
  const hasHeader = matchedHeader >= 0;
  const columns = hasHeader
    ? Array.from(
        { length: width },
        (_, index) => firstRow[index]?.trim() || `Column ${index + 1}`,
      )
    : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  const rows = hasHeader ? rawRows.slice(1) : rawRows;
  return {
    columns,
    rows,
    hasHeader,
    ...(matchedHeader >= 0
      ? { suggestedColumnIndex: matchedHeader }
      : width === 1
        ? { suggestedColumnIndex: 0 }
        : {}),
  };
}

export function extractCsvInputs(
  document: CsvImportDocument,
  columnIndex: number,
): { inputs: string[]; ignoredEmptyRows: number } {
  if (
    !Number.isInteger(columnIndex) ||
    columnIndex < 0 ||
    columnIndex >= document.columns.length
  ) {
    throw new CsvImportError("Choose the column containing YouTube URLs.");
  }
  const values = document.rows.map((row) => row[columnIndex]?.trim() ?? "");
  const inputs = values.filter(Boolean);
  if (!inputs.length) {
    throw new CsvImportError("The selected column contains no values.");
  }
  if (inputs.length > MAX_CSV_ROWS) {
    throw new CsvImportError(
      "A transcription batch may contain at most 500 rows.",
    );
  }
  return {
    inputs,
    ignoredEmptyRows: values.length - inputs.length,
  };
}
