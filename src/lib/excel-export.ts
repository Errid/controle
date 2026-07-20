export type ExcelCell = string | number;

type ExcelSheet = {
  name: string;
  tables: Array<{
    title: string;
    headers: string[];
    rows: ExcelCell[][];
  }>;
};

const escapeHtml = (value: ExcelCell) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const sanitizeSheetName = (name: string) =>
  name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);

const sanitizeFilename = (filename: string) =>
  filename
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const renderTable = (table: ExcelSheet["tables"][number]) => `
  <h2>${escapeHtml(table.title)}</h2>
  <table>
    <thead>
      <tr>${table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${table.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
        )
        .join("")}
    </tbody>
  </table>
`;

export function downloadExcelWorkbook(filename: string, sheets: ExcelSheet[]) {
  const workbook = `
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; }
          h1 { font-size: 18px; }
          h2 { font-size: 14px; margin-top: 24px; }
          table { border-collapse: collapse; margin-bottom: 20px; }
          th, td { border: 1px solid #999; padding: 6px 10px; }
          th { background: #f2f2f2; font-weight: bold; }
        </style>
      </head>
      <body>
        ${sheets
          .map(
            (sheet) => `
              <div>
                <h1>${escapeHtml(sanitizeSheetName(sheet.name))}</h1>
                ${sheet.tables.map(renderTable).join("")}
              </div>
            `,
          )
          .join("")}
      </body>
    </html>
  `;

  const blob = new Blob(["\ufeff", workbook], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(filename)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
