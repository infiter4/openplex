import { useRef } from 'react'

export interface DialStop {
  value: string | undefined
  label: string
}

const R = 40
const CIRC = 2 * Math.PI * R

export function ReasoningDial({
  stops,
  value,
  onChange,
  modelInitial,
  modelColor,
}: {
  stops: DialStop[]
  value: string | undefined
  onChange: (v: string | undefined) => void
  modelInitial: string
  modelColor: string
}) {
  const ref = useRef<SVGSVGElement>(null)
  const n = Math.max(stops.length, 1)
  const idx = Math.max(0, stops.findIndex((s) => s.value === value))
  const frac = n > 1 ? idx / (n - 1) : 0
  const offset = CIRC * (1 - frac)
  const ang = frac * 2 * Math.PI - Math.PI / 2
  const hx = 52 + R * Math.cos(ang)
  const hy = 52 + R * Math.sin(ang)

  const pickFromPointer = (e: React.PointerEvent) => {
    const svg = ref.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const a = Math.atan2(e.clientY - cy, e.clientX - cx) + Math.PI / 2
    let f = a / (2 * Math.PI)
    if (f < 0) f += 1
    const nearest = Math.round(f * (n - 1))
    const clamped = Math.max(0, Math.min(n - 1, nearest))
    if (stops[clamped] && stops[clamped].value !== value) onChange(stops[clamped].value)
  }

  return (
    <div className="flex flex-col items-center gap-2 w-[138px]">
      <div className="relative w-[104px] h-[104px] cursor-grab active:cursor-grabbing touch-none">
        <svg
          ref={ref}
          width="104"
          height="104"
          viewBox="0 0 104 104"
          className="block"
          onPointerDown={(e) => {
            ;(e.target as Element).setPointerCapture?.(e.pointerId)
            pickFromPointer(e)
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) pickFromPointer(e)
          }}
        >
          <circle cx="52" cy="52" r="49" fill="none" stroke="var(--line-strong)" strokeWidth="1" opacity=".4" />
          <circle cx="52" cy="52" r={R} fill="none" stroke="var(--line-strong)" strokeWidth="3.5" />
          <circle
            cx="52"
            cy="52"
            r={R}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            transform="rotate(-90 52 52)"
            style={{ transition: 'stroke-dashoffset .25s ease' }}
          />
          <circle cx={hx} cy={hy} r="6" fill="var(--accent)" stroke="var(--bg1)" strokeWidth="2" />
          <circle cx="52" cy="52" r="14" fill={modelColor} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-serif text-[15px] text-white pointer-events-none">
          {modelInitial}
        </span>
      </div>
      <div className="text-center">
        <div className="text-[9px] tracking-[.16em] text-faint font-semibold">REASONING EFFORT</div>
        <div className="flex gap-2 justify-center mt-1.5 flex-wrap">
          {stops.map((s, i) => (
            <button
              key={s.label}
              onClick={() => onChange(s.value)}
              className="op-hover-lift text-[9px] tracking-[.03em] whitespace-nowrap"
              style={{
                fontWeight: i === idx ? 700 : 500,
                color: i === idx ? 'var(--accent)' : 'var(--faint)',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
