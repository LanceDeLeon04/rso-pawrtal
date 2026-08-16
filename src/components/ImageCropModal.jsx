import { useEffect, useRef, useState } from 'react'
import { Loader2, X, ZoomIn, Check } from 'lucide-react'
import './ImageCropModal.css'

// Viewport (visible crop area) and output (exported image) sizes, in px.
// Square/circle avatar crop — used for profile photos, the developer
// photo, and administrator photos on the About page.
const VIEWPORT = 260
const OUTPUT = 512

// Shown right after a user picks a file for any avatar-style upload,
// so they can reposition/zoom before it's actually saved. Nothing is
// uploaded until "Save Photo" is pressed — onConfirm receives a File
// ready to hand to the same upload logic the caller already had.
export default function ImageCropModal({ file, onCancel, onConfirm, uploading }) {
  const [imgUrl, setImgUrl] = useState('')
  const [naturalSize, setNaturalSize] = useState(null) // { w, h }
  const [baseScale, setBaseScale] = useState(1) // scale that makes the image "cover" the viewport at zoom=1
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragState = useRef(null)
  const imgRef = useRef(null)

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setImgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function handleImgLoad() {
    const el = imgRef.current
    if (!el) return
    const w = el.naturalWidth
    const h = el.naturalHeight
    const cover = Math.max(VIEWPORT / w, VIEWPORT / h)
    setNaturalSize({ w, h })
    setBaseScale(cover)
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  function clampOffset(next, effectiveZoom) {
    if (!naturalSize) return next
    const dispW = naturalSize.w * baseScale * effectiveZoom
    const dispH = naturalSize.h * baseScale * effectiveZoom
    const maxX = Math.max(0, (dispW - VIEWPORT) / 2)
    const maxY = Math.max(0, (dispH - VIEWPORT) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    }
  }

  function handleZoomChange(e) {
    const z = Number(e.target.value)
    setZoom(z)
    setOffset((prev) => clampOffset(prev, z))
  }

  function handlePointerDown(e) {
    dragState.current = { startX: e.clientX, startY: e.clientY, origin: offset }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function handlePointerMove(e) {
    if (!dragState.current) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    setOffset(clampOffset({ x: dragState.current.origin.x + dx, y: dragState.current.origin.y + dy }, zoom))
  }

  function handlePointerUp() {
    dragState.current = null
  }

  function handleConfirm() {
    if (!naturalSize) return
    const effectiveScale = baseScale * zoom
    const dispW = naturalSize.w * effectiveScale
    const dispH = naturalSize.h * effectiveScale
    const imgLeft = VIEWPORT / 2 - dispW / 2 + offset.x
    const imgTop = VIEWPORT / 2 - dispH / 2 + offset.y

    const sx = -imgLeft / effectiveScale
    const sy = -imgTop / effectiveScale
    const sSize = VIEWPORT / effectiveScale

    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgRef.current, sx, sy, sSize, sSize, 0, 0, OUTPUT, OUTPUT)

    canvas.toBlob((blob) => {
      if (!blob) return
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const outFile = new File([blob], `cropped-${Date.now()}.${ext === 'png' ? 'png' : 'jpg'}`, {
        type: blob.type || file.type,
      })
      onConfirm(outFile)
    }, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92)
  }

  return (
    <div className="icrop-backdrop" onClick={onCancel}>
      <div className="icrop-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icrop-close" onClick={onCancel}><X size={16} /></button>
        <h3 className="icrop-title">Adjust Photo</h3>
        <p className="icrop-hint">Drag to reposition, use the slider to zoom. Nothing is saved until you confirm.</p>

        <div
          className="icrop-viewport"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {imgUrl && (
            <img
              ref={imgRef}
              src={imgUrl}
              alt=""
              draggable={false}
              onLoad={handleImgLoad}
              className="icrop-img"
              style={{
                width: naturalSize ? naturalSize.w * baseScale * zoom : 'auto',
                height: naturalSize ? naturalSize.h * baseScale * zoom : 'auto',
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
        </div>

        <div className="icrop-zoom-row">
          <ZoomIn size={14} />
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={handleZoomChange}
            disabled={!naturalSize}
          />
        </div>

        <div className="icrop-actions">
          <button type="button" className="icrop-btn icrop-btn--outline" onClick={onCancel} disabled={uploading}>
            Cancel
          </button>
          <button type="button" className="icrop-btn icrop-btn--gold" onClick={handleConfirm} disabled={uploading || !naturalSize}>
            {uploading ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save Photo
          </button>
        </div>
      </div>
    </div>
  )
}
