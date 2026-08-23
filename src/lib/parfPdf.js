// Renders the Post-Activity Request Form (PARF) — auto-filled from the
// event's already-approved ACP data, the same way generateACPFormPdf
// auto-fills from the in-app application form. Generated the moment a
// report is submitted (no manual "upload the PARF yourself" step), then
// regenerated after each signer in the chain (Treasurer -> Auditor ->
// Secretary -> Adviser -> Dean, see migration 082 / lib/reportApprovals.js)
// so the attached PDF always reflects who has signed so far.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { NU_HEADER_LOGO_PNG_BASE64 } from './acpHeaderLogo'

function base64ToBytes(base64) {
  if (typeof atob === 'function') {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  // eslint-disable-next-line no-undef
  return Uint8Array.from(Buffer.from(base64, 'base64'))
}

const NAVY = rgb(0.086, 0.251, 0.549)
const LINE = rgb(0.75, 0.75, 0.75)
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.4, 0.4, 0.4)
const OK = rgb(0.11, 0.45, 0.2)

// Mirrors REPORT_ROLE_LABELS in lib/reportApprovals.js — kept as a
// plain literal here so parfPdf.js has no circular/UI-layer imports.
const SIGNATORY_ROLES = [
  { role: 'treasurer', label: 'Treasurer / Finance' },
  { role: 'auditor', label: 'Auditor' },
  { role: 'secretary', label: 'Secretary' },
  { role: 'adviser', label: 'Adviser' },
  { role: 'dean', label: 'Dean' },
]

function wrapText(text, font, size, maxWidth) {
  const words = (text || '').split(/\s+/).filter(Boolean)
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
 * @param {string} data.orgName
 * @param {string} data.eventTitle
 * @param {string} data.eventDateLabel - already-formatted date (or "Year-Round"/"Term X")
 * @param {string} data.venueLabel
 * @param {string} data.contactPerson
 * @param {string} data.filedDate - ISO date this PARF was generated/refreshed
 * @param {object} [data.signatories] - { [role]: { personName, status, decidedAt } },
 *   from officers/link rows (approval_links). Roles not present are shown
 *   as "Pending".
 * @returns {Promise<Uint8Array>}
 */
export async function generatePARFPdf(data) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const M = 36
  const W = 612 - M * 2
  let y = 792 - M

  try {
    const logo = await doc.embedPng(base64ToBytes(NU_HEADER_LOGO_PNG_BASE64))
    const logoW = 160
    const logoH = (logo.height / logo.width) * logoW
    page.drawImage(logo, { x: M, y: y - logoH, width: logoW, height: logoH })
    y -= logoH + 6
  } catch {
    // Header logo is optional — a missing/corrupt asset shouldn't block
    // report filing.
  }

  page.drawText('POST-ACTIVITY REQUEST FORM (PARF)', { x: M, y: y - 14, size: 14, font: bold, color: NAVY })
  y -= 24
  page.drawText('Student Development and Activities Office (SDAO)', { x: M, y: y - 10, size: 9, font, color: MUTED })
  y -= 20

  function bar(text, height = 16, size = 9.5) {
    page.drawRectangle({ x: M, y: y - height, width: W, height, color: NAVY })
    page.drawText(text, { x: M + 6, y: y - height + (height - size) / 2 + 1, size, font: bold, color: rgb(1, 1, 1) })
    y -= height
  }

  function row(label, value, opts = {}) {
    const labelW = opts.labelW ?? 150
    const valueLines = wrapText(value || '—', font, 9, W - labelW - 10)
    const height = opts.height || Math.max(16, valueLines.length * 11 + 6)
    page.drawRectangle({ x: M, y: y - height, width: W, height, borderColor: LINE, borderWidth: 0.75 })
    page.drawLine({ start: { x: M + labelW, y }, end: { x: M + labelW, y: y - height }, thickness: 0.75, color: LINE })
    page.drawText(label, { x: M + 5, y: y - height + (height - 8.5) - 3, size: 8.5, font: bold, color: INK })
    valueLines.forEach((ln, i) => {
      page.drawText(ln, { x: M + labelW + 5, y: y - height + (height - 9) - 3 - i * 11, size: 9, font, color: INK })
    })
    y -= height
  }

  bar('EVENT DETAILS')
  row('Organization', data.orgName)
  row('Activity Title', data.eventTitle)
  row('Date', data.eventDateLabel)
  row('Venue / Platform', data.venueLabel)
  row('Filed By', data.contactPerson)
  row('Date Filed', data.filedDate)

  y -= 10
  bar('SIGNATORIES')
  const rowH = 20
  const labelW = 170
  const statusW = 110
  page.drawRectangle({ x: M, y: y - rowH, width: W, height: rowH, color: rgb(0.93, 0.94, 0.96) })
  page.drawText('Role', { x: M + 5, y: y - rowH + 6, size: 8.5, font: bold, color: INK })
  page.drawText('Name', { x: M + labelW + 5, y: y - rowH + 6, size: 8.5, font: bold, color: INK })
  page.drawText('Status', { x: M + W - statusW + 5, y: y - rowH + 6, size: 8.5, font: bold, color: INK })
  y -= rowH

  for (const { role, label } of SIGNATORY_ROLES) {
    const sig = data.signatories?.[role]
    const status = sig?.status === 'approved'
      ? `Signed${sig.decidedAt ? ` (${sig.decidedAt})` : ''}`
      : sig?.status === 'rejected' ? 'Returned' : 'Pending'
    page.drawRectangle({ x: M, y: y - rowH, width: W, height: rowH, borderColor: LINE, borderWidth: 0.75 })
    page.drawText(label, { x: M + 5, y: y - rowH + 6, size: 9, font: bold, color: INK })
    page.drawText(sig?.personName || '—', { x: M + labelW + 5, y: y - rowH + 6, size: 9, font, color: INK })
    page.drawText(status, {
      x: M + W - statusW + 5, y: y - rowH + 6, size: 9, font: bold,
      color: sig?.status === 'approved' ? OK : sig?.status === 'rejected' ? rgb(0.7, 0.15, 0.15) : MUTED,
    })
    y -= rowH
  }

  y -= 16
  page.drawText(
    'This form is auto-generated and refreshed as each signatory completes their review; it is not valid until every role above reads "Signed."',
    { x: M, y, size: 7.5, font, color: MUTED },
  )

  return doc.save()
}
