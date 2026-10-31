import { useId } from 'react'
import type { ReactNode } from 'react'

export function StrawberrySprig({ className = '' }: { className?: string }) {
  const id = useId()
  return (
    <svg className={`strawberry-sprig ${className}`} viewBox="0 0 160 100" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-berry`} x2=".8" y2="1"><stop stopColor="#ffb5c3" /><stop offset=".55" stopColor="#ed6f8c" /><stop offset="1" stopColor="#c44b70" /></linearGradient>
        <linearGradient id={`${id}-leaf`} x2="1" y2="1"><stop stopColor="#b4cba4" /><stop offset="1" stopColor="#557957" /></linearGradient>
      </defs>
      <g fill={`url(#${id}-leaf)`} stroke="#597552" strokeWidth="1">
        <path d="M67 51Q18 59 12 25q35-4 55 26ZM59 42Q27 23 39 9q26 6 28 36ZM94 47q12-38 39-30-3 29-39 30ZM104 56q25-30 47-13-12 26-47 13Z" />
        <path d="m15 27 49 24M42 13l23 32m65-25-31 25m47 0-38 10" stroke="#e4ebd5" />
      </g>
      {[{ x: 51, y: 58, r: -21 }, { x: 103, y: 60, r: 23 }].map(({ x, y, r }) => (
        <g key={x} transform={`translate(${x} ${y}) rotate(${r})`}>
          <path d="M-23-8C-32 10-7 36 0 36S32 10 23-8C18-21 7-19 0-14c-7-5-18-7-23 6Z" fill={`url(#${id}-berry)`} stroke="#b45c72" strokeWidth="1.3" />
          <path d="m0-13-15-13 4 15-15 4 19 2L0-13 7-5l19-2-15-4 4-15Z" fill={`url(#${id}-leaf)`} stroke="#597552" />
          {[-12, 0, 12].flatMap((sx, i) => [0, 11, 21].map((sy, j) => <ellipse key={`${i}-${j}`} cx={sx * (1 - sy / 50)} cy={sy + (i % 2) * 4} rx="1" ry="2.1" fill="#fff4d5" transform={`rotate(-15 ${sx} ${sy})`} />))}
          <path d="M-17-3q-4 8 3 17" stroke="#ffd6db" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      ))}
      <g transform="translate(80 30)" stroke="#d3afa2" strokeWidth=".7">
        {[0, 72, 144, 216, 288].map(angle => <ellipse key={angle} cy="-11" rx="10" ry="15" fill="#fffdf1" transform={`rotate(${angle})`} />)}
        <circle r="6.5" fill="#eed08b" /><circle r="3" fill="#c8984c" stroke="none" />
      </g>
    </svg>
  )
}

export function RibbonBow({ className = '' }: { className?: string }) {
  const id = useId()
  return (
    <svg className={`ribbon-bow ${className}`} viewBox="0 0 180 106" fill="none" aria-hidden="true" focusable="false">
      <defs><linearGradient id={id} x2=".3" y2="1"><stop stopColor="#ffe7eb" /><stop offset=".35" stopColor="#f6afc6" /><stop offset=".65" stopColor="#e587a7" /><stop offset="1" stopColor="#ffd5df" /></linearGradient></defs>
      <g fill={`url(#${id})`} stroke="#bd6e89" strokeWidth="1.2" strokeLinejoin="round">
        <path d="M80 44Q63 75 50 100l21-7 8 11 15-59ZM96 45l12 56 10-12 20 6q-12-30-29-52Z" />
        <path d="M85 32C51 4 11 5 14 24l4 37c2 16 35-1 67-17ZM97 32c34-28 73-27 70-8l-4 37c-2 16-35-1-66-17Z" />
        <path d="M17 24q11-9 64 12M164 24q-11-9-64 12M21 56q22-15 59-16M159 56q-22-15-59-16" fill="none" stroke="#fff0f1" strokeWidth="3" />
        <path d="M82 27q9-5 17 0l3 22q-10 5-22-1Z" />
        <path d="m85 30-1 15m17 8 16 31M79 53 64 85" stroke="#fff1ef" strokeWidth="2" />
      </g>
    </svg>
  )
}

export function CornerFlourish({ className = '' }: { className?: string }) {
  return (
    <svg className={`corner-flourish ${className}`} viewBox="0 0 120 120" fill="none" aria-hidden="true" focusable="false">
      <g strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 113V64C7 23 24 7 67 7h46M13 113V64c0-35 15-51 54-51h46" stroke="#bc9e94" strokeWidth="3" />
        <path d="M10 113V64c0-38 16-54 57-54h46" stroke="#fffdf3" strokeWidth="5" />
        <path d="M14 75c33-11 1-42 18-48 17-6 9 16-1 9M31 37c-9-14 9-29 27-21 17 8 1 23-8 13M57 17c13 9 39 1 44-6M18 76c-8-8-5-16 0-18" stroke="#a9847f" strokeWidth="4" />
        <path d="M14 73c29-10-1-41 18-48 17-6 9 16-1 9M31 35c-9-14 9-29 27-21 17 8 1 23-8 13M57 15c13 9 39 1 44-6" stroke="#fff8ee" strokeWidth="3" />
        <path d="m22 25 5-12 4 9 10-5-6 13" fill="#fff5e7" stroke="#bd9f93" />
        <circle cx="15" cy="85" r="3" fill="#fff7e8" stroke="#b59588" /><circle cx="15" cy="96" r="2" fill="#fff7e8" stroke="#b59588" />
      </g>
    </svg>
  )
}

export function FrameOrnaments() {
  return <div className="frame-ornaments" aria-hidden="true">
    <CornerFlourish className="corner-top-left" /><CornerFlourish className="corner-top-right" />
    <CornerFlourish className="corner-bottom-left" /><CornerFlourish className="corner-bottom-right" />
    <StrawberrySprig className="frame-sprig-left" /><StrawberrySprig className="frame-sprig-right" />
    <RibbonBow className="frame-bow" />
  </div>
}

export function OrnamentalDivider() {
  return <div className="ornamental-divider" aria-hidden="true"><span /><svg viewBox="0 0 100 24" fill="none"><path d="M3 14c28 12 25-18 12-8-7 5 8 13 18 5m34 0c10 8 25 0 18-5-13-10-16 20 12 8" stroke="currentColor" /><path d="M50 21 39 11C28-2 49-4 50 6 51-4 72-2 61 11Z" fill="#f3a0b3" stroke="#984c62" /></svg><span /></div>
}

export function ScallopedPanel({ children }: { children: ReactNode }) {
  const top = Array.from({ length: 10 }, () => 'q26-18 52 0').join(' ')
  const bottom = Array.from({ length: 10 }, () => 'q-26 18-52 0').join(' ')
  return <div className="scalloped-panel">
    <svg className="scalloped-frame" viewBox="0 0 600 320" preserveAspectRatio="none" aria-hidden="true"><path d={`M40 16 ${top} q36-6 24 30 q22 20 0 40v148q22 20 0 40 q12 30-24 30 ${bottom} q-36 6-24-30 q-22-20 0-40V86q-22-20 0-40q-12-30 24-30Z`} /><path className="scalloped-stitch" d={`M40 16 ${top} q36-6 24 30 q22 20 0 40v148q22 20 0 40 q12 30-24 30 ${bottom} q-36 6-24-30 q-22-20 0-40V86q-22-20 0-40q-12-30 24-30Z`} /></svg>
    {children}
  </div>
}
