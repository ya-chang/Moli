// src/renderer/components/chat/ImageMessage.tsx
// 图片消息组件 — 展示用户发送的图片 + 文字

import './ImageMessage.css'

interface ImageMessageProps {
  images: string[]  // base64 data URLs
  content?: string  // 附带的文字
  isUser: boolean
}

export function ImageMessage({ images, content, isUser }: ImageMessageProps): React.JSX.Element {
  return (
    <div className={`image-message ${isUser ? 'image-message--user' : 'image-message--assistant'}`}>
      <div className="image-message__grid">
        {images.map((img, index) => (
          <div key={index} className="image-message__item">
            <img src={img} alt="图片" />
          </div>
        ))}
      </div>
      {content && (
        <div className="image-message__text">{content}</div>
      )}
    </div>
  )
}
