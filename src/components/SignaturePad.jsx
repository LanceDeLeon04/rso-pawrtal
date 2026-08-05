import { useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import './SignaturePad.css'

// A simple mouse/touch signature pad. Exposes the drawn signature to
// the parent as a PNG data URL via onChange (null while empty).
export default function SignaturePad({ onChange }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const lastPoint = useRef(null)
  const [isEmpty, setIsEmpty] = useState(true)

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

  return (
    <div className="sig-pad">
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
    </div>
  )
}
