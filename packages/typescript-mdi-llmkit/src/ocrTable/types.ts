/**
 * Represents a table extracted from a document via OCR.
 * Contains metadata about the table along with its structured data.
 */
export interface OcrExtractedTable {
  name: string;
  description: string;
  columns: string[];
  page_start: number;
  page_end: number;
  data: Array<Record<string, string>>;
  aggregations: string;
  notes: string;
}

/**
 * Represents all tables extracted from a single file.
 * Links the source file path to its extracted tables and optional metadata.
 */
export interface OcrTablesFromFile {
  file: string;
  metadata?: Record<string, string>;
  tables: OcrExtractedTable[];
}

/**
 * Maps file paths to their OCR extraction results.
 * Used for batch processing multiple PDF files and organizing their extracted table data.
 */
export interface OcrMultiFilesTableExtraction {
  [filePath: string]: OcrTablesFromFile;
}
