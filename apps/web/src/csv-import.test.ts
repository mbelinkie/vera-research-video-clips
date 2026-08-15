import { describe, expect, it } from "vitest";

import {
  CsvImportError,
  extractCsvInputs,
  parseCsvImport,
} from "./csv-import.ts";

describe("CSV batch import", () => {
  it("selects a recognized URL column without being confused by quoted fields", () => {
    const document = parseCsvImport(
      'Title,YouTube URL,Notes\n"Interview, part one",https://youtu.be/ReadyVideo1,"line one\nline two"\nSecond,ReadyVideo2,duplicate stays visible\n',
    );

    expect(document).toMatchObject({
      columns: ["Title", "YouTube URL", "Notes"],
      suggestedColumnIndex: 1,
      hasHeader: true,
    });
    expect(extractCsvInputs(document, 1).inputs).toEqual([
      "https://youtu.be/ReadyVideo1",
      "ReadyVideo2",
    ]);
  });

  it("accepts a headerless one-column list and preserves duplicates for preflight", () => {
    const document = parseCsvImport(
      "ReadyVideo1\nReadyVideo1\n\nReadyVideo2\n",
    );

    expect(document).toMatchObject({
      columns: ["Column 1"],
      suggestedColumnIndex: 0,
      hasHeader: false,
    });
    expect(extractCsvInputs(document, 0).inputs).toEqual([
      "ReadyVideo1",
      "ReadyVideo1",
      "ReadyVideo2",
    ]);
  });

  it("fails closed on malformed CSV and oversized batches", () => {
    expect(() => parseCsvImport('URL\n"unterminated')).toThrow(CsvImportError);
    const document = parseCsvImport(
      [
        "URL",
        ...Array.from({ length: 501 }, (_, index) => `Video${index}`),
      ].join("\n"),
    );
    expect(() => extractCsvInputs(document, 0)).toThrow("at most 500 rows");
  });
});
