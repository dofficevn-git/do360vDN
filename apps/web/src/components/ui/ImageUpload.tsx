'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { RefreshCw, ImagePlus } from 'lucide-react';

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  hint?: string;
  previewClassName?: string;
}

export function ImageUpload({ value, onChange, label, hint, previewClassName = 'w-24 h-24 object-cover' }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/admin/upload/image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(res.data.url);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Upload thất bại, vui lòng thử lại.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      {label && <label className="text-xs font-medium text-slate-600 block">{label}</label>}

      <div className="flex items-center gap-3 flex-wrap">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition disabled:opacity-60"
        >
          {uploading ? (
            <>
              <span className="w-4 h-4 border-2 border-slate-300 border-t-primary-700 rounded-full animate-spin inline-block" />
              Đang tải lên...
            </>
          ) : value ? (
            <><RefreshCw className="h-4 w-4" /> Đổi ảnh</>
          ) : (
            <><ImagePlus className="h-4 w-4" /> Chọn ảnh từ máy</>
          )}
        </button>

        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-xs text-red-500 hover:underline"
          >
            Xóa ảnh
          </button>
        )}
      </div>

      {value && (
        <img
          src={value}
          alt="preview"
          className={`${previewClassName} rounded-lg border border-slate-200`}
        />
      )}

      {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
