// Renders a filled "Reply Slip" PDF from a simple, single-page template
// (parent/guardian consent slip for a specific event) — used whenever an
// Event Application marks "Requires Letter to Parent" + "Reply Slip
// Required". Runs entirely client-side (pdf-lib), generated and attached
// automatically at submit time, same pattern as the ACP Form/FRF (see
// acpPdf.js / frfPdf.js).
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'

const INK = rgb(0.08, 0.08, 0.08)
const RED = rgb(0.82, 0.09, 0.09)
const NAVY = rgb(0.086, 0.251, 0.549) // matches --nu-blue-700, used for the corner flourish only

function wrapText(text, font, size, maxWidth) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = trial
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/**
 * @param {object} data
 *   eventTitle — the activity's name (fills every "[insert event]")
 *   subjectDateTimeLabel — combined "Subject / Date / Time" line that
 *     replaces "[insert subject, date, and time of the event]", e.g.
 *     "General Assembly — August 20, 2026, 1:00 PM – 4:00 PM"
 * @returns {Promise<Uint8Array>}
 */
export async function generateReplySlipPdf(data) {
  const doc = await PDFDocument.create()
  // US Letter — this is a plain internal consent slip, not one of the
  // official A4 FMO/university forms.
  const PAGE_W = 612
  const PAGE_H = 792
  const page = doc.addPage([PAGE_W, PAGE_H])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const M = 70
  const W = PAGE_W - M * 2
  let y = PAGE_H - 90

  // ---------- Corner flourish (matches the diagonal navy band on the template) ----------
  page.drawRectangle({
    x: PAGE_W - 150, y: PAGE_H - 40, width: 220, height: 40,
    color: NAVY, rotate: degrees(-20),
  })

  // ---------- Title ----------
  const title = 'Reply Slip'
  page.drawText(title, {
    x: PAGE_W / 2 - bold.widthOfTextAtSize(title, 16) / 2, y, size: 16, font: bold, color: INK,
  })
  y -= 22

  // ---------- Subject/date/time line (red, centered — the bracketed prompt on the template) ----------
  const subjectLine = data.subjectDateTimeLabel || data.eventTitle || ''
  wrapText(subjectLine, bold, 12, W).forEach((line) => {
    page.drawText(line, {
      x: PAGE_W / 2 - bold.widthOfTextAtSize(line, 12) / 2, y, size: 12, font: bold, color: RED,
    })
    y -= 16
  })
  y -= 22

  // ---------- Instructions (red, left-aligned) ----------
  page.drawText('Please attach your signature.', { x: M, y, size: 11, font, color: RED })
  y -= 16
  page.drawText('Note that forging signature will not be tolerated.', { x: M, y, size: 11, font, color: RED })
  y -= 34

  // ---------- Checkboxes ----------
  const eventTitle = data.eventTitle || 'the event'
  const boxSize = 11
  function checkboxLine(label) {
    page.drawRectangle({ x: M + 16, y: y - boxSize + 2, width: boxSize, height: boxSize, borderColor: INK, borderWidth: 1 })
    const lines = wrapText(label, font, 11, W - 40)
    lines.forEach((ln, i) => {
      page.drawText(ln, { x: M + 16 + boxSize + 8, y: y - i * 14, size: 11, font, color: INK })
    })
    y -= 14 * lines.length + 16
  }
  checkboxLine(`Yes, I am allowing my child to join the ${eventTitle}.`)
  checkboxLine(`No, I do not allow my child to join the ${eventTitle}.`)

  // ---------- Signature lines ----------
  y -= 40
  const colGap = 24
  const colW = (W - colGap) / 2
  const lineY = y
  page.drawLine({ start: { x: M, y: lineY }, end: { x: M + colW, y: lineY }, thickness: 1, color: INK })
  page.drawLine({ start: { x: M + colW + colGap, y: lineY }, end: { x: M + colW + colGap + colW, y: lineY }, thickness: 1, color: INK })

  const captionY = lineY - 14
  const cap1 = "Parent's Signature over Printed Name"
  const cap2 = "Student's Printed Name & Section"
  page.drawText(cap1, { x: M + colW / 2 - font.widthOfTextAtSize(cap1, 10) / 2, y: captionY, size: 10, font, color: INK })
  page.drawText(cap2, {
    x: M + colW + colGap + colW / 2 - font.widthOfTextAtSize(cap2, 10) / 2, y: captionY, size: 10, font, color: INK,
  })

  return doc.save()
}
