// src/renderer/components/music/HotComments.tsx
// 热门评论


interface Comment {
  user: string
  content: string
  likedCount: number
}

interface HotCommentsProps {
  comments: Comment[]
}

function formatCount(count: number): string {
  if (count >= 10000) {
    return (count / 10000).toFixed(1) + '万'
  }
  return count.toString()
}

export function HotComments({ comments }: HotCommentsProps): React.JSX.Element | null {
  if (comments.length === 0) return null

  return (
    <div className="hot-comments">
      <div className="hot-comments-title">热门评论</div>
      {comments.map((comment, i) => (
        <div key={i} className="comment-item">
          <div className="comment-content">{comment.content}</div>
          <div className="comment-meta">
            <span className="comment-user">—— {comment.user}</span>
            <span className="comment-likes">
              ❤ {formatCount(comment.likedCount)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}