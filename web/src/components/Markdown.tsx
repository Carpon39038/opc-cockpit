import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

interface Props {
  children: string;
  className?: string;
}

/**
 * 任务描述 / 评论的 Markdown 渲染。
 * - GFM：表格、任务清单、删除线、自动链接
 * - breaks：单个换行即换行（符合评论直觉）
 * - 不渲染内嵌 HTML（react-markdown 默认行为，防注入）
 */
export function Markdown({ children, className }: Props) {
  return (
    <div className={`md ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
