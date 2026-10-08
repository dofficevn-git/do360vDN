import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { ModuleRef } from '@nestjs/core';
import { DataSource, In, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { FactIndicator, FactStatus, FactStatusLog, SourceRef } from './fact-indicator.entity';
import { CAPTURE_RANK, CaptureMethod, Indicator } from '../catalog/indicator.entity';
import { CatalogService } from '../catalog/catalog.service';
import { parsePeriod } from '../../common/period';
import { MANAGER_ROLES } from '../../common/roles';
import { QualityGateService } from './quality-gate.service';
import { StaffNotificationsService } from '../staff-notifications/staff-notifications.service';
import { Department } from '../departments/department.entity';

export interface Actor {
  id: number;
  role: string;
  department: string | null;
  tenant_id: string;
}

/** T3 → D1: cấu trúc một bản ghi `extracted` (xem docs/giao-dien/01-ban-ghi-extracted.md). */
export interface ExtractedRecord {
  indicator_id: string;
  period: string;
  as_of_date: string;
  value: number | string;
  breakdown?: Record<string, string>;
  source_ref?: SourceRef;
  source_file_id?: number | null;
  capture_method: CaptureMethod;
  confidence?: number;
}

export interface IngestOutcome {
  fact_id: string;
  indicator_id: string;
  status: FactStatus;
  version: number;
  note?: string;
}

const DONE: FactStatus[] = ['confirmed', 'approved', 'locked'];

/** Cộng N ngày làm việc (bỏ thứ Bảy, Chủ nhật) — hạn Data Owner quyết số cách ly theo thiết kế 03/10. */
export function businessDaysFrom(from: Date, days: number): Date {
  const d = new Date(from); let n = 0;
  while (n < days) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n++; }
  return d;
}
const vnDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

@Injectable()
export class FactsService {
  constructor(
    @InjectRepository(FactIndicator) private repo: Repository<FactIndicator>,
    @InjectRepository(FactStatusLog) private logs: Repository<FactStatusLog>,
    @InjectDataSource() private ds: DataSource,
    private catalog: CatalogService,
    private gate: QualityGateService,
    private staffNotifications: StaffNotificationsService,
    @InjectRepository(Department) private departments: Repository<Department>,
    private moduleRef: ModuleRef,
  ) {}

  /** Báo cho người đại diện phòng chủ dữ liệu (Data Owner) — in-app + thẻ qua kênh chat (T4, lấy muộn để tránh vòng phụ thuộc). */
  private async notifyOwner(ind: Indicator, title: string, body: string, factId: string, period?: string, tenantId?: string) {
    if (!ind.owner_dept) return;
    const dept = await this.departments.findOne({ where: { key: ind.owner_dept } });
    if (dept?.head_admin_id) await this.staffNotifications.create({ recipient_id: dept.head_admin_id, type: 'fact_quarantined', title, body, reference_type: 'fact', reference_id: Number(factId) || undefined }).catch(() => {});
    try {
      const chat = this.moduleRef.get(require('../chat/chat.service').ChatService, { strict: false });
      if (chat && period && tenantId) await chat.notifyQuarantined(ind, factId, period, tenantId, body);
    } catch { /* kênh chat chưa sẵn sàng */ }
  }

  static breakdownKey(breakdown?: Record<string, string>): string {
    const keys = Object.keys(breakdown ?? {}).sort();
    if (keys.length === 0) return '';
    return createHash('md5').update(JSON.stringify(keys.map((k) => [k, String(breakdown![k])]))).digest('hex');
  }

  private isManager(actor: Actor) {
    return (MANAGER_ROLES as readonly string[]).includes(actor.role);
  }

  /** Bộ phận chỉ thấy và sửa chỉ tiêu của mình; Văn phòng/quản trị/lãnh đạo thấy toàn bộ. */
  private assertOwner(actor: Actor, ind: Indicator, verb: string) {
    if (this.isManager(actor) || actor.role === 'leader') return;
    if (!ind.owner_dept || ind.owner_dept !== actor.department) {
      throw new ForbiddenException(`Chỉ tiêu "${ind.name}" không thuộc bộ phận của bạn — không được ${verb}.`);
    }
  }

