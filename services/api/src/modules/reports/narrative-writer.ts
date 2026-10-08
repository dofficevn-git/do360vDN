import { Injectable, Logger } from '@nestjs/common';

/**
 * Người viết lời dẫn (bước 1 và bước 2 của Tabot). Nghiệp vụ chỉ gọi interface; kết quả LUÔN là bản nháp,
 * luôn qua hậu kiểm (số ⊆ snapshot, tên kỳ khớp) trước khi lưu, và không bao giờ tự được chấp nhận.
 */
export interface WriterInput {
  slot_code: string;
  slot_title: string | null;
  section: string;
  period_label: string;
  /** Khuôn câu của slot (đã điền biến) */
  template_text: string | null;
  /** Các câu số đã render trong cùng mục (khoá — không được sửa, không được sinh số mới) */
  metric_sentences: string[];
  /** Lời dẫn của kỳ trước cùng mục (đã đổi nhãn kỳ) */
  previous_text: string | null;
  /** Sự kiện chỉ đạo trong kỳ thuộc lĩnh vực */
  events: string[];
}

export interface NarrativeWriter {
  readonly name: 'template' | 'llm';
  enabled(): boolean;
  suggest(input: WriterInput): Promise<{ text: string; note?: string }>;
}

/** Bước 1 — không mô hình: ghép khuôn câu, lời kỳ trước và sự kiện thành bản gợi ý để Văn phòng sửa. */
@Injectable()
export class TemplateWriter implements NarrativeWriter {
  readonly name = 'template' as const;
  enabled() { return true; }
  async suggest(i: WriterInput) {
    const parts: string[] = [];
    if (i.template_text) parts.push(i.template_text.trim());
    else if (i.previous_text) parts.push(i.previous_text.trim());
    if (i.events.length) parts.push(`Trong ${i.period_label}, UBND đã ban hành ${i.events.slice(0, 3).join('; ')}${i.events.length > 3 ? ` và ${i.events.length - 3} văn bản khác` : ''}.`);
    return { text: parts.join(' '), note: i.template_text ? 'Từ khuôn câu của mẫu báo cáo' : i.previous_text ? 'Từ lời dẫn kỳ trước' : 'Từ sự kiện trong kỳ' };
  }
}

/**
 * Bước 2 — mô hình ngôn ngữ CHẠY TRONG NƯỚC (Ollama/vLLM nội bộ, giao thức OpenAI chat). Tắt mặc định (LLM_URL trống).
 * env-guard: chỉ cho host nội bộ/allowlist (LLM_ALLOWED_HOSTS, mặc định localhost + mạng riêng) — không gọi dịch vụ AI nước ngoài.
 */
@Injectable()
export class LocalLlmWriter implements NarrativeWriter {
  readonly name = 'llm' as const;
  private readonly logger = new Logger(LocalLlmWriter.name);

  private url() { return (process.env.LLM_URL || '').trim(); }
  private hostAllowed(u: string): boolean {
    try {
      const h = new URL(u).hostname;
      const allow = (process.env.LLM_ALLOWED_HOSTS || 'localhost,127.0.0.1,ollama,llm').split(',').map((s) => s.trim()).filter(Boolean);
      if (allow.includes(h)) return true;
      return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.gov.vn');
    } catch { return false; }
  }
  enabled() { const u = this.url(); return !!u && this.hostAllowed(u); }

  async suggest(i: WriterInput) {
    const u = this.url();
    if (!u) throw new Error('LLM_URL chưa cấu hình.');
    if (!this.hostAllowed(u)) throw new Error('LLM_URL không thuộc danh sách máy chủ nội bộ cho phép — DO360 không gọi dịch vụ AI ngoài nước.');
    const system = 'Bạn là chuyên viên Văn phòng UBND cấp xã viết lời dẫn cho báo cáo định kỳ. Viết tiếng Việt hành chính, 2–4 câu, khách quan. TUYỆT ĐỐI không nêu con số nào ngoài các con số đã cho trong "câu số"; không bịa văn bản, không bịa sự kiện. Dùng đúng tên kỳ đã cho.';
    const user = [`Mục: ${i.section} ${i.slot_title ?? ''}`, `Kỳ: ${i.period_label}`, i.metric_sentences.length ? `Câu số đã khoá (giữ nguyên, có thể nhắc lại nguyên văn):\n- ${i.metric_sentences.join('\n- ')}` : '', i.events.length ? `Sự kiện trong kỳ:\n- ${i.events.join('\n- ')}` : '', i.previous_text ? `Lời dẫn kỳ trước (tham khảo giọng văn):\n${i.previous_text}` : '', i.template_text ? `Khuôn câu gợi ý:\n${i.template_text}` : '', 'Hãy viết lời dẫn.'].filter(Boolean).join('\n\n');
    const res = await fetch(u.replace(/\/$/, '') + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) },
      body: JSON.stringify({ model: process.env.LLM_MODEL || 'qwen2.5:7b', temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }), signal: AbortSignal.timeout(90_000) });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`LLM trả lỗi HTTP ${res.status}`);
    const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new Error('LLM không trả nội dung.');
    this.logger.log(`[llm] ${i.slot_code}: ${text.length} ký tự`);
    return { text, note: `Mô hình ${process.env.LLM_MODEL || 'cục bộ'} — bản nháp, phải hậu kiểm và Văn phòng chấp nhận` };
  }
}
