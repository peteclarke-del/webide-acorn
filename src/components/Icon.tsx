import type { SVGProps } from 'react';

export type IconName =
  | 'new'
  | 'open'
  | 'save'
  | 'download'
  | 'build'
  | 'play'
  | 'pause'
  | 'stop'
  | 'reset'
  | 'debug'
  | 'search'
  | 'settings'
  | 'folder'
  | 'file'
  | 'chip'
  | 'layers'
  | 'book'
  | 'image'
  | 'music'
  | 'chevron'
  | 'close'
  | 'more'
  | 'terminal'
  | 'code'
  | 'cloud'
  | 'bookmark'
  | 'breakpoint'
  | 'lock'
  | 'check'
  | 'screen'
  | 'expand'
  | 'power';

const paths: Record<IconName, React.ReactNode> = {
  new: <><path d="M12 5v14M5 12h14" /></>,
  open: <><path d="M3 7h6l2 2h10v10H3z" /><path d="M3 7V5h7l2 2" /></>,
  save: <><path d="M5 3h12l2 2v16H5z" /><path d="M8 3v6h8V3M8 21v-7h8v7" /></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M4 19h16" /></>,
  build: <><path d="m14 5 5 5-9 9-5-5z" /><path d="m13 6-2-2-3 3 2 2M5 14l-2 5 5-2" /></>,
  play: <path d="m8 5 11 7-11 7z" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  reset: <><path d="M5 7v5h5" /><path d="M6.5 17a8 8 0 1 0-.5-9l-1 4" /></>,
  debug: <><path d="M9 9h6v9a3 3 0 0 1-6 0z" /><path d="M10 9V6h4v3M6 12h3m6 0h3M6 16h3m6 0h3M8 6 6 4m10 2 2-2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" /></>,
  folder: <path d="M3 6h7l2 2h9v11H3z" />,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h4" /></>,
  chip: <><rect x="7" y="7" width="10" height="10" rx="1" /><path d="M9 2v5m6-5v5M9 17v5m6-5v5M2 9h5m10 0h5M2 15h5m10 0h5" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  book: <><path d="M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4z" /><path d="M20 4h-4a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h4z" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m3 17 5-4 4 3 3-4 6 5" /></>,
  music: <><path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
  terminal: <><path d="m4 6 5 5-5 5M11 18h9" /></>,
  code: <><path d="m9 5-6 7 6 7M15 5l6 7-6 7M14 3l-4 18" /></>,
  cloud: <path d="M7 19h11a4 4 0 0 0 .5-8A7 7 0 0 0 5 9.5 5 5 0 0 0 7 19z" />,
  bookmark: <path d="M7 3h10v18l-5-3-5 3z" />,
  breakpoint: <circle cx="12" cy="12" r="7" />,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  screen: <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 22h8m-4-4v4" /></>,
  expand: <><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" /><path d="m3 9 6-6m6 0 6 6M3 15l6 6m6 0 6-6" /></>,
  power: <><path d="M12 3v9" /><path d="M7.2 5.8a8 8 0 1 0 9.6 0" /></>,
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
