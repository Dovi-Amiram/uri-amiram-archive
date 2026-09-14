import type { ImageAttachment } from '../types/archive'

/** Image files are copied from archive/attachments/ into the site at build time. */
export const attachmentUrl = (image: ImageAttachment) => `${import.meta.env.BASE_URL}${image.path}`

interface EntryImagesProps {
  images: ImageAttachment[]
  /** Card previews show only the first image. */
  preview?: boolean
}

export function EntryImages({ images, preview }: EntryImagesProps) {
  if (images.length === 0) return null
  const shown = preview ? images.slice(0, 1) : images
  return (
    <div className={`entry-images${preview ? ' entry-images--preview' : ''}`}>
      {shown.map((image) => (
        <img
          key={image.path}
          src={attachmentUrl(image)}
          // Facebook's automatic descriptions are often generic; fall back to a neutral label.
          alt={image.alt ?? 'תמונה מצורפת'}
          width={image.width ?? undefined}
          height={image.height ?? undefined}
          loading="lazy"
          decoding="async"
        />
      ))}
      {preview && images.length > 1 && <span className="entry-images__more">+{images.length - 1} תמונות</span>}
    </div>
  )
}
