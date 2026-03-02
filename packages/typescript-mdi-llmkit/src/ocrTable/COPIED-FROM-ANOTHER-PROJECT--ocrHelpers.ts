import * as fs from 'fs';
import OpenAI from 'openai';

import { OcrExtractedTable, OcrMultiFilesTableExtraction, OcrTablesFromFile } from './records.js';

/**
 * Normalizes a string by trimming whitespace, converting to lowercase,
 * and removing non-alphanumeric characters. This way, if OCR makes small
 * errors, e.g. with punctuation or spacing, we can still do a reasonable match.
 * @param s The string to normalize
 * @returns The normalized string
 */
const _normstr = (s: string): string => {
  s = s.trim().toLowerCase();
  // Remove non-alphanumeric characters
  s = s.replace(/[^a-z0-9]/g, '');
  return s;
};

/**
 * Compares two strings for equality after normalizing them.
 * @param a The first string to compare
 * @param b The second string to compare
 * @returns True if the normalized strings are equal, false otherwise
 */
const _normstreq = (a: string, b: string): boolean => {
  return _normstr(a) === _normstr(b);
};



/**
 * Generates a normalized string representation of a data row,
 * @param row The data row as a record of column names to values
 * @param columns The ordered list of column names
 * @returns The normalized string representation of the row
 */
const _normedRowData = (row: Record<string, string>, columns: string[]): string => {
  let normedRowStr = '';
  for (const colName of columns) {
    const cellValue = row[colName] || '';
    normedRowStr += _normstr(cellValue) + '|';
  }
  return normedRowStr;
};

/**
 * Builds a map of normalized row strings to their corresponding data rows
 * @param table The OCR extracted table
 * @returns A map where keys are normalized row strings and values are the corresponding data rows
 */
const _buildTableNormalizedRowStringMap = (
  table: OcrExtractedTable
): Record<string, Record<string, string>> => {
  const retval: Record<string, Record<string, string>> = {};

  for (const row of table.data) {
    let normedRowStr = _normedRowData(row, table.columns);
    retval[normedRowStr] = row;
  }

  return retval;
};



/**
 * Extracts tabular data from PNG image buffers using AI-powered OCR.
 * Processes multiple pages, detects tables, handles tables spanning multiple pages,
 * extracts column headers, data rows, aggregations, and additional notes.
 *
 * Uses a multi-step AI approach:
 * 1. Identifies all tables on each page
 * 2. Detects if tables continue across pages
 * 3. Extracts column names
 * 4. Extracts all data rows
 * 5. Identifies aggregation/summary data
 * 6. Provides extraction notes
 *
 * @param pagesAsPngBuffers - Array of PNG image buffers representing document pages
 * @param additionalInstructions - Optional custom instructions to guide the OCR process
 * @returns Array of extracted tables with their complete data structures
 */
