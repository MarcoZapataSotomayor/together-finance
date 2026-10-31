import type { ReactNode, SVGProps } from 'react'

const paths = {
  person: <><circle cx="12" cy="7" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3Z" /></>,
  people: <><circle cx="9" cy="7" r="3.5" /><path d="M2 21v-3a7 7 0 0 1 14 0v3ZM17 4a3.5 3.5 0 0 1 0 7m1 3a6 6 0 0 1 4 6" /></>,
  store: <><path d="M4 10v11h16V10M2 7l3-5h14l3 5v3a3 3 0 0 1-5 1 3 3 0 0 1-5 0 3 3 0 0 1-5 0 3 3 0 0 1-5-1ZM9 21v-7h6v7M2 7h20" /></>,
  coins: <><ellipse cx="9" cy="14" rx="7" ry="3" /><path d="M2 14v6c0 4 14 4 14 0v-6M2 17c0 4 14 4 14 0" /><ellipse cx="16" cy="4" rx="6" ry="2.5" /><path d="M22 4v10c0 2-3 3-6 3M11 8c3 2 8 2 11-1M17 12c2 0 4-1 5-2" /></>,
  calendar: <><rect x="3" y="5" width="18" height="17" rx="2" /><path d="M7 2v6m10-6v6M3 11h18m-14 4h2m6 0h2m-10 4h2" /></>,
  tag: <><path d="m3 13 10-10h8v8L11 21Z" /><circle cx="17" cy="7" r="1" /></>,
  note: <><path d="M20 13v8H3V3h12M7 7h6M7 11h3m0 7 2-5L21 4l3 3-9 9Z" /></>,
  card: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 9h20M6 15h4m6 0h2" /></>,
  pie: <><path d="M11 2v11h11A10 10 0 1 1 11 2Z" /><path d="M15 2v7h7a9 9 0 0 0-7-7Z" /></>,
  plus: <path d="M12 4v16M4 12h16" />,
  heart: <path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z" />,
  flower: <><path d="M12 7C7-1 2 6 7 10c-9 0-5 9 1 6-3 8 7 9 7 1 7 5 12-4 4-6 8-5 0-12-4-5Z" /><circle cx="12" cy="12" r="2.5" /></>,
  bolt: <path d="m14 2-11 12h8l-1 8 11-13h-8Z" />,
  sparkle: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /><path d="M21 2v4M19 4h4" /></>,
  strawberry: <><path d="M5 8c-5 6 4 14 7 14s12-8 7-14c-2-2-4-2-7-1-3-1-5-1-7 1Z" /><path d="m12 7-5-4 1 4-4 1m8-1 5-4-1 4 4 1M12 7V2m-4 9 1 1m6-1 1 1m-5 4 1 1m4-2 1 1" /></>,
  ribbon: <><path d="M12 9C4-3-4 12 7 12h10C28 12 20-3 12 9Z" /><circle cx="12" cy="11" r="2" /><path d="m10 13-4 8 4-1 2 2 2-9m0 0 4 8 1-4 3-1-6-4" /></>,
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  arrows: <><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  chevron: <path d="m6 9 6 6 6-6" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof paths

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {paths[name]}
    </svg>
  )
}
