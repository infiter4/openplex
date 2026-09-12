import type { ReactNode, SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number }

function Svg({ size = 24, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
      {children}
    </svg>
  )
}

const S = 'currentColor'

export const IconAsk = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 L20 12 L12 21 L4 12 Z" stroke={S} strokeWidth="1.7" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="2.3" fill={S} />
  </Svg>
)

export const IconLibrary = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h9" stroke={S} strokeWidth="1.7" strokeLinecap="round" />
  </Svg>
)

export const IconModels = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="2.3" stroke={S} strokeWidth="1.7" />
    <circle cx="17" cy="7" r="2.3" stroke={S} strokeWidth="1.7" />
    <circle cx="7" cy="17" r="2.3" stroke={S} strokeWidth="1.7" />
    <circle cx="17" cy="17" r="2.3" fill={S} />
  </Svg>
)

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 17h16" stroke={S} strokeWidth="1.7" />
    <circle cx="15" cy="7" r="2.3" fill="var(--bg1)" stroke={S} strokeWidth="1.7" />
    <circle cx="9" cy="17" r="2.3" fill="var(--bg1)" stroke={S} strokeWidth="1.7" />
  </Svg>
)

export const IconTheme = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="5" stroke={S} strokeWidth="1.7" />
    <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" stroke={S} strokeWidth="1.7" strokeLinecap="round" />
  </Svg>
)

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" stroke={S} strokeWidth="1.8" />
    <line x1="15.5" y1="15.5" x2="20" y2="20" stroke={S} strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
)

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" stroke={S} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

export const IconAttach = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 12v-1.5a3 3 0 0 1 6 0V14a5 5 0 0 1-10 0V8" stroke={S} strokeWidth="1.7" strokeLinecap="round" />
  </Svg>
)

export const IconSeed = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19h3l9-9-3-3-9 9v3Z" stroke={S} strokeWidth="1.7" strokeLinejoin="round" />
  </Svg>
)

export const IconResearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" stroke={S} strokeWidth="1.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.4 2.4 14.6 0 17M12 3.5c-2.4 2.4-2.4 14.6 0 17" stroke={S} strokeWidth="1.3" />
  </Svg>
)

export const IconSend = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" stroke={S} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8" y="8" width="11" height="13" rx="2" stroke={S} strokeWidth="1.7" />
    <path d="M5 16V5a2 2 0 0 1 2-2h9" stroke={S} strokeWidth="1.7" />
  </Svg>
)

export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19h3l9-9-3-3-9 9v3Z" stroke={S} strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M14 6l3 3" stroke={S} strokeWidth="1.7" />
  </Svg>
)

export const IconRegenerate = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 1 0-1.2 5.2" stroke={S} strokeWidth="1.7" strokeLinecap="round" />
    <path d="M20 5v5h-5" stroke={S} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

export const IconCompare = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="7" height="14" rx="1.5" stroke={S} strokeWidth="1.7" />
    <rect x="14" y="5" width="7" height="14" rx="1.5" stroke={S} strokeWidth="1.7" />
  </Svg>
)

export const IconBookmark = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4h12v16l-6-3.5L6 20V4Z" stroke={S} strokeWidth="1.7" strokeLinejoin="round" />
  </Svg>
)

export const IconShare = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="12" r="2.4" stroke={S} strokeWidth="1.7" />
    <circle cx="18" cy="6" r="2.4" stroke={S} strokeWidth="1.7" />
    <circle cx="18" cy="18" r="2.4" stroke={S} strokeWidth="1.7" />
    <path d="M8 11l8-4M8 13l8 4" stroke={S} strokeWidth="1.7" />
  </Svg>
)

export const IconSources = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h8l4 4v14H6z" stroke={S} strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M14 3v4h4" stroke={S} strokeWidth="1.6" strokeLinejoin="round" />
  </Svg>
)

export const IconPin = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p}>
    <path d="M12 17v5M8 4h8l-1 6 3 2H6l3-2-1-6z" stroke={S} strokeWidth="1.5" strokeLinejoin="round" fill={filled ? S : 'none'} />
  </Svg>
)

export const IconArchive = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="4" rx="1" stroke={S} strokeWidth="1.6" />
    <path d="M5.5 9v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" stroke={S} strokeWidth="1.6" />
    <line x1="10" y1="13" x2="14" y2="13" stroke={S} strokeWidth="1.6" strokeLinecap="round" />
  </Svg>
)

export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.6" fill={S} />
    <circle cx="12" cy="12" r="1.6" fill={S} />
    <circle cx="19" cy="12" r="1.6" fill={S} />
  </Svg>
)
