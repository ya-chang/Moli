// src/renderer/components/emojis/EmojiUploader.tsx
// 表情包上传弹窗 — 标签 + 情绪选择

import { useState, useRef } from 'react'

interface EmojiUploaderProps {
  characterId: string
  onSuccess: () => void
  onCancel: () => void
}

const EMOTION_OPTIONS = [
  { value: 'happy', label: '开心', icon: '😊' },
  { value: 'angry', label: '生气', icon: '😡' },
  { value: 'sad', label: '难过', icon: '😢' },
  { value: 'neutral', label: '中性', icon: '😐' },
  { value: 'love', label: '喜欢', icon: '❤️' },
]

export function EmojiUploader({ characterId, onSuccess, onCancel }: EmojiUploaderProps): React.JSX.Element {
  const [preview, setPreview] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [tags, setTags] = useState('')
  const [emotion, setEmotion] = useState('neutral')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 选择文件
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (!file) return

    // 检查文件大小
    if (file.size > 5 * 1024 * 1024) {
      alert('文件太大，最大5MB')
      return
    }

    // 检查文件格式
    const validFormats = ['image/png', 'image/jpeg', 'image/webp']
    if (!validFormats.includes(file.type)) {
      alert('不支持的格式，只支持 png/jpg/webp')
      return
    }

    setSelectedFile(file)
    
    // 创建预览
    const reader = new FileReader()
    reader.onload = (event) => {
      setPreview(event.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  // 上传表情包
  const handleUpload = async (): Promise<void> => {
    if (!selectedFile) return

    setUploading(true)
    try {
      // 读取文件为 base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          // 去掉 data:image/xxx;base64, 前缀
          const data = result.split(',')[1]
          resolve(data)
        }
        reader.onerror = reject
        reader.readAsDataURL(selectedFile)
      })

      // 解析标签
      const tagsList = tags
        .split(/[,，]/)
        .map(t => t.trim())
        .filter(Boolean)

      // 发送到主进程
      const result = await window.electronAPI?.invoke('emoji:upload-data', characterId, {
        fileName: selectedFile.name,
        fileData: base64,
        tags: tagsList,
        emotion
      }) as any

      if (result?.success) {
        onSuccess()
      } else {
        alert(result?.error || '上传失败')
      }
    } catch (err) {
      console.error('上传失败:', err)
      alert('上传失败')
    } finally {
      setUploading(false)
    }
  }

  // 点击上传区域
  const handleClick = (): void => {
    fileInputRef.current?.click()
  }

  return (
    <div className="emoji-uploader-overlay">
      <div className="emoji-uploader">
        <h3 className="emoji-uploader__title">上传表情包</h3>
        
        {/* 上传区域 */}
        <div className="emoji-uploader__preview" onClick={handleClick}>
          {preview ? (
            <img src={preview} alt="预览" className="emoji-uploader__preview-img" />
          ) : (
            <div className="emoji-uploader__placeholder">
              <span className="emoji-uploader__placeholder-icon">+</span>
              <span>点击选择图片</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleFileSelect}
            className="emoji-uploader__file-input"
          />
        </div>

        {/* 标签输入 */}
        <div className="emoji-uploader__field">
          <label className="emoji-uploader__label">标签（用于AI匹配，多个用逗号分隔）</label>
          <input
            type="text"
            className="emoji-uploader__input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="例如：猫,可爱,卖萌"
          />
        </div>

        {/* 情绪选择 */}
        <div className="emoji-uploader__field">
          <label className="emoji-uploader__label">关联情绪</label>
          <div className="emoji-uploader__emotions">
            {EMOTION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`emoji-uploader__emotion-btn ${emotion === opt.value ? 'emoji-uploader__emotion-btn--active' : ''}`}
                onClick={() => setEmotion(opt.value)}
              >
                <span>{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 按钮 */}
        <div className="emoji-uploader__actions">
          <button
            className="emoji-uploader__btn emoji-uploader__btn--cancel"
            onClick={onCancel}
            disabled={uploading}
          >
            取消
          </button>
          <button
            className="emoji-uploader__btn emoji-uploader__btn--confirm"
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
          >
            {uploading ? '上传中...' : '确认上传'}
          </button>
        </div>
      </div>
    </div>
  )
}
