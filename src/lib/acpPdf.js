// Renders a filled Activity Concept Paper (ACP) PDF that mirrors the
// paper form — same sections, same order, same field labels — using the
// values collected on the in-app event application form. Runs entirely
// client-side (pdf-lib), so it can be generated and attached the moment
// the student hits Submit, with no manual upload step.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'
import { NU_HEADER_LOGO_PNG_BASE64 } from './acpHeaderLogo'
import { verificationLinkUrl } from './eventVerification'
import { MERCHANDISE_TYPES } from './merchandiseOptions'

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

const NAVY = rgb(0.086, 0.251, 0.549) // matches --nu-blue-700
const GOLD = rgb(0.96, 0.78, 0.20)
const LINE = rgb(0.75, 0.75, 0.75)
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.4, 0.4, 0.4)

const SDG_LABELS = [
  '1. No Poverty', '2. Zero Hunger', '3. Good Health and Well being',
  '4. Quality Education', '5. Gender Equality', '6. Clean Water and Sanitation',
  '7. Affordable and Clean Energy', '8. Decent Work and Economic Growth',
  '9. Industry, Innovation and Infrastructure', '10. Reduced Inequalities',
  '11. Sustainable Cities and Communities', '12. Responsible Consumption and Production',
  '13. Climate Action', '14. Life Below Water', '15. Life on Land',
  '16. Peace, Justice, and Strong Institutions', '17. Partnership for the Goals',
]

const MERCH_TYPE_LABELS = MERCHANDISE_TYPES

const ACTIVITY_TYPE_LABELS = {
  org_activity: 'Student Organization Activity',
  university_activity: 'University/School Activity',
  special_event: 'Special Event',
  other: 'Others',
}

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
 * @param {object} data - submission fields (org name, contact info, ACP fields).
 *   Optionally pass `data.verification = { token, approvedBy, approvedOn }`
 *   once the Academic Director has approved the application — this is the
 *   final regeneration of the ACP and stamps the "AQ Validation" block:
 *   a scannable QR code (linking to /verify/:token) plus the approver
 *   name/date, right above the auto-generated footer note.
 * @param {object} [opts]
 * @param {boolean} [opts.isMerch] - renders the "MERCHANDISE REQUEST FORM"
 *   variant: same layout/fields, but the SDG section is replaced with a
 *   Types of Merchandise checklist (data.merchandiseTypes) and there's no
 *   SDG Representative line.
 * @returns {Promise<Uint8Array>}
 */