  private normalizeValue(raw: number | string, ind: Indicator): string {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) throw new BadRequestException(`Giá trị của "${ind.indicator_id}" không phải số: "${raw}"`);
    if (ind.value_type === 'integer' && !Number.isInteger(n)) {
      throw new BadRequestException(`"${ind.name}" phải là số nguyên, nhận được ${n}`);
    }
    return String(n);
  }

  /** Dòng hiện hành của một khoá (version lớn nhất chưa bị loại). */
  private currentOf(tenantId: string, indicatorId: string, period: string, bkey: string) {
    return this.repo
      .createQueryBuilder('f')
      .where('f.tenant_id = :t AND f.indicator_id = :i AND f.period = :p AND f.breakdown_key = :b', { t: tenantId, i: indicatorId, p: period, b: bkey })
      .orderBy('f.version', 'DESC')
      .getOne();
  }

  private async log(tenantId: string, factId: string, from: string | null, to: string, actorId: number | null, reason?: string | null) {
    await this.logs.save(this.logs.create({ tenant_id: tenantId, fact_id: factId, from_status: from, to_status: to, actor_id: actorId, reason: reason ?? null }));
  }

  /**
   * Nhận bản ghi từ khâu bóc tách hoặc form. Mọi bản ghi vào ở trạng thái `extracted`
   * (Tabot/người nhập không được ghi thẳng số đã duyệt). Quy tắc:
   * - Kỳ đã chốt (dòng hiện hành `locked`) → từ chối.
   * - Nguồn bậc thấp hơn không được đè nguồn bậc cao hơn đã xác nhận → vào `quarantined`.
   * - Trùng y giá trị + ngày chốt với dòng hiện hành → không thêm dòng (idempotent khi nộp lại file).
   */
  async ingest(actor: Actor, records: ExtractedRecord[], channel = 'web'): Promise<IngestOutcome[]> {
    if (!Array.isArray(records) || records.length === 0) throw new BadRequestException('Không có bản ghi nào.');
    const out: IngestOutcome[] = [];
    for (const r of records) {
      const ind = await this.catalog.getIndicatorOrFail(r.indicator_id);
      this.assertOwner(actor, ind, 'nộp số');
      parsePeriod(r.period);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.as_of_date))) throw new BadRequestException(`as_of_date của "${r.indicator_id}" phải dạng YYYY-MM-DD.`);
      if (!(r.capture_method in CAPTURE_RANK)) throw new BadRequestException(`capture_method "${r.capture_method}" không hợp lệ.`);
      const value = this.normalizeValue(r.value, ind);
      const bkey = FactsService.breakdownKey(r.breakdown);
      const cur = await this.currentOf(actor.tenant_id, r.indicator_id, r.period, bkey);
      // số đã được người xác nhận/duyệt/chốt gần nhất (bỏ qua bản đang cách ly/đã loại) — mốc để so bậc nguồn và mâu thuẫn cùng bậc
      const verified = cur && DONE.includes(cur.status) ? cur : await this.repo.createQueryBuilder('f').where('f.tenant_id = :t AND f.indicator_id = :i AND f.period = :p AND f.breakdown_key = :b AND f.status IN (:...st)', { t: actor.tenant_id, i: r.indicator_id, p: r.period, b: bkey, st: DONE }).orderBy('f.version', 'DESC').getOne();

      if (cur?.status === 'locked') {
        throw new BadRequestException(`Kỳ ${r.period} của "${ind.name}" đã chốt — không nhận số mới. Cần Văn phòng mở lại kỳ.`);
      }
      if (cur && Number(cur.value) === Number(value) && cur.as_of_date === r.as_of_date && cur.status !== 'rejected' && cur.status !== 'quarantined') {
        out.push({ fact_id: cur.id, indicator_id: cur.indicator_id, status: cur.status, version: cur.version, note: 'Trùng số hiện có — không thêm dòng.' });
        continue;
      }

      let status: FactStatus = 'extracted';
      let note: string | null = null;
      if (verified && CAPTURE_RANK[r.capture_method] > CAPTURE_RANK[verified.capture_method] && Number(verified.value) !== Number(value)) {
        status = 'quarantined';
        note = `Nguồn "${r.capture_method}" (bậc ${CAPTURE_RANK[r.capture_method]}) lệch số đã xác nhận từ nguồn "${verified.capture_method}" (bậc ${CAPTURE_RANK[verified.capture_method]}): ${verified.value} → ${value}.`;
      } else if (verified && CAPTURE_RANK[r.capture_method] === CAPTURE_RANK[verified.capture_method] && Number(verified.value) !== Number(value)) {
        // Thiết kế 03/10 mục 8: hai nguồn cùng bậc mâu thuẫn → Data Owner quyết trong 2 ngày làm việc, ghi lý do vào audit log
        status = 'quarantined';
        note = `Hai nguồn cùng bậc (${r.capture_method}) mâu thuẫn: số đã xác nhận ${verified.value}, số mới ${value}. Người đại diện phòng quyết trong 2 ngày làm việc (hạn ${vnDate(businessDaysFrom(new Date(), 2))}).`;
      }

      const saved = await this.repo.save(
        this.repo.create({
          tenant_id: actor.tenant_id,
          indicator_id: r.indicator_id,
          period: r.period,
          as_of_date: r.as_of_date,
          value,
          breakdown: r.breakdown ?? {},
          breakdown_key: bkey,
          source_ref: r.source_ref ?? {},
          source_file_id: r.source_file_id ?? r.source_ref?.file_id ?? null,
          capture_method: r.capture_method,
          confidence: String(Math.max(0, Math.min(1, r.confidence ?? 1))),
          status,
          version: (cur?.version ?? 0) + 1,
          supersedes_id: cur?.id ?? null,
          channel,
          created_by: actor.id,
          note,
        }),
      );
      await this.log(actor.tenant_id, saved.id, null, status, actor.id, note);
      out.push({ fact_id: saved.id, indicator_id: saved.indicator_id, status, version: saved.version, note: note ?? undefined });
    }
    return out;
  }

  private async load(actor: Actor, id: string): Promise<{ fact: FactIndicator; ind: Indicator }> {
    const fact = await this.repo.findOne({ where: { id, tenant_id: actor.tenant_id } });
    if (!fact) throw new NotFoundException('Không tìm thấy bản ghi số liệu.');
    const ind = await this.catalog.getIndicatorOrFail(fact.indicator_id);
    return { fact, ind };
  }

  private async assertCurrent(fact: FactIndicator) {
    const cur = await this.currentOf(fact.tenant_id, fact.indicator_id, fact.period, fact.breakdown_key);
    if (cur && cur.id !== fact.id) throw new BadRequestException(`Bản ghi này đã được thay bằng phiên bản ${cur.version} — thao tác trên phiên bản mới nhất.`);
  }

  /** Chuyên viên lĩnh vực xác nhận số bóc được: extracted → confirmed. */
  async confirm(actor: Actor, id: string) {
    const { fact, ind } = await this.load(actor, id);
    this.assertOwner(actor, ind, 'xác nhận');
    if (fact.status !== 'extracted') throw new BadRequestException(`Chỉ xác nhận được số đang ở trạng thái "extracted" (hiện: ${fact.status}).`);
    await this.assertCurrent(fact);
    // Quality Gate nhóm "Số học": sai → Quarantine + báo Data Owner, không cho qua
    const issues = fact.breakdown_key === '' ? await this.gate.checksForIndicator(fact.tenant_id, fact.period, fact.indicator_id, Number(fact.value)) : [];
    if (issues.length) {
      const note = issues.map((i) => i.message).join(' | ');
      await this.repo.update(fact.id, { status: 'quarantined', note });
      await this.log(fact.tenant_id, fact.id, 'extracted', 'quarantined', actor.id, note);
      await this.notifyOwner(ind, `Số "${ind.name}" kỳ ${fact.period} không qua kiểm tra số học`, note, fact.id, fact.period, fact.tenant_id);
      return { ...(await this.repo.findOne({ where: { id: fact.id } })), gate: issues };
    }
    await this.repo.update(fact.id, { status: 'confirmed', confirmed_by: actor.id, confirmed_at: new Date() });
    await this.log(fact.tenant_id, fact.id, 'extracted', 'confirmed', actor.id);
    return this.repo.findOne({ where: { id: fact.id } });
  }

  /**
   * Chuyên viên sửa số bóc sai: KHÔNG ghi đè — thêm phiên bản mới ở trạng thái `confirmed`
   * (người sửa chính là người xác nhận), dòng cũ chuyển `rejected` kèm lý do.
   * Cặp (giá trị bóc, giá trị sửa) là nhãn để cải thiện luật/mô hình về sau.
   */
  async correct(actor: Actor, id: string, dto: { value: number | string; as_of_date?: string; reason?: string }) {
    const { fact, ind } = await this.load(actor, id);
    this.assertOwner(actor, ind, 'sửa');
    if (fact.status === 'locked') throw new BadRequestException('Số đã chốt kỳ — không sửa được. Cần Văn phòng mở lại kỳ.');
    await this.assertCurrent(fact);
    const value = this.normalizeValue(dto.value, ind);
    const asOf = dto.as_of_date ?? fact.as_of_date;
    if (Number(value) === Number(fact.value) && asOf === fact.as_of_date) throw new BadRequestException('Giá trị mới trùng giá trị cũ.');
    const reason = dto.reason?.trim() || `Sửa từ ${fact.value} thành ${value}`;

    return this.ds.transaction(async (m) => {
      const next = await m.save(
        m.create(FactIndicator, {
          tenant_id: fact.tenant_id,
          indicator_id: fact.indicator_id,
          period: fact.period,
          as_of_date: asOf,
          value,
          breakdown: fact.breakdown,
          breakdown_key: fact.breakdown_key,
          source_ref: fact.source_ref,
          source_file_id: fact.source_file_id,
          capture_method: fact.capture_method,
          confidence: '1',
          status: 'confirmed',
          version: fact.version + 1,
          supersedes_id: fact.id,
          channel: fact.channel,
          created_by: actor.id,
          confirmed_by: actor.id,
          confirmed_at: new Date(),
          note: reason,
        }),
      );
      const prev = fact.status;
      await m.update(FactIndicator, fact.id, { status: 'rejected', note: `Thay bằng phiên bản ${next.version}: ${reason}` });
      await m.save(m.create(FactStatusLog, { tenant_id: fact.tenant_id, fact_id: fact.id, from_status: prev, to_status: 'rejected', actor_id: actor.id, reason }));
      await m.save(m.create(FactStatusLog, { tenant_id: fact.tenant_id, fact_id: next.id, from_status: null, to_status: 'confirmed', actor_id: actor.id, reason }));
      return next;
    });
  }

  /**
   * Ai được duyệt số của một chỉ tiêu: Văn phòng/quản trị, lãnh đạo xã, hoặc NGƯỜI ĐẠI DIỆN PHÒNG chủ dữ liệu
   * (departments.head_admin_id). Chuyên viên thường không tự duyệt số mình xác nhận (thiết kế: Data Owner duyệt).
   */
  private async assertDataOwner(actor: Actor, ind: Indicator) {
    if (this.isManager(actor) || actor.role === 'leader') return;
    if (!ind.owner_dept) throw new ForbiddenException(`Chỉ tiêu "${ind.name}" chưa gán phòng chủ dữ liệu — Văn phòng duyệt.`);
    const dept = await this.departments.findOne({ where: { key: ind.owner_dept } });
    if (dept?.head_admin_id !== actor.id) throw new ForbiddenException(`Chỉ người đại diện phòng "${dept?.name ?? ind.owner_dept}" (Data Owner) mới duyệt được "${ind.name}".`);
  }

  /** Lãnh đạo bộ phận (Data Owner) duyệt: confirmed → approved. */
  async approve(actor: Actor, ids: string[]) {
    const facts = await this.repo.find({ where: { id: In(ids), tenant_id: actor.tenant_id } });
    if (facts.length !== ids.length) throw new NotFoundException('Có bản ghi không tồn tại.');
    for (const fact of facts) {
      const ind = await this.catalog.getIndicatorOrFail(fact.indicator_id);
      await this.assertDataOwner(actor, ind);
      if (fact.status !== 'confirmed') throw new BadRequestException(`"${ind.name}" đang ở trạng thái ${fact.status} — chỉ duyệt được số đã xác nhận.`);
      await this.assertCurrent(fact);
    }
    for (const fact of facts) {
      await this.repo.update(fact.id, { status: 'approved', approved_by: actor.id, approved_at: new Date() });
      await this.log(fact.tenant_id, fact.id, 'confirmed', 'approved', actor.id);
    }
    return { approved: facts.length };
  }

  /**
   * Data Owner QUYẾT số đang cách ly (thiết kế 03/10 mục 8): chấp nhận → số cách ly thành số hiện hành đã duyệt, số cũ bị thay
   * chuyển rejected; loại → rejected. Lý do bắt buộc, ghi vào nhật ký trạng thái (audit).
   */
  async resolve(actor: Actor, id: string, decision: 'accept' | 'reject', reason: string) {
    const { fact, ind } = await this.load(actor, id);
    if (fact.status !== 'quarantined') throw new BadRequestException('Chỉ quyết được số đang cách ly.');
    if (!reason?.trim()) throw new BadRequestException('Phải ghi lý do quyết.');
    await this.assertDataOwner(actor, ind);
    if (decision === 'reject') {
      await this.repo.update(fact.id, { status: 'rejected', note: `Data Owner loại: ${reason.trim()}` });
      await this.log(fact.tenant_id, fact.id, 'quarantined', 'rejected', actor.id, reason.trim());
      return { ok: true, decision, fact_id: fact.id };
    }
    if (fact.breakdown_key === '') {
      const issues = await this.gate.checksForIndicator(fact.tenant_id, fact.period, fact.indicator_id, Number(fact.value));
      if (issues.length) throw new BadRequestException({ message: `Số này vẫn không qua kiểm tra số học: ${issues.map((i) => i.title ?? i.message).join(' | ')}. Sửa các số liên quan trước.`, gate: issues });
    }
    // số hiện hành ĐÃ XÁC NHẬN/DUYỆT bị thay (bản cách ly thường là phiên bản mới nhất nên không dùng currentOf)
    const cur = await this.repo.createQueryBuilder('f').where('f.tenant_id = :t AND f.indicator_id = :i AND f.period = :p AND f.breakdown_key = :b AND f.status IN (:...st) AND f.id <> :me', { t: fact.tenant_id, i: fact.indicator_id, p: fact.period, b: fact.breakdown_key, st: DONE, me: fact.id }).orderBy('f.version', 'DESC').getOne();
    if (cur?.status === 'locked') throw new BadRequestException('Kỳ đã chốt — không thay số được.');
    return this.ds.transaction(async (m) => {
      if (cur && cur.id !== fact.id) {
        await m.update(FactIndicator, cur.id, { status: 'rejected', note: `Thay bằng số Data Owner chấp nhận (${fact.value}): ${reason.trim()}` });
        await m.save(m.create(FactStatusLog, { tenant_id: fact.tenant_id, fact_id: cur.id, from_status: cur.status, to_status: 'rejected', actor_id: actor.id, reason: reason.trim() }));
      }
      await m.update(FactIndicator, fact.id, { status: 'approved', note: `Data Owner chấp nhận: ${reason.trim()}`, confirmed_by: actor.id, confirmed_at: new Date(), approved_by: actor.id, approved_at: new Date(), version: Math.max(fact.version, (cur?.version ?? 0) + 1), supersedes_id: cur ? cur.id : fact.supersedes_id });
      await m.save(m.create(FactStatusLog, { tenant_id: fact.tenant_id, fact_id: fact.id, from_status: 'quarantined', to_status: 'approved', actor_id: actor.id, reason: reason.trim() }));
      return { ok: true, decision, fact_id: fact.id, replaced: cur && cur.id !== fact.id ? cur.id : null };
    });
  }

  /** Data Owner loại một số (extracted/confirmed/quarantined) kèm lý do. */
  async reject(actor: Actor, id: string, reason: string) {
    const { fact, ind } = await this.load(actor, id);
    this.assertOwner(actor, ind, 'loại');
    if (!reason?.trim()) throw new BadRequestException('Phải ghi lý do loại.');
    if (fact.status === 'locked') throw new BadRequestException('Số đã chốt kỳ — không loại được.');
    const prev = fact.status;
    await this.repo.update(fact.id, { status: 'rejected', note: reason.trim() });
    await this.log(fact.tenant_id, fact.id, prev, 'rejected', actor.id, reason.trim());
    return { ok: true };
  }

  /**
   * Bộ số hiện hành của một kỳ: mỗi (chỉ tiêu, phân tổ) lấy phiên bản mới nhất chưa bị loại/cách ly.
   * Đây là thứ màn hình xác nhận, Quality Gate và bộ sinh báo cáo cùng đọc.
   */
  async currentForPeriod(tenantId: string, period: string, opts: { domain?: string; ownerDept?: string | null; statuses?: FactStatus[] } = {}) {
    parsePeriod(period);
    const params: any[] = [tenantId, period];
    let extra = '';
    if (opts.domain) { params.push(opts.domain); extra += ` AND i.domain = $${params.length}`; }
    if (opts.ownerDept) { params.push(opts.ownerDept); extra += ` AND i.owner_dept = $${params.length}`; }
    const rows = await this.ds.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (f.indicator_id, f.breakdown_key)
                f.id, f.indicator_id, i.name, i.unit, i.value_type, i.domain, i.owner_dept, i.aggregation,
                f.period, f.as_of_date::text AS as_of_date, f.value::float8 AS value, f.breakdown, f.source_ref, f.source_file_id,
                f.capture_method, f.confidence::float8 AS confidence, f.status, f.version, f.note,
                f.confirmed_by, f.approved_by, f.created_at
           FROM fact_indicator f JOIN dim_indicator i ON i.indicator_id = f.indicator_id
          WHERE f.tenant_id = $1 AND f.period = $2 AND f.status NOT IN ('rejected', 'quarantined') ${extra}
          ORDER BY f.indicator_id, f.breakdown_key, f.version DESC
       ) x ORDER BY x.domain, x.indicator_id`,
      params,
    );
    return opts.statuses?.length ? rows.filter((r: any) => opts.statuses!.includes(r.status)) : rows;
  }

  /** Vùng Quarantine của đơn vị — Data Owner xử lý. */
  /** Số đang cách ly kèm hạn quyết (2 ngày làm việc kể từ lúc cách ly) để Data Owner thấy việc quá hạn. */
  async quarantine(tenantId: string) {
    const rows = await this.repo.find({ where: { tenant_id: tenantId, status: 'quarantined' }, order: { created_at: 'DESC' }, take: 200 });
    return rows.map((f) => { const deadline = businessDaysFrom(new Date(f.created_at), 2); return { ...f, deadline: deadline.toISOString().slice(0, 10), overdue: Date.now() > deadline.getTime() }; });
  }

  /** Lịch sử một chỉ tiêu trong kỳ: mọi phiên bản + nhật ký trạng thái (truy vết). */
  async history(tenantId: string, indicatorId: string, period: string) {
    const versions = await this.repo.find({ where: { tenant_id: tenantId, indicator_id: indicatorId, period }, order: { version: 'ASC' } });
    const logs = versions.length
      ? await this.logs.find({ where: { fact_id: In(versions.map((v) => v.id)) }, order: { created_at: 'ASC' } })
      : [];
    return { versions, logs };
  }
}
