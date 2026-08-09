// Renders a filled NU Laguna FMO "School Facilities Reservation Form"
// (FRF) PDF that is a visual replica of the official paper form — same
// header lockup, same section bars, same field grid, same checklist —
// populated with data pulled from an approved RSO PAWrtal event
// application. One FRF is generated per distinct venue/facility the
// event uses (see buildFacilityReservationGroups in SubmissionBin.jsx):
// "1 Venue = 1 FRF", so a two-venue event yields two of these PDFs.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'
import { FRF_HEADER_LOGO_PNG_BASE64 } from './frfHeaderLogo'

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

// Colors sampled directly from the official FRF PDF so the generated
// form matches it as closely as possible.
const NAVY = rgb(42 / 255, 38 / 255, 109 / 255)
const LABEL_FILL = rgb(205 / 255, 214 / 255, 255 / 255)
const BORDER = rgb(153 / 255, 172 / 255, 255 / 255)
const GRAY_BOX = rgb(217 / 255, 217 / 255, 217 / 255)
const INK = rgb(0.07, 0.07, 0.07)
const WHITE = rgb(1, 1, 1)

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
 *   requestorName, orgName, position, contactNumber, email,
 *   venueName, eventDateLabel, timeRangeLabel, eventName, expectedAttendance,
 *   initialReviewName, adviserName, deanName, directorName, fmoHeadName,
 *   docCode (printed under the QR, e.g. 'LAG-ADM-FMO-D-PO-001')
 * @returns {Promise<Uint8Array>}
 */
