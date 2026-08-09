import { useEffect, useRef, useState } from 'react'
import { Eraser, PenLine, Paperclip, X } from 'lucide-react'
import './SignaturePad.css'

// A simple mouse/touch signature pad. Exposes the drawn signature to
// the parent as a PNG data URL via onChange (null while empty).
//
// Remote signers default to drawing a live signature (the pad is always
// shown first). A small "Attach" button on the side lets them switch to
// uploading an image of their signature instead — e.g. someone signing
// from a phone with a shaky touchscreen, or who has a pre-scanned
// signature image they'd rather use. Switching back to "Draw" clears
// whatever was attached, so only one signature source is ever active.
export default function SignaturePad({ onChange }) {
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const drawing = useRef(false)
  const lastPoint = useRef(null)
  const [isEmpty, setIsEmpty] = useState(true)
  const [mode, setMode] = useState('draw') // 'draw' | 'upload' — draw is always the default
  const [uploadPreview, setUploadPreview] = useState(null)
  const [uploadError, setUploadError] = useState('')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Render crisply on high-DPI screens without distorting coordinates.
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.25
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1a1a2e'
  }, [])

  function pointFromEvent(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start(e) {
    e.preventDefault()
    drawing.current = true
    lastPoint.current = pointFromEvent(e)
  }

  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const point = pointFromEvent(e)
    ctx.beginPath()
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPoint.current = point
    if (isEmpty) setIsEmpty(false)
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    lastPoint.current = null
    emitChange()
  }

  function emitChange() {
    const canvas = canvasRef.current
    if (!onChange) return
    onChange(isCanvasBlank(canvas) ? null : canvas.toDataURL('image/png'))
  }

  function isCanvasBlank(canvas) {
    const ctx = canvas.getContext('2d')
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false
    }
    return true
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
    onChange?.(null)
  }

  function switchToDraw() {
    if (mode === 'draw') return
    setMode('draw')
    setUploadPreview(null)
    setUploadError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    // Drawing pad is empty until they draw again — clear whatever the
    // upload had set.
    onChange?.(null)
  }

  function switchToUpload() {
    if (mode === 'upload') return
    // Leaving draw mode wipes the canvas so the two sources never mix.
    clear()
    setMode('upload')
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('Please attach an image file (PNG or JPG).')
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      setUploadError('Image is too large — please attach a file under 3MB.')
      return
    }
    setUploadError('')
    const reader = new FileReader()
    reader.onload = () => {
      setUploadPreview(reader.result)
      onChange?.(reader.result)
    }
    reader.readAsDataURL(file)
  }

  function removeUpload() {
    setUploadPreview(null)
    setUploadError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    onChange?.(null)
  }

  return (
    <div className="sig-pad-wrap">
      <div className="sig-pad">
        {mode === 'draw' ? (
          <>
            <canvas
              ref={canvasRef}
              className="sig-pad__canvas"
              onMouseDown={start}
              onMouseMove={move}
              onMouseUp={end}
              onMouseLeave={end}
              onTouchStart={start}
              onTouchMove={move}
              onTouchEnd={end}
            />
            {isEmpty && <span className="sig-pad__hint">Sign here</span>}
            <button type="button" className="sig-pad__clear" onClick={clear}>
              <Eraser size={14} /> Clear
            </button>
          </>
        ) : (
          <div className="sig-pad__upload">
            {uploadPreview ? (
              <>
                <img src={uploadPreview} alt="Attached signature" className="sig-pad__upload-preview" />
                <button type="button" className="sig-pad__clear" onClick={removeUpload}>
                  <X size={14} /> Remove
                </button>
              </>
            ) : (
              <label className="sig-pad__upload-cta">
                <Paperclip size={18} />
                <span>Attach a signature image</span>
                <span className="sig-pad__upload-hint">PNG or JPG, under 3MB</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFile}
                  hidden
                />
              </label>
            )}
            {uploadError && <p className="sig-pad__upload-error">{uploadError}</p>}
          </div>
        )}
      </div>

      {/* Side rail: live signature is always the first/default option. */}
      <div className="sig-pad-rail">
        <button
          type="button"
          className={`sig-pad-rail__btn${mode === 'draw' ? ' sig-pad-rail__btn--active' : ''}`}
          onClick={switchToDraw}
          title="Draw signature"
        >
          <PenLine size={16} />
        </button>
        <button
          type="button"
          className={`sig-pad-rail__btn${mode === 'upload' ? ' sig-pad-rail__btn--active' : ''}`}
          onClick={switchToUpload}
          title="Attach signature image"
        >
          <Paperclip size={16} />
        </button>
      </div>
    </div>
  )
}
