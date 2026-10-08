import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Indicator } from './indicator.entity';
import { ExtractRule, ReportSlot, ReportSpec } from './report-spec.entity';
import { Department } from '../departments/department.entity';
import { FACT_STATUS_LABEL, GATE_GROUP_LABEL } from '../../common/gate-text';

/**
 * D2 — Danh mục và cấu hình. Nguồn sự thật là thư mục `config/` (YAML có phiên bản, đưa vào git);
 * CSDL chỉ là bản nạp để truy vấn. Nạp lại nhiều lần cho cùng một kết quả:
 * - indicators/*.yaml      → dim_indicator (upsert theo indicator_id)
 * - report-specs/*.yaml    → report_spec + report_slot (bất biến theo version; version đã có thì bỏ qua)
 * - extract-rules/*.yaml   → extract_rule (bất biến theo source_type + version)
 */
export interface LoadResult {
  indicators: { upserted: number };
  specs: { created: string[]; skipped: string[] };
  rules: { created: string[]; skipped: string[] };
  errors: string[];
}

const AGG = ['cumulative', 'flow', 'point_in_time'];
/** Tên lĩnh vực hiển thị (mã lĩnh vực đặt trong config/indicators/*.yaml) */
export const DOMAIN_LABEL: Record<string, string> = {
  chi_dao: 'Chỉ đạo, điều hành', tthc: 'Thủ tục hành chính', tai_chinh: 'Tài chính, ngân sách', tu_phap: 'Tư pháp, hộ tịch', an_ninh: 'An ninh, trật tự',
  noi_chinh: 'Nội chính', y_te: 'Y tế', kinh_te_mt: 'Nông nghiệp, môi trường, chính sách xã hội', kinh_te: 'Kinh tế, hộ kinh doanh', van_hoa_xa_hoi: 'Văn hoá, xã hội', quoc_phong: 'Quốc phòng', dat_dai: 'Đất đai, xây dựng', kpi: 'KPI cán bộ',
  quy_hoach_xay_dung: 'Quy hoạch, đầu tư, xây dựng, GPMB', tai_nguyen_mt: 'Tài nguyên, môi trường', khcn_cds: 'Khoa học công nghệ, chuyển đổi số',
};
const CAPTURE = ['api', 'export', 'pdf_text', 'ocr', 'form'];

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @InjectRepository(Indicator) private indicators: Repository<Indicator>,
    @InjectRepository(ReportSpec) private specs: Repository<ReportSpec>,
    @InjectRepository(ReportSlot) private slots: Repository<ReportSlot>,
    @InjectRepository(ExtractRule) private rules: Repository<ExtractRule>,
    @InjectRepository(Department) private departments: Repository<Department>,
  ) {}

  /** Thư mục cấu hình: env CONFIG_DIR, mặc định <repo>/config (API chạy ở services/api). */
  configDir(): string {
    return process.env.CONFIG_DIR || path.resolve(process.cwd(), '..', '..', 'config');
  }

  private readYamlDir(sub: string): { file: string; doc: any }[] {
    const dir = path.join(this.configDir(), sub);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => /\.ya?ml$/i.test(f))
      .sort()
      .map((f) => ({ file: `${sub}/${f}`, doc: yaml.load(fs.readFileSync(path.join(dir, f), 'utf-8')) }));
  }

  async loadAll(): Promise<LoadResult> {
    const result: LoadResult = { indicators: { upserted: 0 }, specs: { created: [], skipped: [] }, rules: { created: [], skipped: [] }, errors: [] };

    // ── 1. Danh mục chỉ tiêu ──
    for (const { file, doc } of this.readYamlDir('indicators')) {
      const domain = doc?.domain;
      const ownerDept = doc?.owner_dept ?? null;
      for (const it of doc?.indicators ?? []) {
        try {
          if (!it.id || !it.name || !it.unit) throw new Error('thiếu id/name/unit');
          if (it.aggregation && !AGG.includes(it.aggregation)) throw new Error(`aggregation "${it.aggregation}" không hợp lệ`);
          if (it.capture_method && !CAPTURE.includes(it.capture_method)) throw new Error(`capture_method "${it.capture_method}" không hợp lệ`);
          await this.indicators.save(
            this.indicators.create({
              indicator_id: String(it.id),
              name: it.name,
              unit: it.unit,
              value_type: it.value_type ?? 'integer',
              domain: it.domain ?? domain,
              owner_dept: it.owner_dept ?? ownerDept,
              period_type: it.period_type ?? 'month',
              aggregation: it.aggregation ?? 'cumulative',
              capture_method: it.capture_method ?? 'form',
              parent_id: it.parent ?? null,
              definition: it.definition ?? null,
              official_code: it.official_code ?? null,
              regulation_ref: it.regulation_ref ?? doc?.regulation_ref ?? null,
              is_active: it.is_active ?? true,
            }),
          );
          result.indicators.upserted += 1;
        } catch (err) {
          result.errors.push(`${file} › ${it?.id ?? '?'}: ${(err as Error).message}`);
        }
      }
    }

    const known = new Set((await this.indicators.find({ select: ['indicator_id'] })).map((i) => i.indicator_id));

    // ── 2. Report Spec ──
    for (const { file, doc } of this.readYamlDir('report-specs')) {
      try {
        const code = doc?.spec_code;
        const version = Number(doc?.version ?? 1);
        if (!code || !doc?.title) throw new Error('thiếu spec_code/title');
        const tag = `${code}@${version}`;
        if (await this.specs.findOne({ where: { spec_code: code, version } })) {
          result.specs.skipped.push(tag);
          continue;
        }
        const slotDefs: any[] = doc.slots ?? [];
        for (const s of slotDefs) {
          for (const id of s.indicators ?? []) {
            if (!known.has(id)) throw new Error(`slot ${s.slot_id}: chỉ tiêu "${id}" chưa có trong danh mục`);
          }
        }
        const spec = await this.specs.save(
          this.specs.create({
            spec_code: code,
            report_type: doc.report_type ?? 'ktxh',
            version,
            title: doc.title,
            period_types: doc.period_types ?? [],
            template_file: doc.template_file ?? null,
            sections: doc.sections && typeof doc.sections === 'object' ? Object.fromEntries(Object.entries(doc.sections).map(([k, v]) => [String(k), String(v)])) : {},
          }),
        );
        await this.slots.save(
          slotDefs.map((s, i) => {
            // checks: chuỗi "a + b == c" hoặc { expr, label }
            const rawChecks: any[] = Array.isArray(s.checks) ? s.checks : [];
            const checks = rawChecks.map((c) => (typeof c === 'string' ? c : String(c?.expr ?? ''))).filter(Boolean);
            const check_labels: Record<string, string> = {};
            for (const c of rawChecks) if (c && typeof c === 'object' && c.expr && c.label) check_labels[String(c.expr)] = String(c.label);
            return this.slots.create({
              spec_id: spec.id,
              slot_code: s.slot_id,
              title: s.title ?? null,
              section: String(s.section ?? ''),
              ord: s.ord ?? i + 1,
              slot_type: s.slot_type ?? 'metric_sentence',
              indicator_ids: s.indicators ?? [],
              event_query: s.event_query ?? null,
              template: typeof s.template === 'string' ? s.template.trim() : null,
              checks,
              check_labels,
              narrative_template: typeof s.narrative_template === 'string' ? s.narrative_template.trim() : null,
              owner_dept: s.owner_dept ?? null,
              required: s.required ?? true,
            });
          }),
        );
        result.specs.created.push(`${tag} (${slotDefs.length} slot)`);
      } catch (err) {
        result.errors.push(`${file}: ${(err as Error).message}`);
      }
    }

    // ── 3. Luật bóc tách ──
    for (const { file, doc } of this.readYamlDir('extract-rules')) {
      try {
        const st = doc?.source_type;
        const version = Number(doc?.version ?? 1);
        if (!st || !doc?.file_kind) throw new Error('thiếu source_type/file_kind');
        const tag = `${st}@${version}`;
        if (await this.rules.findOne({ where: { source_type: st, version } })) {
          result.rules.skipped.push(tag);
          continue;
        }
        const targets: string[] = [
          ...(doc.map ?? []).map((m: any) => m.indicator),
          ...(doc.sentences ?? []).flatMap((m: any) => Object.values(m.groups ?? {}) as string[]),
          ...(doc.regions ?? []).map((m: any) => m.indicator),
        ].filter(Boolean);
        for (const id of targets) if (!known.has(id)) throw new Error(`chỉ tiêu "${id}" chưa có trong danh mục`);
        await this.rules.update({ source_type: st }, { is_active: false });
        await this.rules.save(this.rules.create({ source_type: st, version, file_kind: doc.file_kind, domain: doc.domain ?? null, rule: doc, is_active: true }));
        result.rules.created.push(tag);
      } catch (err) {
        result.errors.push(`${file}: ${(err as Error).message}`);
      }
    }

    this.logger.log(
      `Nạp cấu hình: ${result.indicators.upserted} chỉ tiêu; spec mới ${result.specs.created.length}; luật mới ${result.rules.created.length}; lỗi ${result.errors.length}`,
    );
    return result;
  }

  listIndicators(domain?: string) {
    return this.indicators.find({ where: domain ? { domain } : {}, order: { domain: 'ASC', indicator_id: 'ASC' } });
  }

  async getIndicatorOrFail(id: string): Promise<Indicator> {
    const ind = await this.indicators.findOne({ where: { indicator_id: id } });
    if (!ind) throw new BadRequestException(`Chỉ tiêu "${id}" không có trong danh mục.`);
    return ind;
  }

  listSpecs() {
    return this.specs.find({ order: { spec_code: 'ASC', version: 'DESC' } });
  }

  async getSpecWithSlots(specId: number) {
    const spec = await this.specs.findOne({ where: { id: specId } });
    if (!spec) throw new BadRequestException('Không tìm thấy mẫu báo cáo.');
    const slots = await this.slots.find({ where: { spec_id: specId }, order: { ord: 'ASC' } });
    return { ...spec, slots };
  }

  /**
   * Gói nhãn cho web/Mini App/Tabot: tên chỉ tiêu, tên mục và slot theo mẫu, tên phòng, nhãn trạng thái.
   * Web nạp một lần rồi hiện tên thay vì mã ở mọi màn (nguyên tắc "nói tiếng cán bộ, giấu mã").
   */
  async labels() {
    const [inds, specs, slots, depts] = await Promise.all([this.indicators.find(), this.specs.find(), this.slots.find(), this.departments.find()]);
    const indicators: Record<string, { name: string; unit: string; value_type: string; domain: string; owner_dept: string | null }> = {};
    for (const i of inds) indicators[i.indicator_id] = { name: i.name, unit: i.unit, value_type: i.value_type, domain: i.domain, owner_dept: i.owner_dept };
    const specOut: Record<string, { title: string; spec_code: string; version: number; sections: Record<string, string>; slots: Record<string, { title: string; section: string; slot_type: string }> }> = {};
    for (const sp of specs) specOut[String(sp.id)] = { title: sp.title, spec_code: sp.spec_code, version: sp.version, sections: sp.sections ?? {}, slots: {} };
    for (const sl of slots) if (specOut[String(sl.spec_id)]) specOut[String(sl.spec_id)].slots[sl.slot_code] = { title: sl.title ?? sl.slot_code, section: sl.section, slot_type: sl.slot_type };
    const departments: Record<string, string> = {};
    for (const d of depts) departments[d.key] = d.name;
    return {
      indicators, specs: specOut, departments,
      fact_status: FACT_STATUS_LABEL,
      run_status: { collecting: 'Đang thu số', locked: 'Đã chốt', drafted: 'Có bản nháp', submitted: 'Đã trình ký', signed: 'Đã ký', cancelled: 'Đã huỷ' },
      gate_group: GATE_GROUP_LABEL,
      capture: { api: 'Kết nối API', export: 'File xuất từ hệ thống', pdf_text: 'PDF/Word có chữ', ocr: 'Ảnh/scan (OCR)', form: 'Nhập tay' },
      domains: Object.fromEntries([...new Set(inds.map((i) => i.domain))].map((d) => [d, DOMAIN_LABEL[d] ?? d])),
    };
  }

  /** Gói một lĩnh vực: chỉ tiêu (mã ngành khi có), slot và phép kiểm liên quan, luật bóc tách, mẫu bản ghi Object — JSON để Sở thẩm định/đối chiếu. */
  async domainPackage(domain: string) {
    const inds = await this.indicators.find({ where: { domain, is_active: true }, order: { indicator_id: 'ASC' } });
    if (!inds.length) return { domain, label: DOMAIN_LABEL[domain] ?? domain, indicators: [], slots: [], rules: [], object_types: [], note: 'Không có chỉ tiêu trong lĩnh vực này.' };
    const ids = new Set(inds.map((i) => i.indicator_id));
    const slots = (await this.slots.find()).filter((s) => (s.indicator_ids ?? []).some((i) => ids.has(i)));
    const specs = new Map((await this.specs.find()).map((s) => [s.id, s]));
    const rules = (await this.rules.find()).filter((r) => (r as any).domain === domain || JSON.stringify((r as any).rule ?? {}).split('"indicator":"').slice(1).some((x) => ids.has(x.split('"')[0])));
    let objectTypes: any[] = [];
    try { const yd: any = yaml.load(fs.readFileSync(path.join(this.configDir(), 'objects', 'types.yaml'), 'utf-8')); objectTypes = (yd?.types ?? []).filter((t: any) => (t.indicators ?? []).some((i: string) => ids.has(i))).map((t: any) => ({ key: t.key, name: t.name, ownership: t.ownership, master_source: t.master_source, fields: t.fields ?? [], events: t.events ?? [] })); } catch { /* không có từ điển Object */ }
    return {
      domain, label: DOMAIN_LABEL[domain] ?? domain, generated_at: new Date().toISOString(),
      indicators: inds.map((i) => ({ indicator_id: i.indicator_id, official_code: i.official_code, name: i.name, unit: i.unit, value_type: i.value_type, aggregation: i.aggregation, capture_method: i.capture_method, owner_dept: i.owner_dept, definition: i.definition, regulation_ref: i.regulation_ref })),
      slots: slots.map((s) => ({ spec: `${specs.get(s.spec_id)?.spec_code}@${specs.get(s.spec_id)?.version}`, slot_id: s.slot_code, section: s.section, title: s.title, indicators: s.indicator_ids, checks: (s.checks ?? []).map((c: string) => ({ expr: c, label: (s.check_labels as any)?.[c] ?? null })), template: (s as any).template ?? null })),
      rules: rules.map((r) => ({ source_type: (r as any).source_type, version: (r as any).version, file_kind: (r as any).rule?.file_kind ?? null })),
      object_types: objectTypes,
      official_code_note: inds.some((i) => !i.official_code) ? 'Một số chỉ tiêu chưa có mã ngành (official_code) — đối chiếu QĐ 264/QĐ-UBND trước khi gửi Sở.' : null,
    };
  }

  /** Luật đang hiệu lực (D2 → T3) — services/reader đọc qua API nội bộ. */
  activeRules() {
    return this.rules.find({ where: { is_active: true }, order: { source_type: 'ASC' } });
  }
}