export async function generateFacilityReservationFormPdf(data) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792]) // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)
  const boldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique)

  const M = 36
  const W = 612 - M * 2
  let y = 792 - M

  // ---------- Header: logo lockup + QR ----------
  const logoBytes = base64ToBytes(FRF_HEADER_LOGO_PNG_BASE64)
  const logoImage = await doc.embedPng(logoBytes)
  const logoW = 280
  const logoH = logoW * (logoImage.height / logoImage.width)
  const qrSize = 64
  const qrX = 612 - M - qrSize
  const headerH = Math.max(logoH, qrSize + 18)

  page.drawImage(logoImage, { x: M, y: y - headerH / 2 - logoH / 2, width: logoW, height: logoH })

  const qrTopY = y
  try {
    const qrDataUrl = await QRCode.toDataURL(data.docCode || 'LAG-ADM-FMO-D-PO-001', {
      margin: 0, width: 256, color: { dark: '#2a266d', light: '#ffffff' },
    })
    const qrBytes = base64ToBytes(qrDataUrl.split(',')[1])
    const qrImage = await doc.embedPng(qrBytes)
    page.drawImage(qrImage, { x: qrX, y: qrTopY - qrSize, width: qrSize, height: qrSize })
  } catch (qrErr) {
    // eslint-disable-next-line no-console
    console.error('Failed to embed FRF QR code', qrErr)
  }
  const docCodeText = data.docCode || 'LAG-ADM-FMO-D-PO-001'
  page.drawText(docCodeText, {
    x: qrX + qrSize / 2 - font.widthOfTextAtSize(docCodeText, 6.5) / 2,
    y: qrTopY - qrSize - 10, size: 6.5, font, color: rgb(0.3, 0.3, 0.3),
  })

  y -= headerH + 14

  // ---------- Section bar ----------
  function bar(text, height = 22, size = 12) {
    page.drawRectangle({ x: M, y: y - height, width: W, height, color: NAVY })
    page.drawText(text, { x: M + 8, y: y - height / 2 - size / 2 + 2, size, font: bold, color: WHITE })
    y -= height
  }

  // ---------- Gray disclaimer box ----------
  function disclaimerBox() {
    const h = 52
    page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: GRAY_BOX })
    let ty = y - 14
    page.drawText('By signing this form, the requestor confirms they have read, understood, and agreed to the', {
      x: M + 8, y: ty, size: 9, font, color: INK,
    })
    ty -= 13
    page.drawText('\u201cPolicies and Responsibilities under Section IV & Section V of the FMO Facility Reservation Policies and Procedures\u201d.', {
      x: M + 8, y: ty, size: 9, font: bold, color: INK,
    })
    ty -= 13
    let tx = M + 8
    const parts = [
      { t: 'Please ', f: font, c: INK },
      { t: 'Scan the ', f: italic, c: rgb(0.24, 0.24, 0.55) },
      { t: 'QR Code', f: boldItalic, c: rgb(0.16, 0.15, 0.43) },
      { t: ' to view the ', f: italic, c: rgb(0.24, 0.24, 0.55) },
      { t: 'Facility Reservation Policies and Procedures.', f: bold, c: rgb(0.16, 0.15, 0.43) },
    ]
    parts.forEach((p) => {
      page.drawText(p.t, { x: tx, y: ty, size: 9, font: p.f, color: p.c })
      tx += p.f.widthOfTextAtSize(p.t, 9)
    })
    y -= h
  }

  // ---------- Field box: label band (filled) + value band (white) ----------
  function fieldBox(x, w, label, value, h = 50, labelH = 26, subLabel = null) {
    page.drawRectangle({ x, y: y - h, width: w, height: h, color: WHITE, borderColor: BORDER, borderWidth: 1.25 })
    page.drawRectangle({ x, y: y - labelH, width: w, height: labelH, color: LABEL_FILL, borderColor: BORDER, borderWidth: 1.25 })
    if (subLabel) {
      page.drawText(label, { x: x + 8, y: y - 13, size: 10, font: bold, color: INK })
      page.drawText(subLabel, { x: x + 8, y: y - labelH + 7, size: 7.5, font, color: rgb(0.25, 0.25, 0.25) })
    } else {
      page.drawText(label, { x: x + 8, y: y - labelH / 2 - 4, size: 10.5, font: bold, color: INK })
    }
    const lines = wrapText(value || '', font, 9.5, w - 16)
    lines.slice(0, 2).forEach((ln, i) => {
      page.drawText(ln, { x: x + 8, y: y - labelH - 15 - i * 12, size: 9.5, font, color: INK })
    })
  }

  function fieldRow(cols, h = 50, labelH = 26, gap = 6) {
    const totalGap = gap * (cols.length - 1)
    const totalWeight = cols.reduce((s, c) => s + (c.weight ?? 1), 0)
    let x = M
    cols.forEach((c) => {
      const w = ((W - totalGap) * (c.weight ?? 1)) / totalWeight
      fieldBox(x, w, c.label, c.value, h, labelH, c.subLabel)
      x += w + gap
    })
    y -= h
    y -= 8
  }

  // ---------- 1. Requestor Agreement & Details ----------
  bar('REQUESTOR AGREEMENT & DETAILS')
  disclaimerBox()
  y -= 10
  fieldRow([
    { label: 'Name of Requestor', value: data.requestorName },
    { label: 'Signature of Requestor', value: '' },
    { label: 'School/Office/Organization', value: data.orgName },
  ])
  fieldRow([
    { label: 'Position/Title/Program', value: data.position },
    { label: 'Contact Number', value: data.contactNumber },
    { label: 'Email', value: data.email },
  ])

  // ---------- 2. Reservation Request Details ----------
  y -= 6
  bar('RESERVATION REQUEST DETAILS')
  y -= 4
  fieldRow([
    { label: 'Facility/Venue Requested', value: data.venueName },
    { label: 'Event Date', value: data.eventDateLabel },
    { label: 'Time Duration', value: data.timeRangeLabel },
  ])
  fieldRow([
    { label: 'Event Name', value: data.eventName, weight: 2 },
    { label: 'Expected Attendance / PAX', value: data.expectedAttendance, weight: 1 },
  ])

  // ---------- Equipment Needed & Special Request ----------
  const eqH = 108
  const eqLabelH = 26
  page.drawRectangle({ x: M, y: y - eqH, width: W, height: eqH, color: WHITE, borderColor: BORDER, borderWidth: 1.25 })
  page.drawRectangle({ x: M, y: y - eqLabelH, width: W, height: eqLabelH, color: LABEL_FILL, borderColor: BORDER, borderWidth: 1.25 })
  page.drawText('Equipment Needed & Special Request (Please specify.)', { x: M + 8, y: y - eqLabelH / 2 - 4, size: 10.5, font: bold, color: INK })

  // Three equal columns: Tables/Chairs/Sound System | Podium/Stage/Flag | Others/Remark(s)
  const eqColW = W / 3
  const col1X = M + 18
  const col2X = M + eqColW + 18
  const col3X = M + eqColW * 2 + 18
  const items = ['Tables', 'Chairs', 'Sound System']
  const items2 = ['Podium', 'Stage', 'Flag']
  let iy = y - eqLabelH - 24
  for (let i = 0; i < 3; i++) {
    page.drawEllipse({ x: col1X, y: iy + 3, xScale: 6, yScale: 6, borderColor: INK, borderWidth: 1 })
    page.drawText(items[i], { x: col1X + 14, y: iy, size: 10, font, color: INK })
    const lineStart1 = col1X + 14 + font.widthOfTextAtSize(items[i], 10) + 12
    page.drawLine({ start: { x: lineStart1, y: iy - 1 }, end: { x: col2X - 14, y: iy - 1 }, thickness: 0.75, color: INK })

    page.drawEllipse({ x: col2X, y: iy + 3, xScale: 6, yScale: 6, borderColor: INK, borderWidth: 1 })
    page.drawText(items2[i], { x: col2X + 14, y: iy, size: 10, font, color: INK })
    const lineStart2 = col2X + 14 + font.widthOfTextAtSize(items2[i], 10) + 12
    page.drawLine({ start: { x: lineStart2, y: iy - 1 }, end: { x: col3X - 14, y: iy - 1 }, thickness: 0.75, color: INK })
    iy -= 22
  }

  let remarksY = y - eqLabelH - 21
  page.drawText('Others/Remark(s):', { x: col3X, y: remarksY, size: 10, font, color: INK })
  for (let i = 0; i < 3; i++) {
    remarksY -= 18
    page.drawLine({ start: { x: col3X, y: remarksY }, end: { x: M + W - 12, y: remarksY }, thickness: 0.75, color: INK })
  }

  y -= eqH
  y -= 10

  // ---------- 3. Approval Status ----------
  bar('APPROVAL STATUS')
  y -= 4
  const approvalRowH = 46
  const approvalLabelH = 30
  fieldRow([
    { label: 'Initial Review (SDAO)', subLabel: '(Student Activity)', value: data.initialReviewName, weight: 1 },
    { label: 'Review & Endorsed by:', subLabel: '(Adviser/Program Chair)', value: data.adviserName, weight: 1 },
    { label: 'Endorsed by:', subLabel: '(Unit Head/School Dean)', value: data.deanName, weight: 1 },
  ], approvalRowH, approvalLabelH)
  fieldRow([
    { label: 'Approved by:', subLabel: '(Executive/Acad/Admin Director)', value: data.directorName, weight: 4 },
    { label: 'Approved & Recorded by:', subLabel: '(Facilities Management Office, HEAD)', value: data.fmoHeadName, weight: 5 },
  ], approvalRowH, approvalLabelH)

  // ---------- Footer form code ----------
  page.drawText('LAG-ADM-FMO-F-001', {
    x: 612 - M - font.widthOfTextAtSize('LAG-ADM-FMO-F-001', 8), y: 24, size: 8, font: bold, color: rgb(0.3, 0.3, 0.3),
  })

  return doc.save()
}
