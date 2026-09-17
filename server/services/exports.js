import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { AppError } from '../utils/http.js';
// Return completed buffers so generation failures still receive standard JSON errors.
export async function exportFile(res, { title, columns, rows, format, subtitle = '' }) {
  const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (format === 'excel') {
    const book = new ExcelJS.Workbook();
    book.creator = 'admiki HRM';
    book.created = new Date();
    const sheet = book.addWorksheet('Report', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: c.width || 22 }));
    sheet.addRows(
      rows.map((row) =>
        Object.fromEntries(
          columns.map((c) => [
            c.key,
            typeof row[c.key] === 'string' && /^[=+@\-\t\r]/.test(row[c.key])
              ? `'${row[c.key]}`
              : (row[c.key] ?? ''),
          ]),
        ),
      ),
    );
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.eachRow((row) => {
      row.alignment = { vertical: 'top', wrapText: true };
    });
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B51' } };
    sheet.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };
    const buffer = await book.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      'Cache-Control': 'no-store',
    });
    return res.send(Buffer.from(buffer));
  }
  if (format !== 'pdf') throw new AppError(400, 'Format must be pdf or excel');
  const buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: columns.length > 5 ? 'landscape' : 'portrait',
      margin: 36,
      bufferPages: true,
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const width = doc.page.width - 72;
    const colWidth = width / columns.length;
    function header() {
      doc.fillColor('#176B51').font('Helvetica-Bold').fontSize(18).text(title);
      doc
        .moveDown(0.3)
        .fillColor('#64748b')
        .font('Helvetica')
        .fontSize(8)
        .text(`${subtitle} | Generated ${new Date().toISOString().slice(0, 10)}`);
      doc.moveDown();
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8);
      const headerHeight = Math.max(
        30,
        ...columns.map((c) => doc.heightOfString(c.label, { width: colWidth - 8 }) + 16),
      );
      doc.rect(36, y, width, headerHeight).fill('#e7f2ed');
      columns.forEach((c, i) =>
        doc
          .fillColor('#16382c')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(c.label, 40 + i * colWidth, y + 8, {
            width: colWidth - 8,
            height: headerHeight - 12,
          }),
      );
      doc.y = y + headerHeight + 6;
    }
    header();
    if (!rows.length)
      doc.font('Helvetica').fillColor('#64748b').text('No records match these filters.');
    rows.forEach((row, index) => {
      const values = columns.map((c) => String(row[c.key] ?? '—'));
      doc.font('Helvetica').fontSize(8);
      const height = Math.max(
        26,
        ...values.map((v) => doc.heightOfString(v, { width: colWidth - 8 }) + 12),
      );
      if (doc.y + height > doc.page.height - 60) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      if (index % 2 === 0) doc.rect(36, y, width, height).fill('#f7f9f8');
      values.forEach((v, i) =>
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#24342d')
          .text(v, 40 + i * colWidth, y + 6, { width: colWidth - 8, height: height - 6 }),
      );
      doc.y = y + height;
    });
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .fillColor('#64748b')
        .text(
          `Confidential · admiki HRM · Page ${i + 1} of ${range.count}`,
          36,
          doc.page.height - 40,
          { lineBreak: false },
        );
    }
    doc.end();
  });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}.pdf"`,
    'Cache-Control': 'no-store',
  });
  res.send(buffer);
}
