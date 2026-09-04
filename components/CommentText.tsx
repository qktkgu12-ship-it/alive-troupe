// 댓글 본문 — 링크는 눌리게, @이름은 강조해서 보여 준다.
//
// 링크를 먼저 갈라낸 뒤 남은 글자 안에서만 이름을 찾는다.
// 순서를 바꾸면 주소 안의 글자가 이름으로 잡힐 수 있다.

import Linkify from "@/components/Linkify";
import { splitMentions, type MentionMember } from "@/lib/mentions";

export default function CommentText({
  text,
  members,
}: {
  text: string;
  members: MentionMember[];
}) {
  if (members.length === 0) return <Linkify text={text} />;

  const chunks = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {chunks.map((chunk, i) =>
        /^https?:\/\//.test(chunk) ? (
          <Linkify key={i} text={chunk} />
        ) : (
          splitMentions(chunk, members).map((p, j) =>
            p.type === "mention" ? (
              <span key={`${i}-${j}`} className="font-semibold text-accent">
                {p.value}
              </span>
            ) : (
              <span key={`${i}-${j}`}>{p.value}</span>
            )
          )
        )
      )}
    </>
  );
}
