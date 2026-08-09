// Excel + PDF export for the Dashboard Analytics section.
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

function sheetFromSeries(wb, name, rows, headers = ['Name', 'Value']) {
  const data = [headers, ...rows.map((r) => [r.name, r.value])]
  const ws = XLSX.utils.aoa_to_sheet(data)
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
}

// `sections` = [{ title, rows: [{name, value}], headers? }]
export function exportAnalyticsToExcel({ filename, title, generatedFor, sections }) {
  const wb = XLSX.utils.book_new()

  const summaryRows = [
    ['Report', title],
    ['Scope', generatedFor],
    ['Generated', new Date().toLocaleString('en-PH')],
    [],
  ]
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows)
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary')

  sections.forEach((s) => sheetFromSeries(wb, s.title, s.rows, s.headers))

  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// `sections` = [{ title, rows: [{name, value}], headers? }]
export function exportAnalyticsToPDF({ filename, title, generatedFor, kpis = [], sections }) {
  const doc = new jsPDF()
  const marginX = 14
  let y = 18

  doc.setFontSize(16)
  doc.text(title, marginX, y)
  y += 7
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text(`Scope: ${generatedFor}`, marginX, y)
  y += 5
  doc.text(`Generated: ${new Date().toLocaleString('en-PH')}`, marginX, y)
  y += 8
  doc.setTextColor(0)

  if (kpis.length) {
    autoTable(doc, {
      startY: y,
      head: [['Metric', 'Value']],
      body: kpis.map((k) => [k.label, String(k.value)]),
      theme: 'grid',
      headStyles: { fillColor: [15, 61, 122] },
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 9 },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  sections.forEach((s) => {
    if (y > 260) { doc.addPage(); y = 18 }
    doc.setFontSize(12)
    doc.text(s.title, marginX, y)
    y += 4
    autoTable(doc, {
      startY: y,
      head: [s.headers || ['Name', 'Value']],
      body: s.rows.map((r) => [r.name, String(r.value)]),
      theme: 'striped',
      headStyles: { fillColor: [15, 61, 122] },
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 9 },
    })
    y = doc.lastAutoTable.finalY + 10
  })

  doc.save(`${filename}.pdf`)
}
