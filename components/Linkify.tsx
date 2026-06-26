// 글 속의 URL을 자동으로 클릭 가능한 링크로 변환
export default function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="break-all font-medium text-accent underline"
          >
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}