export const ocrImagesExtractTableData = async (
  pagesAsPngBuffers: Buffer[],
  additionalInstructions?: string
): Promise<OcrExtractedTable[]> => {
  additionalInstructions = additionalInstructions || '';

  let retvalTables = [] as OcrExtractedTable[];

  let currentPageIndex = 0;
  let startWithTableName = '';
  while (currentPageIndex < pagesAsPngBuffers.length) {
    console.log(
      `Parsing Page ${currentPageIndex + 1} of ${pagesAsPngBuffers.length}` +
        (startWithTableName.length > 0 ? `, starting with table "${startWithTableName}"` : '')
    );
    let didAlreadyIncrementPageIndex = false;

    const pagePngBuffer = pagesAsPngBuffers[currentPageIndex];
    const imgbuf = pagePngBuffer;
    const imgBase64 = imgbuf.toString('base64');
    const imgDataUrl = `data:image/png;base64,${imgBase64}`;

    const messages = [] as OpenAI.Responses.ResponseInput;
    messages.push({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `Here is Page ${currentPageIndex + 1} of a PDF document.`,
        },
        {
          type: 'input_image',
          image_url: imgDataUrl,
          detail: 'high',
        },
      ],
    });

    let sStartingTableInstruction = '';
    if (startWithTableName.length > 0) {
      sStartingTableInstruction = `
Start with the table called "${startWithTableName}".
This is the first table that starts on the page.
If there are some table rows above this table, ignore them; they're from some prior table
that started on the previous page.
`;
      startWithTableName = '';
    }

    messages.push({
      role: 'developer',
      content: `
We're scanning this page for **tabular data**.
Does this page contain any tables? Does it have just one table, or multiple tables?
What are the tables called? What fields do they contain? Discuss.

Don't worry about actually parsing the data in the tables yet. 

**DO** pay attention to tables that *start* on this page, even if they continue
onto later pages. This includes tables that might have their title or header on this page,
but their data continues onto later pages.

${sStartingTableInstruction}

${additionalInstructions}
`,
    });

    let llmResponse = await getOpenAIClient().responses.create({
      model: GPT_MODEL_VISION,
      input: messages,
    });
    let llmReply = llmResponse.output_text;
    messages.push({ role: 'assistant', content: llmReply });

    llmResponse = await getOpenAIClient().responses.create({
      model: GPT_MODEL_VISION,
      input: messages,
      text: {
        format: {
          type: 'json_schema',
          name: 'ocr_enumerate_tables',
          description:
            `A list of the tables we can see on this page, ` +
            `as we've just described in our response above.`,
          schema: {
            type: 'object',
            properties: {
              tables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description:
                        `The name, title, or heading of the table. ` +
                        `If the table doesn't have any such name, ` +
                        `provide some descriptive identifier that will ` +
                        `help us refer to this table later.`,
                    },
                    description: {
                      type: 'string',
                      description: `A brief description of the table's purpose.`,
                    },
                  },
                  required: ['name', 'description'],
                  additionalProperties: false,
                },
              },
            },
            required: ['tables'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });
    llmReply = llmResponse.output_text;
    let llmReplyObj = parseJSONfromAIResponse(llmReply);

    const tablesOnThisPage = llmReplyObj.tables;

    for (let iTable = 0; iTable < tablesOnThisPage.length; iTable++) {
      const table = tablesOnThisPage[iTable] as OcrExtractedTable;
      table.columns = [];
      table.data = [];
      table.notes = '';
      table.page_start = currentPageIndex + 1;
      table.page_end = currentPageIndex + 1;
      retvalTables.push(table);

      console.log(`Found table: ${table.name}`);

      let numPagesSpanned = 1;

      const messagesForTable = JSON.parse(
        JSON.stringify(messages)
      ) as OpenAI.Responses.ResponseInput;

      // Backspace over the prompts that talked about multiple tables.
      messagesForTable.pop();
      messagesForTable.pop();

      messagesForTable.push({
        role: 'developer',
        content: `
For the time being, let's focus specifically and exclusively on the following table:
Name: ${table.name}
Description: ${table.description}
`,
      });

      if (
        iTable === tablesOnThisPage.length - 1 &&
        currentPageIndex < pagesAsPngBuffers.length - 1
      ) {
        // This is the last table on the page, and there are more pages in the document.
        // It might continue onto later pages, possibly even more than one.
        // We need to account for that.
        console.log(`  Last table on page ${currentPageIndex + 1}, may continue.`);

        messagesForTable.push({
          role: 'developer',
          content: `
Table "${table.name}" is the last table on Page ${currentPageIndex + 1}. 
We need to check whether it continues onto subsequent pages.
`,
        });

        while (true) {
          currentPageIndex++;
          didAlreadyIncrementPageIndex = true;
          if (currentPageIndex >= pagesAsPngBuffers.length) {
            console.log(`  No more pages left to process.`);
            break;
          }
          const pagePngBuffer = pagesAsPngBuffers[currentPageIndex];
          const imgbuf = pagePngBuffer;
          const imgBase64 = imgbuf.toString('base64');
          const imgDataUrl = `data:image/png;base64,${imgBase64}`;

          messagesForTable.push({
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `Here is Page ${currentPageIndex + 1} of the PDF document.`,
              },
              {
                type: 'input_image',
                image_url: imgDataUrl,
                detail: 'high',
              },
            ],
          });
          messagesForTable.push({
            role: 'developer',
            content: `
Does the table called "${table.name}" continue onto this page?
Does this table possibly even continue onto yet more pages after this one?
Discuss.
`,
          });

          let llmResponse = await getOpenAIClient().responses.create({
            model: GPT_MODEL_VISION,
            input: messagesForTable,
          });
          let llmReply = llmResponse.output_text;
          messagesForTable.push({ role: 'assistant', content: llmReply });

          llmResponse = await getOpenAIClient().responses.create({
            model: GPT_MODEL_VISION,
            input: messagesForTable,
            text: {
              format: {
                type: 'json_schema',
                name: 'ocr_check_table_continuation',
                description: `
Determine whether the table called "${table.name}" continues onto this page.
`,
                schema: {
                  type: 'object',
                  properties: {
                    does_table_continue_onto_this_page: {
                      type: 'boolean',
                      description:
                        `True if the table called "${table.name}" continues onto ` +
                        `this page, from the prior page(s). False if it does not.`,
                    },
                    might_continue_onto_additional_pages: {
                      type: 'boolean',
                      description:
                        `True if the table called "${table.name}" might continue onto ` +
                        `yet more pages after this one. False if we can see that this ` +
                        `table has definitely ended on this page.`,
                    },
                    name_of_next_table_if_any: {
                      type: 'string',
                      description:
                        `If there is another table that starts on this page after the ` +
                        `current table "${table.name}" (even if it's only a partial table, ` +
                        `or possibly even just a table header), provide its name here. ` +
                        `If there is no such next table, provide a blank string.`,
                    },
                  },
                  required: [
                    'does_table_continue_onto_this_page',
                    'might_continue_onto_additional_pages',
                    'name_of_next_table_if_any',
                  ],
                  additionalProperties: false,
                },
                strict: true,
              },
            },
          });
          llmReply = llmResponse.output_text;
          const llmReplyObjForContinuation = parseJSONfromAIResponse(llmReply);
          if (llmReplyObjForContinuation.does_table_continue_onto_this_page) {
            console.log(`  Table "${table.name}" continues onto Page ${currentPageIndex + 1}.`);
            numPagesSpanned++;
          } else {
            console.log(
              `  Table "${table.name}" does NOT continue onto Page ${currentPageIndex + 1}.`
            );
            break;
          }
          if (!llmReplyObjForContinuation.might_continue_onto_additional_pages) {
            console.log(`  Table "${table.name}" ends on Page ${currentPageIndex + 1}.`);
            startWithTableName = llmReplyObjForContinuation.name_of_next_table_if_any;
            console.log(`    Next table on this page (if any): "${startWithTableName}".`);

            if (!startWithTableName || startWithTableName.length === 0) {
              // No other tables on this page.
              // Advance the page index.
              currentPageIndex++;
            }
            break;
          }
        }
      }

      // Extract column names.
      llmResponse = await getOpenAIClient().responses.create({
        model: GPT_MODEL_VISION,
        input: messagesForTable,
        text: {
          format: {
            type: 'json_schema',
            name: 'ocr_extract_columns_from_one_table',
            description: `
Look specifically at the table called "${table.name}" and determine what its column names are,
based on headers or other observable information. 
`,
            schema: {
              type: 'object',
              properties: {
                column_names: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['column_names'],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      });
      llmReply = llmResponse.output_text;
      messagesForTable.push({ role: 'assistant', content: llmReply });
      const llmReplyObjForColumns = parseJSONfromAIResponse(llmReply);
      table.columns = llmReplyObjForColumns.column_names;

      console.log(`  Columns: ${table.columns.join(', ')}`);

      if (table.columns.length === 0) {
        // This table will be filtered out later.
        console.warn(`  Table "${table.name}" has no columns; skipping data extraction.`);
        continue;
      }

      // Create a JSON schema for extracting each row of the actual table data.
      const tableRowExtractionSchema = {
        type: 'object',
        properties: {
          discussion: {
            type: 'string',
            description:
              `A discussion of what data this row contains. State what this item is, ` +
              `what fields it contains, what values those fields contain, ` +
              `and any other relevant context or observations. ` +
              `This is for your own benefit, to help you understand the data you're extracting; ` +
              `it won't be included in the final output.`,
          },
        } as Record<string, any>,
        required: ['discussion'] as string[],
        additionalProperties: false,
      };
      for (const columnName of table.columns) {
        tableRowExtractionSchema.properties[columnName] = {
          type: 'string',
          description:
            `The value in the "${columnName}" column of this row. ` +
            `(If the corresponding cell is blank, leave this as a blank string.)`,
        };
        tableRowExtractionSchema.required.push(columnName);
      }

      let sMultiPageInstructions = '';
      if (numPagesSpanned > 1) {
        sMultiPageInstructions = `
Remember, the table "${table.name}" spans across ${numPagesSpanned} pages.
Be sure to extract data from every one of this table's rows, even if they're on different pages.
Be particularly mindful about individual rows that might be split across page breaks.
`;
      }

      messagesForTable.push({
        role: 'developer',
        content: `
Look specifically at the table called "${table.name}" and extract all of its data rows. 

Include only the table's "body rows", not any rows that might be headers, footers, or 
summary/aggregation rows.

${sMultiPageInstructions}`,
      });

      llmResponse = await getOpenAIClient().responses.create({
        model: GPT_MODEL_VISION,
        input: messagesForTable,
        text: {
          format: {
            type: 'json_schema',
            name: 'ocr_extract_data_from_one_table',
            description: `All of the data rows from the table called "${table.name}".`,
            schema: {
              type: 'object',
              properties: {
                table_rows: {
                  type: 'array',
                  items: tableRowExtractionSchema,
                  description:
                    `Each row of data from the table, ` +
                    `presented in the order in which they appear in the document.`,
                },
              },
              required: ['table_rows'],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      });
      llmReply = llmResponse.output_text;
      messagesForTable.push({ role: 'assistant', content: llmReply });
      llmReplyObj = parseJSONfromAIResponse(llmReply);
      table.data = llmReplyObj.table_rows;

      console.log(`  Extracted ${table.data.length} data rows.`);

      messagesForTable.push({
        role: 'developer',
        content: `
Does the table have any "aggregations", such as totals, averages, counts, or similar summary
data? We don't need to extract these as structured data, i.e. we don't need to parse them into
fields and JSON objects and whatnot. But we *do* need to know if they're present,
and we *do* need to read them if they exist.
`,
      });

      llmResponse = await getOpenAIClient().responses.create({
        model: GPT_MODEL_VISION,
        input: messagesForTable,
        text: {
          format: {
            type: 'json_schema',
            name: 'ocr_read_table_aggregations',
            description: `Any aggregation data from the table called "${table.name}".`,
            schema: {
              type: 'object',
              properties: {
                aggregation_data: {
                  type: 'string',
                  description:
                    `The extracted aggregation data, such as totals, averages, counts, or similar ` +
                    `summary data, presented in textual form. If no such data is present, ` +
                    `simply leave this as a blank string.`,
                },
              },
              required: ['aggregation_data'],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      });
      llmReply = llmResponse.output_text;
      messagesForTable.push({ role: 'assistant', content: llmReply });
      llmReplyObj = parseJSONfromAIResponse(llmReply);
      table.aggregations = llmReplyObj.aggregation_data;

      messagesForTable.push({
        role: 'developer',
        content: `
We've now extracted the table's title, description, columns, data rows, and any aggregation
data. Finally, please provide any additional notes or observations about this table that
might be necessary for a downstream consumer of this data to know. This might include
comments about data quality, possible ambiguities, or any assumptions you had to make
during the extraction process.
If you have no additional notes, simply respond with a blank string.
`,
      });

      llmResponse = await getOpenAIClient().responses.create({
        model: GPT_MODEL_VISION,
        input: messagesForTable,
        text: {
          format: {
            type: 'json_schema',
            name: 'ocr_write_table_extraction_notes',
            description: `
Any notes you feel you should provide about the table called "${table.name}",
that might be useful for future interpretation or analysis.
`,
            schema: {
              type: 'object',
              properties: {
                extraction_notes: {
                  type: 'string',
                  description:
                    `Any additional notes, comments, or observations about the table ` +
                    `that might be useful for a downstream consumer of this data. ` +
                    `If there are no such notes, simply provide a blank string.`,
                },
              },
              required: ['extraction_notes'],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      });
      llmReply = llmResponse.output_text;
      messagesForTable.push({ role: 'assistant', content: llmReply });
      llmReplyObj = parseJSONfromAIResponse(llmReply);
      table.notes = llmReplyObj.extraction_notes;

      table.page_end = currentPageIndex + 1;
    }

    if (!didAlreadyIncrementPageIndex) {
      currentPageIndex++;
    }
  }

  // Filter out tables that have no columns or no data.
  // They were almost certainly mis-scans.
  retvalTables = retvalTables.filter(table => table.columns.length > 0 && table.data.length > 0);
  // Clean the "discussion" fields out of each row.
  for (const table of retvalTables) {
    for (const row of table.data) {
      delete row['discussion'];
    }
  }

  return retvalTables;
};

export const ocrImagesExtractTableDataShotgunned = async (
  pagesAsPngBuffers: Buffer[],
  additionalInstructions?: string
): Promise<OcrExtractedTable[]> => {
  // Run the standard multi-page table extraction function twice, concurrently.
  let [shotgun1, shotgun2] = await Promise.all([
    ocrImagesExtractTableData(pagesAsPngBuffers, additionalInstructions),
    ocrImagesExtractTableData(pagesAsPngBuffers, additionalInstructions),
  ]);

  // Confirm that the two runs produced similar results.
  // First, we check that they found the same number of tables.
  if (shotgun1.length !== shotgun2.length) {
    console.warn(
      `Warning: Shotgun OCR table extraction produced differing results! ` +
        `Run 1 found ${shotgun1.length} tables, but Run 2 found ${shotgun2.length} tables.`
    );

    // Group the individual shotgun results by their counts.
    const shotgunsByCount: Record<number, OcrExtractedTable[]> = {
      [shotgun1.length]: shotgun1,
      [shotgun2.length]: shotgun2,
    };
    // Run additional shotgun runs until we have at least one repeated count.
    while (true) {
      const newShotgun = await ocrImagesExtractTableData(pagesAsPngBuffers, additionalInstructions);
      if (shotgunsByCount[newShotgun.length]) {
        console.log(
          `Additional shotgun run found ${newShotgun.length} tables, ` +
            `matching a prior run. Proceeding with this result set.`
        );
        shotgun1 = shotgunsByCount[newShotgun.length];
        shotgun2 = newShotgun;
        break;
      }
      console.warn(
        `Additional shotgun run found ${newShotgun.length} tables, ` +
          `which doesn't match any prior runs. Continuing to try.`
      );
      shotgunsByCount[newShotgun.length] = newShotgun;
    }

    return shotgun1;
  }

  console.log(
    `Shotgun OCR table extraction produced matching table counts: ` +
      `${shotgun1.length} tables found in both runs.`
  );

  // Next, we go through each table and confirm that their names match.
  // We need their names to match in order for subsequent reconciliation steps to work.
  // Specifically, the rest of the reconciliation logic will try to call tables
  // by their names, so if the names differ, we can't proceed.
  const tableNameRescanRequests: Record<string, string> = {};
  for (let iTable = 0; iTable < shotgun1.length; iTable++) {
    const table1 = shotgun1[iTable];
    const table2 = shotgun2[iTable];
    if (_normstreq(table1.name, table2.name)) {
      continue;
    }
    console.warn(
      `Warning: Shotgun OCR table extraction produced differing results ` +
        `for table ${iTable + 1}: "` +
        `${table1.name}" (Run 1) vs "` +
        `${table2.name}" (Run 2).`
    );
    tableNameRescanRequests[`Table ${iTable + 1} Name`] = `
Please determine a correct, canonical name for Table ${iTable + 1} in the document.
We OCR'ed the document twice, but the two runs disagreed on the table's name.

OCR Table Name Run 1: "${table1.name}"
(starts on Page ${table1.page_start}, ends on Page ${table1.page_end})
Description: ${table1.description}

OCR Table Name Run 2: "${table2.name}"
Description: ${table2.description}
(starts on Page ${table2.page_start}, ends on Page ${table2.page_end})

See if you can find the table we're talking about on Page ${table1.page_start} or
${table2.page_start} of the document. When you find it, decide which of these two
names is more consistent with the table's actual title or header (assuming it has one).
`;
  }
  const numTablesToRename = Object.keys(tableNameRescanRequests).length;
  if (numTablesToRename > 0) {
    console.log(`Renaming ${numTablesToRename} tables based on shotgun OCR discrepancies.`);
    // Important! This step needs to be holistic, because the AI is liable to
    // see earlier tables that could be named similarly, and get confused.
    const renameResults = await ocrImageExtractStructuredFieldsHolistic(
      pagesAsPngBuffers,
      tableNameRescanRequests
    );
    Object.entries(renameResults).forEach(([key, newName]) => {
      const match = key.match(/^Table (\d+) Name$/);
      if (match) {
        const tableIndex = parseInt(match[1], 10) - 1;
        console.log(
          `Renaming Table ${tableIndex + 1} from "` +
            `${shotgun1[tableIndex].name}" to "` +
            `${newName}".`
        );
        shotgun1[tableIndex].name = newName;
        shotgun2[tableIndex].name = newName;
      }
    });
    console.log(`Shotgun OCR reconciled ${numTablesToRename} table names.`);
  }

  // Next, let's reconcile each table's column names.
  // We'll have to re-scan the table if they're different.
  for (let iTable = 0; iTable < shotgun1.length; iTable++) {
    const table1 = shotgun1[iTable];
    const table2 = shotgun2[iTable];
    const tableName = table1.name; // They're reconciled, so this is the same for both.

    const table1Columns = table1.columns.map(col => _normstr(col)).join('|');
    const table2Columns = table2.columns.map(col => _normstr(col)).join('|');

    if (table1Columns === table2Columns) {
      continue;
    }

    const tableAttemptsByColumnNameList: Record<string, OcrExtractedTable> = {};
    tableAttemptsByColumnNameList[table1Columns] = table1;
    tableAttemptsByColumnNameList[table2Columns] = table2;
    while (true) {
      console.log(`Re-scanning table "${tableName}" to reconcile differing column names.`);
      const rescannedTables = await ocrImagesExtractTableData(
        pagesAsPngBuffers,
        additionalInstructions +
          `\n\nUPDATE: **ONLY** extract the table called "${tableName}".` +
          `You should find it on or around Page ${table1.page_start}. ` +
          `Ignore all other tables in the document.`
      );
      if (rescannedTables.length === 0 || rescannedTables.length > 1) {
        console.warn(
          `Warning: Re-scan of table "${tableName}" returned ` +
            `${rescannedTables.length} tables; expected exactly 1. Retrying.`
        );
        continue;
      }
      const rescannedTable = rescannedTables[0];
      const rescannedColumns = rescannedTable.columns.map(col => _normstr(col)).join('|');
      if (tableAttemptsByColumnNameList[rescannedColumns]) {
        console.log(
          `Re-scan of table "${tableName}" produced matching column names ` +
            `to a prior attempt. Proceeding with this result set.`
        );
        const matchedTable = tableAttemptsByColumnNameList[rescannedColumns];
        shotgun1[iTable] = matchedTable;
        shotgun2[iTable] = matchedTable;
        break;
      }
      tableAttemptsByColumnNameList[rescannedColumns] = rescannedTable;
    }
  }

  // Now at last we come to the point where we reconcile the actual table data.
  // We can't just numerically go row by row, because insertion and deletion errors,
  // especially if they both occur, can cause rows to shift around.
  // We'll have to do a more sophisticated matching based on row content.
  // NOTE: It's better to not include a row at all, than to include a row with incorrect data.
  // Therefore, we'll bias towards Shotgun 1. If a row is only present in Shotgun 2,
  // we'll just discard it outright.
  for (let iTable = 0; iTable < shotgun1.length; iTable++) {
    const table1 = shotgun1[iTable];
    const table2 = shotgun2[iTable];

    const tableName = table1.name; // They're reconciled, so this is the same for both.
    const tablePageStart = table1.page_start;

    const table2RowMap = _buildTableNormalizedRowStringMap(table2);

    // Iterate through table 1's rows, per the row map.
    for (let iRow = 0; iRow < table1.data.length; iRow++) {
      const row = table1.data[iRow];
      const normedRowStr = _normedRowData(row, table1.columns);

      // If this row is also present in table 2, we don't need to reconcile it. Yay!
      if (normedRowStr in table2RowMap) {
        continue;
      }

      console.log(`Discrepant row found in table "${tableName}"`);

      let sRowReconciliationPrompt = `
Take a look specifically at the table called "${tableName}", 
which starts on (or near) Page ${tablePageStart} of the document.

An OCR process has produced multiple differing versions of one of the rows in this table.
Please take a second look at the original document images very carefully, and determine
what the correct data is for this particular row in the table.

According to our OCR results, here is one version of the row. This might actually be correct,
or it might contain errors. Examine it carefully in the context of the document images.

Data of the discrepant row:
${JSON.stringify(row, null, 2)}
`;
      const fieldsToExtract: Record<string, string> = {
        row_location_discussion: `
Were you able to find this specific row in the specified table on the document images?
Is it a perfect match, or are there any discrepancies? Discuss.
`,
        discrepancy_discussion: `
Discuss how accurate the provided row version looks. Does it match what you see
in the document images? If not, what fields appear to be incorrect, and what
should their correct values be?
`,
        is_multi_row_merger: `
Is this row possibly a merger of multiple rows that got combined together
by mistake during the OCR process? Discuss. (Naturally, if it is, then the
fields can't possibly be correct.)
`,
        are_all_fields_correct: `
Are all of the fields in the provided row version correct, based on your careful examination
of the document images? Answer just with one word: "Yes" or "No". If you answer "Yes",
you can leave all of the "correct_<column_name>" fields as blank strings.
`,
      };
      for (const columnName of table1.columns) {
        fieldsToExtract[`correct_${columnName}`] = `
What is the correct value for the "${columnName}" column of this row in the table,
based on your careful examination of the document images?

(If the corresponding cell is blank, leave this as a blank string.)

IMPORTANT: Make sure that your examination only considers the specific row in question.
Do *not* bleed in information from other rows in the table, even if they're nearby.
`;
      }

      const reconciliationResult = await ocrImageExtractStructuredFieldsHolistic(
        pagesAsPngBuffers,
        fieldsToExtract,
        sRowReconciliationPrompt
      );
      if (reconciliationResult['are_all_fields_correct'].toLowerCase() === 'yes') {
        console.log(`  No corrections needed; the AI says the original row is correct.`);
        continue;
      }
      delete reconciliationResult['discrepancy_discussion'];
      delete reconciliationResult['row_location_discussion'];
      delete reconciliationResult['is_multi_row_merger'];
      delete reconciliationResult['are_all_fields_correct'];

      // Update the row in shotgun1 with the reconciled values.
      for (const columnName of table1.columns) {
        const newValue = reconciliationResult[`correct_${columnName}`];
        const oldValue = row[columnName];
        if (newValue === oldValue) {
          continue;
        }
        console.log(`  Correcting "${columnName}" from "${oldValue}" to "${newValue}"`);
        row[columnName] = newValue;
      }
    }
  }

  // The results should now be functionally equivalent. We can return either one.
  return shotgun1;
};

// TODO: Factor out common code that creates OpenAI messages out of the image buffers.
// It's re-used in almost every function in this file.

/**
 * Extracts structured metadata fields from document images using an iterative approach.
 *
 * This function processes pages one at a time, sending each page individually to the AI model.
 * It stops early once all requested fields have been found, which can save tokens and cost
 * for large documents when the needed metadata appears on early pages.
 *
 * Use this approach when:
 * - The document is large and you want to minimize token usage
 * - Metadata fields are likely to appear early in the document
 * - Fields can be extracted independently from single pages
 *
 * @param pagesAsPngBuffers - Array of PNG image buffers representing document pages
 * @param fieldsToExtract - Record mapping field names to their descriptions
 * @returns Record containing the extracted field values keyed by field name
 */
export const ocrImageExtractStructuredFieldsIterative = async (
  pagesAsPngBuffers: Buffer[],
  fieldsToExtract: Record<string, string>,
  additionalInstructions?: string
): Promise<Record<string, string>> => {
  // As we find fields, we'll be removing them from the fieldsToExtract object.
  // As such, let's make a deep copy of it to avoid mutating the caller's object.
  fieldsToExtract = JSON.parse(JSON.stringify(fieldsToExtract));

  const metadata: Record<string, string> = {};

  const messages = [] as OpenAI.Responses.ResponseInput;
  messages.push({
    role: 'developer',
    content: `
The user will show you an image of a page from a PDF document.
Your task will be to extract specific structured fields from this page.

${additionalInstructions ? `Additional Instructions:\n\n${additionalInstructions}` : ''}
`,
  });
  messages.push({
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: '',
      },
      {
        type: 'input_image',
        image_url: '',
        detail: 'high',
      },
    ],
  });

  // Iterate through each page.
  for (let currentPageIndex = 0; currentPageIndex < pagesAsPngBuffers.length; currentPageIndex++) {
    if (Object.keys(fieldsToExtract).length === 0) {
      console.log(`All structured fields have been extracted.`);
      break;
    }

    console.log(
      `Extracting ${Object.keys(fieldsToExtract).length} structured fields ` +
        `from Page ${currentPageIndex + 1} of ${pagesAsPngBuffers.length}`
    );

    const messagesForThisPage = JSON.parse(
      JSON.stringify(messages)
    ) as OpenAI.Responses.ResponseInput;

    const pagePngBuffer = pagesAsPngBuffers[currentPageIndex];
    const imgbuf = pagePngBuffer;
    const imgBase64 = imgbuf.toString('base64');
    const imgDataUrl = `data:image/png;base64,${imgBase64}`;
    (messagesForThisPage[1] as any).content[1].image_url = imgDataUrl;

    (messagesForThisPage[1] as any).content[0].text =
      `Here is Page ${currentPageIndex + 1} of a PDF document.`;

    let sFieldPrompt = '';
    for (const [fieldName, fieldDescription] of Object.entries(fieldsToExtract)) {
      sFieldPrompt += `Field Name: ${fieldName}\nDescription: ${fieldDescription || '(none)'}\n\n`;
    }
    messagesForThisPage.push({
      role: 'developer',
      content: `
Please extract the following structured fields from this page, if you can find them.
If you can't find a field on this page, simply don't provide a value for it.
${sFieldPrompt}
`,
    });

    const llmResponse = await getOpenAIClient().responses.create({
      model: GPT_MODEL_VISION,
      input: messagesForThisPage,
      text: {
        format: {
          type: 'json_schema',
          name: 'ocr_extract_structured_fields',
          description: `The extracted structured fields from the page.`,
          schema: {
            type: 'object',
            properties: {
              fields_found: {
                type: 'array',
                description: `The list of structured fields found on this page.`,
                items: {
                  type: 'object',
                  properties: {
                    field_name: { type: 'string' },
                    field_value: { type: 'string' },
                  },
                  required: ['field_name', 'field_value'],
                  additionalProperties: false,
                },
              },
            },
            required: ['fields_found'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });
    const llmReply = llmResponse.output_text;
    const llmReplyObj = parseJSONfromAIResponse(llmReply);
    const fieldsFound = llmReplyObj.fields_found as Array<{
      field_name: string;
      field_value: string;
    }>;

    for (const field of fieldsFound) {
      metadata[field.field_name] = field.field_value;
      delete fieldsToExtract[field.field_name];
      console.log(`  Extracted field: ${field.field_name} = ${field.field_value}`);
    }
  }

  return metadata;
};

/**
 * Extracts structured metadata fields from document images using a holistic approach.
 *
 * This function sends all pages to the AI model at once in a single request, allowing the model
 * to see the entire document context when extracting metadata. This can improve accuracy when
 * fields require cross-page context or when the AI needs to understand the overall document
 * structure to locate the correct information.
 *
 * Use this approach when:
 * - Metadata fields require context from multiple pages
 * - The document structure is complex and benefits from holistic analysis
 * - Token usage is less of a concern than accuracy
 * - The document is small to medium-sized
 *
 * @param pagesAsPngBuffers - Array of PNG image buffers representing document pages
 * @param fieldsToExtract - Record mapping field names to their descriptions
 * @returns Record containing the extracted field values keyed by field name
 */
export const ocrImageExtractStructuredFieldsHolistic = async (
  pagesAsPngBuffers: Buffer[],
  fieldsToExtract: Record<string, string>,
  additionalInstructions?: string
): Promise<Record<string, string>> => {
  if (!pagesAsPngBuffers || pagesAsPngBuffers.length === 0) {
    return {};
  }
  if (!fieldsToExtract || Object.keys(fieldsToExtract).length === 0) {
    return {};
  }

  const messages = [] as OpenAI.Responses.ResponseInput;
  messages.push({
    role: 'developer',
    content: `
The user will show you images of pages from a PDF document.
Your task will be to extract specific structured fields from these pages.
After we show you the images, we will provide you with a list of structured fields to extract.

${additionalInstructions ? `Additional Instructions:\n\n${additionalInstructions}` : ''}
`,
  });

  for (let currentPageIndex = 0; currentPageIndex < pagesAsPngBuffers.length; currentPageIndex++) {
    const pagePngBuffer = pagesAsPngBuffers[currentPageIndex];
    const imgbuf = pagePngBuffer;
    const imgBase64 = imgbuf.toString('base64');
    const imgDataUrl = `data:image/png;base64,${imgBase64}`;

    messages.push({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `Here is Page ${currentPageIndex + 1} of the PDF document.`,
        },
        {
          type: 'input_image',
          image_url: imgDataUrl,
          detail: 'high',
        },
      ],
    });
  }

  let sFieldPrompt = '';
  for (const [fieldName, fieldDescription] of Object.entries(fieldsToExtract)) {
    sFieldPrompt += `Field Name: ${fieldName}\nDescription: ${fieldDescription || '(none)'}\n\n`;
  }
  messages.push({
    role: 'developer',
    content: `
Please extract the following structured fields from this page, if you can find them.
If you can't find a field on this page, simply don't provide a value for it.
${sFieldPrompt}
`,
  });

  const metadata: Record<string, string> = {};
  const llmResponse = await getOpenAIClient().responses.create({
    model: GPT_MODEL_VISION,
    input: messages,
    text: {
      format: {
        type: 'json_schema',
        name: 'ocr_extract_structured_fields',
        description: `The extracted structured fields from the page.`,
        schema: {
          type: 'object',
          properties: {
            fields_found: {
              type: 'array',
              description: `The list of structured fields found on this page.`,
              items: {
                type: 'object',
                properties: {
                  field_name: { type: 'string' },
                  field_value: { type: 'string' },
                },
                required: ['field_name', 'field_value'],
                additionalProperties: false,
              },
            },
          },
          required: ['fields_found'],
          additionalProperties: false,
        },
        strict: true,
      },
    },
  });
  const llmReply = llmResponse.output_text;
  const llmReplyObj = parseJSONfromAIResponse(llmReply);
  const fieldsFound = llmReplyObj.fields_found as Array<{
    field_name: string;
    field_value: string;
  }>;

  for (const field of fieldsFound) {
    metadata[field.field_name] = field.field_value;
    delete fieldsToExtract[field.field_name];
    console.log(`  Extracted field: ${field.field_name} = ${field.field_value}`);
  }

  return metadata;
};

/**
 * Filters pages to retain only those containing tabular data.
 * @param pagesAsPngBuffers The pages of the PDF as PNG buffers.
 * @param additionalInstructions Optional additional instructions for the LLM.
 * @returns A filtered array of PNG buffers containing only pages with tabular data.
 */
export const ocrFilterImagesForTabularData = async (
  pagesAsPngBuffers: Buffer[],
  additionalInstructions?: string
): Promise<Buffer[]> => {
  const messages = [] as OpenAI.Responses.ResponseInput;
  messages.push({
    role: 'developer',
    content: `
The user will show you an image of a page from a PDF document.
We're looking to extract table data from this document. Before we begin
performing OCR on this page, we'd like to know whether this page even
contains any table data in the first place.

${additionalInstructions || ''}
`,
  });
  messages.push({
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: '',
      },
      {
        type: 'input_image',
        image_url: '',
        detail: 'high',
      },
    ],
  });

  // Iterate through each page.
  const pngBuffersWithTables: Buffer[] = [];
  for (let currentPageIndex = 0; currentPageIndex < pagesAsPngBuffers.length; currentPageIndex++) {
    const messagesForThisPage = JSON.parse(
      JSON.stringify(messages)
    ) as OpenAI.Responses.ResponseInput;

    const pagePngBuffer = pagesAsPngBuffers[currentPageIndex];
    const imgbuf = pagePngBuffer;
    const imgBase64 = imgbuf.toString('base64');
    const imgDataUrl = `data:image/png;base64,${imgBase64}`;
    (messagesForThisPage[1] as any).content[1].image_url = imgDataUrl;

    (messagesForThisPage[1] as any).content[0].text =
      `Here is Page ${currentPageIndex + 1} of a PDF document.`;

    messagesForThisPage.push({
      role: 'developer',
      content: `
Does this page contain any tabular data (i.e., tables)?

${additionalInstructions}
`,
    });

    const llmResponse = await getOpenAIClient().responses.create({
      model: GPT_MODEL_VISION,
      input: messagesForThisPage,
      text: {
        format: {
          type: 'json_schema',
          name: 'ocr_filter_for_tabular_data',
          description: `A simple determination of whether this page contains tabular data.`,
          schema: {
            type: 'object',
            properties: {
              has_tabular_data: {
                type: 'boolean',
                description: `Indicates whether the page contains tabular data.`,
              },
            },
            required: ['has_tabular_data'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });
    const llmReply = llmResponse.output_text;
    const llmReplyObj = parseJSONfromAIResponse(llmReply);
    const hasTabularData = llmReplyObj.has_tabular_data as boolean;

    if (hasTabularData) {
      console.log(`Page ${currentPageIndex + 1} contains tabular data; including for OCR.`);
      pngBuffersWithTables.push(pagePngBuffer);
    } else {
      console.log(`Page ${currentPageIndex + 1} does NOT contain tabular data; skipping.`);
    }
  }

  return pngBuffersWithTables;
};

/**
 * Processes one or more PDF files (or directories containing PDFs) and extracts all table data.
 * This is the main entry point for batch OCR processing.
 *
 * Features:
 * - Accepts single file path, array of paths, or directory paths
 * - Automatically scans directories for PDF files
 * - Extracts tables from each PDF
 * - Optionally extracts structured metadata fields from each file
 * - Provides progress logging for long-running operations
 *
 * @param pdfFilePaths - Single file path, array of paths, or directory paths containing PDFs
 * @param metadataFieldsToExtract - Optional record of metadata fields to extract (field name -> description)
 * @param additionalInstructions - Optional custom instructions to guide the table extraction process
 * @returns Object mapping file paths to their extraction results (tables and metadata)
 */
export const ocrFilesExtractTableData = async (
  pdfFilePaths: string | string[],
  metadataFieldsToExtract?: Record<string, string>,
  additionalInstructions?: string
): Promise<OcrMultiFilesTableExtraction> => {
  if (typeof pdfFilePaths === 'string') {
    pdfFilePaths = [pdfFilePaths];
  }

  const retval: OcrMultiFilesTableExtraction = {};

  let numFilesTotal = pdfFilePaths.length;
  let numFilesDone = 0;
  while (pdfFilePaths.length > 0) {
    const pdfFilePath = pdfFilePaths.shift() as string;
    numFilesDone++;
    console.log(`Processing file: ${pdfFilePath} (${numFilesDone} of ${numFilesTotal})`);

    // Check if the filesystem entry at pdfFilePath exists.
    // If it exists, check if it's a file or a folder.

    if (!fs.existsSync(pdfFilePath)) {
      console.warn(`File does not exist: ${pdfFilePath}`);
      continue;
    }
    const stat = fs.statSync(pdfFilePath);

    // If it's a folder, scan it for all PDF files and add them to the list.
    if (stat.isDirectory()) {
      console.log(`  Is a directory; scanning for PDF files...`);
      const pdfFilesInDir = fs
        .readdirSync(pdfFilePath)
        .filter(f => f.toLowerCase().endsWith('.pdf'))
        .map(f => `${pdfFilePath}/${f}`);
      console.log(`  Found ${pdfFilesInDir.length} PDF files.`);
      pdfFilePaths.push(...pdfFilesInDir);
      numFilesTotal += pdfFilesInDir.length;
      continue;
    }

    if (!stat.isFile()) {
      console.warn(`Not a file: ${pdfFilePath}`);
      continue;
    }

    let pngBuffers = await renderPdfPagesToPngBuffers(pdfFilePath);
    pngBuffers = await ocrFilterImagesForTabularData(pngBuffers, additionalInstructions);

    const tables = await ocrImagesExtractTableDataShotgunned(pngBuffers, additionalInstructions);

    const fileExtraction: OcrTablesFromFile = {
      file: pdfFilePath,
      tables,
    };
    if (metadataFieldsToExtract) {
      const metadata = await ocrImageExtractStructuredFieldsIterative(
        pngBuffers,
        metadataFieldsToExtract
      );
      fileExtraction.metadata = metadata;
    }

    retval[pdfFilePath] = fileExtraction;
  }

  console.log(`Done with extracting tables from PDFs! Processed ${numFilesTotal} files.`);
  return retval;
};