export async function generateACPFormPdf(data, opts = {}) {
  const isMerch = !!opts.isMerch
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792]) // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)

  const M = 36 // margin
  const W = 612 - M * 2
  let y = 792 - M

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

  function twoUpRow(l1, v1, l2, v2, height = 16) {
    const half = W / 2
    const labelSize = 8.5
    const neededLw = Math.max(
      bold.widthOfTextAtSize(l1, labelSize),
      bold.widthOfTextAtSize(l2, labelSize),
    ) + 10
    // Leave at least ~60pt for the value column on each side.
    const lw = Math.min(Math.max(neededLw, 70), half - 60)
    const valSize = 9
    const v1Lines = wrapText(String(v1 ?? '—'), font, valSize, half - lw - 10)
    const v2Lines = wrapText(String(v2 ?? '—'), font, valSize, half - lw - 10)
    const lines = Math.max(v1Lines.length, v2Lines.length)
    const rowH = Math.max(height, lines * 11 + 6)

    page.drawRectangle({ x: M, y: y - rowH, width: W, height: rowH, borderColor: LINE, borderWidth: 0.75 })
    page.drawLine({ start: { x: M + half, y }, end: { x: M + half, y: y - rowH }, thickness: 0.75, color: LINE })

    page.drawText(l1, { x: M + 5, y: y - rowH + (rowH - labelSize) - 3, size: labelSize, font: bold, color: INK })
    page.drawLine({ start: { x: M + lw, y }, end: { x: M + lw, y: y - rowH }, thickness: 0.5, color: LINE })
    v1Lines.forEach((ln, i) => {
      page.drawText(ln, { x: M + lw + 5, y: y - rowH + (rowH - valSize) - 3 - i * 11, size: valSize, font, color: INK })
    })

    page.drawText(l2, { x: M + half + 5, y: y - rowH + (rowH - labelSize) - 3, size: labelSize, font: bold, color: INK })
    page.drawLine({ start: { x: M + half + lw, y }, end: { x: M + half + lw, y: y - rowH }, thickness: 0.5, color: LINE })
    v2Lines.forEach((ln, i) => {
      page.drawText(ln, { x: M + half + lw + 5, y: y - rowH + (rowH - valSize) - 3 - i * 11, size: valSize, font, color: INK })
    })
    y -= rowH
  }

  function sectionLabel(text) {
    y -= 12
    page.drawText(text, { x: M, y, size: 9.5, font: bold, color: NAVY })
    y -= 4
  }

  // ---------- Header ----------
  // Real NU Laguna SDAO logo lockup, cropped straight from the official
  // ACP Form PDF, embedded and centered exactly as on the paper form.
  const logoBytes = base64ToBytes(NU_HEADER_LOGO_PNG_BASE64)
  const logoImage = await doc.embedPng(logoBytes)
  const logoW = 230
  const logoH = logoW * (logoImage.height / logoImage.width)
  page.drawImage(logoImage, { x: (612 - logoW) / 2, y: y - logoH, width: logoW, height: logoH })
  y -= logoH + 10

  // Title row: navy "ACTIVITY CONCEPT PAPER (ACP)" bar + bordered
  // "Date of Application" cell on the right — same single row as the
  // original, same proportions (~79% / 21% split).
  const titleRowH = 26
  const dateColW = W * 0.21
  const titleColW = W - dateColW
  page.drawRectangle({ x: M, y: y - titleRowH, width: titleColW, height: titleRowH, color: NAVY })
  page.drawText(isMerch ? 'MERCHANDISE REQUEST FORM' : 'ACTIVITY CONCEPT PAPER (ACP)', {
    x: M + 8, y: y - titleRowH / 2 - 4, size: 12, font: bold, color: rgb(1, 1, 1),
  })
  page.drawRectangle({ x: M + titleColW, y: y - titleRowH, width: dateColW, height: titleRowH, borderColor: rgb(0, 0, 0), borderWidth: 1 })
  page.drawText('Date of Application', { x: M + titleColW + 6, y: y - 9, size: 7, font: bold, color: INK })
  page.drawText(data.applicationDate || '', { x: M + titleColW + 6, y: y - titleRowH + 6, size: 8.5, font, color: INK })
  y -= titleRowH
  y -= 4

  // ---------- 1. Contact Information ----------
  sectionLabel('1. CONTACT INFORMATION')
  row('Student Organization', data.orgName)
  twoUpRow('Contact Person', data.contactPerson, 'Position', data.position)
  row('Email Address', data.email)

  // ---------- 2. Activity Details ----------
  sectionLabel('2. ACTIVITY DETAILS')
  row('Title', data.title)
  row('Type of Activity', data.activityTypeLabel)
  row('Venue Address', data.venueAddress)
  twoUpRow('Target Audience', data.targetAudience, 'Target No. of Participants', data.targetParticipants)
  twoUpRow(
    isMerch ? 'Release Date' : 'Date', data.eventDate,
    isMerch ? 'Merchandise Duration' : 'Time', isMerch ? data.merchandiseDurationLabel : data.timeRange,
  )
  twoUpRow('Projected Budget', data.projectedBudget ? `PHP ${data.projectedBudget}` : 'PHP —', 'Source of Budget', data.budgetSource)

  // ---------- SDGs (event applications) / Types of Merchandise (merch) ----------
  y -= 4
  if (isMerch) {
    bar('TYPES OF MERCHANDISE (Check all that applies)', 14, 8.5)
    const merchSet = new Set(data.merchandiseTypes || [])
    const colW = W / 2
    const rowH = 12.5
    const rows = Math.ceil(MERCH_TYPE_LABELS.length / 2)
    const boxH = rows * rowH + 6
    page.drawRectangle({ x: M, y: y - boxH, width: W, height: boxH, borderColor: LINE, borderWidth: 0.75 })
    for (let i = 0; i < MERCH_TYPE_LABELS.length; i++) {
      const col = i < rows ? 0 : 1
      const r = i < rows ? i : i - rows
      const cx = M + 6 + col * colW
      const cy = y - 12 - r * rowH
      const checked = merchSet.has(MERCH_TYPE_LABELS[i])
      page.drawRectangle({ x: cx, y: cy - 1, width: 8, height: 8, borderColor: INK, borderWidth: 0.75, color: checked ? NAVY : rgb(1, 1, 1) })
      page.drawText(MERCH_TYPE_LABELS[i], { x: cx + 12, y: cy, size: 7.5, font, color: INK })
    }
    y -= boxH
  } else {
    bar('SUSTAINABLE DEVELOPMENT GOALS (Check all that applies)', 14, 8.5)
    const sdgSet = new Set(data.sdgs || [])
    const colW = W / 2
    const rowH = 12.5
    const rows = Math.ceil(SDG_LABELS.length / 2)
    const sdgBoxH = rows * rowH + 6
    page.drawRectangle({ x: M, y: y - sdgBoxH, width: W, height: sdgBoxH, borderColor: LINE, borderWidth: 0.75 })
    for (let i = 0; i < SDG_LABELS.length; i++) {
      const col = i < rows ? 0 : 1
      const r = i < rows ? i : i - rows
      const cx = M + 6 + col * colW
      const cy = y - 12 - r * rowH
      const checked = sdgSet.has(String(i + 1))
      page.drawRectangle({ x: cx, y: cy - 1, width: 8, height: 8, borderColor: INK, borderWidth: 0.75, color: checked ? NAVY : rgb(1, 1, 1) })
      page.drawText(SDG_LABELS[i], { x: cx + 12, y: cy, size: 7.5, font, color: INK })
    }
    y -= sdgBoxH
    page.drawRectangle({ x: M, y: y - 14, width: W, height: 14, borderColor: LINE, borderWidth: 0.75 })
    page.drawText('SDG Representative:', { x: M + 5, y: y - 10, size: 8, font: bold, color: INK })
    page.drawText(data.sdgRepresentative || '—', { x: M + 100, y: y - 10, size: 8.5, font, color: INK })
    y -= 14
  }

  // ---------- Learning Goals ----------
  y -= 4
  bar('LEARNING GOALS/OBJECTIVES OF THE ACTIVITY', 14, 8.5)
  const goals = (data.learningGoals || []).length ? data.learningGoals : ['', '', '']
  for (let i = 0; i < 3; i++) {
    const lines = wrapText(goals[i] || '—', font, 9, W - 25)
    const h = Math.max(14, lines.length * 11 + 4)
    page.drawRectangle({ x: M, y: y - h, width: W, height: h, borderColor: LINE, borderWidth: 0.75 })
    page.drawText(`${i + 1}.)`, { x: M + 5, y: y - h + h - 12, size: 9, font: bold, color: INK })
    lines.forEach((ln, li) => {
      page.drawText(ln, { x: M + 24, y: y - h + h - 12 - li * 11, size: 9, font, color: INK })
    })
    y -= h
  }

  // ---------- Description / rationale ----------
  if (data.description) {
    y -= 12
    page.drawText('Description / Rationale', { x: M, y, size: 9, font: bold, color: NAVY })
    y -= 12
    const lines = wrapText(data.description, font, 9, W)
    lines.slice(0, 6).forEach((ln) => {
      page.drawText(ln, { x: M, y, size: 9, font, color: INK })
      y -= 11
    })
  }

  // ---------- AQ Validation block (only once Director-approved) ----------
  // Baked in the moment the Academic Director gives final approval (see
  // SubmissionBin's approval handler) — this is the last of the three ACP
  // regenerations (blank at submission -> SDG marks after the SDG Rep
  // signs off -> this final AQ-Validated copy). It carries a scannable
  // QR code pointing at the public /verify/:token page, so anyone holding
  // a printed copy of this ACP can confirm on the spot that it's a
  // genuine, AQ-validated, approved activity. Anchored just above the
  // (fixed-position) footer rather than inline in the flow above, so it
  // always lands in the same spot regardless of how much room the
  // sections above it took up.
  if (data.verification?.token) {
    const boxH = 78
    const footerTopY = 70 + 14 // matches the footer's gold rule below
    const boxTopY = footerTopY + 10 + boxH
    page.drawRectangle({ x: M, y: boxTopY - boxH, width: W, height: boxH, borderColor: GOLD, borderWidth: 1.25, color: rgb(0.98, 0.98, 0.95) })

    const qrSize = 62
    const qrX = M + 10
    const qrY = boxTopY - boxH + (boxH - qrSize) / 2
    try {
      const qrUrl = verificationLinkUrl(data.verification.token)
      const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 0, width: 256, color: { dark: '#16264d', light: '#ffffff' } })
      const qrBytes = base64ToBytes(qrDataUrl.split(',')[1])
      const qrImage = await doc.embedPng(qrBytes)
      page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize })
    } catch (qrErr) {
      // If QR generation fails for any reason, still print the approval
      // details below — the form just won't have a scannable code.
      // eslint-disable-next-line no-console
      console.error('Failed to embed verification QR code', qrErr)
    }

    const textX = qrX + qrSize + 14
    const textW = W - (qrSize + 14) - 20
    let ty = boxTopY - 16
    page.drawText('AQ VALIDATION — APPROVED & VERIFIED ACTIVITY', { x: textX, y: ty, size: 9.5, font: bold, color: NAVY })
    ty -= 15
    page.drawText('Approved by', { x: textX, y: ty, size: 7.5, font: bold, color: MUTED })
    page.drawText(data.verification.approvedBy || '—', { x: textX + 68, y: ty, size: 8.5, font, color: INK })
    ty -= 12
    page.drawText('Approved on', { x: textX, y: ty, size: 7.5, font: bold, color: MUTED })
    page.drawText(data.verification.approvedOn || '—', { x: textX + 68, y: ty, size: 8.5, font, color: INK })
    ty -= 15
    wrapText('Scan the QR code to verify this activity is AQ-validated, genuinely approved, and on record with SDAO.', italic, 7.5, textW)
      .forEach((ln) => { page.drawText(ln, { x: textX, y: ty, size: 7.5, font: italic, color: MUTED }); ty -= 9.5 })
  }

  // ---------- Footer note (signatories intentionally omitted) ----------
  y = 70
  page.drawLine({ start: { x: M, y: y + 14 }, end: { x: 612 - M, y: y + 14 }, thickness: 1.5, color: GOLD })
  const formNoun = isMerch ? 'merchandise proposal' : 'event application'
  const formAbbrev = isMerch ? 'Merchandise Request Form' : 'ACP'
  page.drawText(
    data.verification?.token
      ? `This ${formAbbrev} was generated automatically from the RSO PAWrtal ${formNoun} and has passed AQ Validation.`
      : `This ${formAbbrev} was generated automatically from the RSO PAWrtal ${formNoun}. Review, approval, and`,
    { x: M, y, size: 7.5, font: italic, color: MUTED }
  )
  page.drawText(
    data.verification?.token
      ? 'See the QR code above, or the submission record, for full approval status and history.'
      : 'signatory sign-off happen digitally within the submission record — see the application for status and history.',
    { x: M, y: y - 10, size: 7.5, font: italic, color: MUTED }
  )
  page.drawText(
    'Km. 53, Pan Philippine Highway, Brgy. Milagrosa, Calamba City, Laguna 4027   tel:(049) 572-3356',
    { x: M, y: y - 24, size: 7, font, color: MUTED }
  )

  return doc.save()
}

// Thin wrapper — the Merchandise Request Form is the ACP Form renderer
// with `isMerch: true` (see generateACPFormPdf's `opts` param): same
// sections/order/labels, no SDG section (Types of Merchandise checklist
// in its place, sourced from `data.merchandiseTypes`), no SDG
// Representative line.
export async function generateMerchRequestFormPdf(data) {
  return generateACPFormPdf(data, { isMerch: true })
}
