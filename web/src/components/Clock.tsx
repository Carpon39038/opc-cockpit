import { useEffect, useState } from 'react';

function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  return (
    <div className="clock" title={now.toLocaleDateString()}>
      <span className="clock-time">{fmt(now)}</span>
      <span className="clock-date">
        {String(now.getMonth() + 1).padStart(2, '0')}-{String(now.getDate()).padStart(2, '0')} 周{week}
      </span>
    </div>
  );
}
