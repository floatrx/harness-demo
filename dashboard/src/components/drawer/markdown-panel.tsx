import Markdown from 'react-markdown';

interface Props {
  markdown: string;
  empty: string;
}

/* Section text from the task file. The agents write it; the dashboard only renders it. */
export const MarkdownPanel = ({ markdown, empty }: Props) =>
  markdown ? (
    <div className="space-y-2.5 text-[13.5px] leading-relaxed [&_code]:rounded [&_code]:bg-surface-secondary [&_code]:px-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc">
      <Markdown>{markdown}</Markdown>
    </div>
  ) : (
    <p className="text-[13.5px] text-muted">{empty}</p>
  );
