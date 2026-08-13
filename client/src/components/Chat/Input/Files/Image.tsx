import { FileSources } from 'librechat-data-provider';
import ImagePreview from './ImagePreview';
import RemoveFile from './RemoveFile';

const Image = ({
  imageBase64,
  url,
  onDelete,
  progress = 1,
  source = FileSources.local,
}: {
  imageBase64?: string;
  url?: string;
  onDelete: () => void;
  progress: number; // between 0 and 1
  source?: FileSources;
}) => {
  return (
    <div className="group relative inline-flex align-top text-sm leading-none">
      {/* 12.08-2: рамка была прямоугольной и выше фото (линия строки inline-block
          плюс чужой радиус). Квадрат 56 — как сам предпросмотр, токены канона. */}
      <div className="relative size-14 overflow-hidden rounded-xl border border-border-light">
        <ImagePreview source={source} imageBase64={imageBase64} url={url} progress={progress} />
      </div>
      <RemoveFile onRemove={onDelete} />
    </div>
  );
};

export default Image;
