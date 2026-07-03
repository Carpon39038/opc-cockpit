import type { ReactElement } from 'react';

interface NavItem {
  path: string;
  zh: string;
  icon: ReactElement;
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ITEMS: NavItem[] = [
  {
    path: '/',
    zh: '首页',
    icon: (
      <svg viewBox="0 0 24 24" {...S}>
        <path d="M4 14a8 8 0 1 1 16 0" />
        <path d="M12 14l4-4" />
        <path d="M2.5 18h19" />
      </svg>
    ),
  },
  {
    path: '/board',
    zh: '看板',
    icon: (
      <svg viewBox="0 0 24 24" {...S}>
        <rect x="3" y="4" width="5.2" height="15" rx="1" />
        <rect x="9.4" y="4" width="5.2" height="10" rx="1" />
        <rect x="15.8" y="4" width="5.2" height="7" rx="1" />
      </svg>
    ),
  },
  {
    path: '/projects',
    zh: '项目',
    icon: (
      <svg viewBox="0 0 24 24" {...S}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    ),
  },
  {
    path: '/kb',
    zh: '知识',
    icon: (
      <svg viewBox="0 0 24 24" {...S}>
        <path d="M5 4a2 2 0 0 1 2-2h12v18H7a2 2 0 0 0-2 2z" />
        <path d="M19 16H7a2 2 0 0 0-2 2" />
      </svg>
    ),
  },
];

// 规划中的模块，先占位不可点
const SOON: { zh: string; icon: ReactElement }[] = [
  {
    zh: '收集箱',
    icon: (
      <svg viewBox="0 0 24 24" {...S}>
        <path d="M4 5h16v14H4z" />
        <path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" />
      </svg>
    ),
  },
  {
    zh: '调研',
    icon: (
      <svg viewBox="0 0 24 24" {...S}>
        <path d="M10 3h4" />
        <path d="M10 3v6l-4.6 8.2A2 2 0 0 0 7.2 20h9.6a2 2 0 0 0 1.8-2.8L14 9V3" />
        <path d="M8 14h8" />
      </svg>
    ),
  },
];

export function NavRail({ route }: { route: string }) {
  return (
    <nav className="nav">
      <svg className="nav-brand" viewBox="0 0 32 32" aria-label="OPC Cockpit">
        <path d="M16 5 27 16 16 27 5 16Z" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="16" cy="16" r="3.2" fill="currentColor" />
      </svg>
      {ITEMS.map((it) => (
        <button
          key={it.path}
          className={`nav-item ${route === it.path ? 'on' : ''}`}
          onClick={() => (location.hash = `#${it.path}`)}
          title={it.zh}
        >
          {it.icon}
          <span>{it.zh}</span>
        </button>
      ))}
      <div className="nav-sep" />
      {SOON.map((it) => (
        <div key={it.zh} className="nav-item nav-soon" title={`${it.zh} · 规划中`}>
          {it.icon}
          <span>{it.zh}</span>
        </div>
      ))}
    </nav>
  );
}
