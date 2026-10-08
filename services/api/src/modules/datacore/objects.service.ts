import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { DimObject, DocumentObjectLink, ObjectRelation } from './datacore.entities';
import { DictionaryService } from './dictionary.service';
import { EventLog } from '../events/event-log.entity';
import { Actor } from '../facts/facts.service';
import { MANAGER_ROLES } from '../../common/roles';

/** Mã Object trong event_log theo thiết kế 03/10 mục 4: DOC văn bản · TSK nhiệm vụ · PRJ công trình, dự án · ORG đơn vị, tổ dân phố, tổ chức · IND chỉ tiêu · KNOW tri thức */
export const OBJECT_CODE: Record<string, string> = { du_an: 'PRJ', cong_trinh: 'PRJ', dia_ban: 'ORG', to_chuc: 'ORG', ho_kinh_doanh: 'ORG', don_vi: 'ORG', van_ban: 'DOC', nhiem_vu: 'TSK', chi_tieu: 'IND', bao_cao: 'KNOW' };

export interface ObjectInput {
  object_type: string; code?: string; name: string; status?: string; master_id?: string | null; master_source?: string | null;
  external_ids?: Record<string, string>; attributes?: Record<string, unknown>; ownership_type?: string; data_owner_dept?: string | null;
  provenance?: Record<string, unknown>; verification_status?: string; valid_from?: string | null; valid_to?: string | null; force?: boolean;
  relations?: { relation_type: string; target_uid?: string; target_code?: string; target_name?: string }[];
  events?: { event_type: string; event_date: string; values?: Record<string, unknown>; note?: string; source_ref?: Record<string, unknown> }[];
}

/**
 * Object Service (Blueprint mục 8–11, 18): tạo/sửa Object có đối soát trùng (Entity Resolution), quan hệ, sự kiện gắn Object,
 * tài liệu gắn Object, Object 360. Mọi thay đổi ghi refreshed_at (SỐNG) và provenance (ĐÚNG).
 */
@Injectable()
export class ObjectsService {
  private readonly logger = new Logger(ObjectsService.name);
  constructor(
    @InjectRepository(DimObject) private objects: Repository<DimObject>,
    @InjectRepository(ObjectRelation) private relations: Repository<ObjectRelation>,
    @InjectRepository(DocumentObjectLink) private links: Repository<DocumentObjectLink>,
    @InjectRepository(EventLog) private events: Repository<EventLog>,
    @InjectDataSource() private ds: DataSource,
    private dict: DictionaryService,
  ) {}

  private isManager(a: Actor) { return (MANAGER_ROLES as readonly string[]).includes(a.role) || a.role === 'leader'; }

  private assertCanEdit(actor: Actor, type: string, dept?: string | null) {
    if (this.isManager(actor)) return;
    const def = this.dict.objectType(type);
    const owner = dept ?? null;
    if (actor.role !== 'department_staff' || (owner && owner !== actor.department)) throw new ForbiddenException(`Chỉ phòng chủ dữ liệu hoặc Văn phòng được sửa ${def?.name ?? type}.`);
  }

  dictionary() {
    return { types: this.dict.objectTypes(), relations: this.dict.relationTypes(), events: this.dict.eventTypes() };
  }

  async counts(tenantId: string) {
    const rows: { object_type: string; n: number; stale: number; verified: number; mapped: number }[] = await this.ds.query(
      `SELECT object_type, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE verification_status = 'verified')::int AS verified, COUNT(*) FILTER (WHERE master_id IS NOT NULL)::int AS mapped,
              COUNT(*) FILTER (WHERE refreshed_at < now() - interval '30 days')::int AS stale
         FROM dim_object WHERE tenant_id = $1 AND status <> 'deleted' GROUP BY object_type`, [tenantId]);
    const builtin: Record<string, number> = {};
    const [{ n: vb }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM qlvb_document WHERE tenant_id = $1`, [tenantId]);
    const [{ n: nv }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM tasks WHERE tenant_id = $1`, [tenantId]);
    const [{ n: bc }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM report_run WHERE tenant_id = $1 AND status <> 'cancelled'`, [tenantId]);
    const [{ n: ct }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM dim_indicator WHERE is_active`);
    builtin.van_ban = vb; builtin.nhiem_vu = nv; builtin.bao_cao = bc; builtin.chi_tieu = ct; builtin.don_vi = 1;
    return this.dict.objectTypes().map((t) => {
      const r = rows.find((x) => x.object_type === t.key);
      return { key: t.key, name: t.name, ownership: t.ownership, storage: t.storage, master_source: t.master_source ?? null, freshness_days: t.freshness_days ?? null,
        count: t.storage === 'dim_object' ? r?.n ?? 0 : builtin[t.key] ?? null, verified: r?.verified ?? null, mapped: r?.mapped ?? null, stale: r?.stale ?? null };
    });
  }

  async list(tenantId: string, q: { type?: string; q?: string; status?: string; limit?: number; alerts?: boolean }) {
    const qb = this.objects.createQueryBuilder('o').where('o.tenant_id = :t', { t: tenantId }).andWhere("o.status <> 'deleted'").orderBy('o.object_type', 'ASC').addOrderBy('o.code', 'ASC').take(Math.min(500, q.limit || 200));
    if (q.type) qb.andWhere('o.object_type = :ty', { ty: q.type });
    if (q.status) qb.andWhere('o.status = :st', { st: q.status });
    if (q.q) qb.andWhere('(o.name_norm LIKE :q OR o.code ILIKE :qq OR o.master_id ILIKE :qq)', { q: `%${DictionaryService.normalizeName(q.q)}%`, qq: `%${q.q}%` });
    const rows = await qb.getMany();
    return rows.map((o) => this.decorate(o));
  }

  /** Trạng thái SỐNG + cảnh báo nghiệp vụ (dự án chậm tiến độ, giải ngân thấp…) tính tại chỗ từ thuộc tính. */
  decorate(o: DimObject) {
    const def = this.dict.objectType(o.object_type);
    const days = def?.freshness_days ?? 30;
    const ageDays = (Date.now() - new Date(o.refreshed_at).getTime()) / 86_400_000;
    const freshness = ageDays > days * 2 ? 'needs_refresh' : ageDays > days ? 'stale' : 'current';
    const alerts: { key: string; name: string; detail: string }[] = [];
    const a: any = o.attributes ?? {};
    if (o.object_type === 'du_an' && o.status === 'active') {
      const today = new Date();
      if (a.han_hoan_thanh) {
        const dl = new Date(a.han_hoan_thanh); const left = (dl.getTime() - today.getTime()) / 86_400_000;
        const tienDo = Number(a.tien_do ?? 0);
        if (left < 0 && tienDo < 100) alerts.push({ key: 'qua_han', name: 'Quá hạn hoàn thành', detail: `Hạn ${String(a.han_hoan_thanh).split('-').reverse().join('/')}, tiến độ ${tienDo}%` });
        else if (left < 90 && tienDo < 75) alerts.push({ key: 'cham_tien_do', name: 'Chậm tiến độ', detail: `Còn ${Math.ceil(left)} ngày đến hạn, tiến độ ${tienDo}%` });
      }
      const kh = Number(a.ke_hoach_von ?? 0); const gn = Number(a.giai_ngan ?? 0);
      if (kh > 0 && today.getMonth() + 1 >= 9 && gn / kh < 0.5) alerts.push({ key: 'giai_ngan_thap', name: 'Giải ngân thấp', detail: `Mới ${Math.round((gn / kh) * 100)}% kế hoạch vốn năm` });
      if (a.vuong_mac) alerts.push({ key: 'vuong_mac', name: 'Có vướng mắc', detail: String(a.vuong_mac).slice(0, 120) });
    }
    if (freshness !== 'current') alerts.push({ key: 'stale', name: 'Quá hạn cập nhật', detail: `Cập nhật lần cuối ${Math.floor(ageDays)} ngày trước (chu kỳ ${days} ngày)` });
    return { ...o, type_name: def?.name ?? o.object_type, freshness_status: freshness, age_days: Math.floor(ageDays), alerts };
  }

  async get(tenantId: string, uid: string) {
    if (!/^[0-9a-f-]{36}$/i.test(uid ?? '')) throw new NotFoundException('Mã đối tượng không hợp lệ.');
    const o = await this.objects.findOne({ where: { uid, tenant_id: tenantId } });
    if (!o) throw new NotFoundException('Không tìm thấy đối tượng.');
    return o;
  }

  /** Entity Resolution (Blueprint mục 18): master_id → mã định danh → tên chuẩn hoá → gần đúng (trigram đơn giản). */
  async resolve(tenantId: string, input: { object_type: string; name?: string; master_id?: string | null; external_ids?: Record<string, string> }) {
    const cands = await this.objects.find({ where: { tenant_id: tenantId, object_type: input.object_type } });
    const out: { uid: string; code: string; name: string; score: number; reason: string }[] = [];
    const norm = input.name ? DictionaryService.normalizeName(input.name) : '';
    for (const c of cands) {
      if (c.status === 'deleted') continue;
      if (input.master_id && c.master_id && c.master_id === input.master_id) { out.push({ uid: c.uid, code: c.code, name: c.name, score: 1, reason: 'Trùng Master ID' }); continue; }
      const ext = input.external_ids ?? {};
      const hitKey = Object.keys(ext).find((k) => ext[k] && (c.external_ids as any)?.[k] === ext[k]);
      if (hitKey) { out.push({ uid: c.uid, code: c.code, name: c.name, score: 0.98, reason: `Trùng mã ${hitKey}` }); continue; }
      if (norm && c.name_norm === norm) { out.push({ uid: c.uid, code: c.code, name: c.name, score: 0.9, reason: 'Trùng tên (đã chuẩn hoá)' }); continue; }
      if (norm && norm.length >= 6) {
        const sim = ObjectsService.trigram(norm, c.name_norm);
        if (sim >= 0.6) out.push({ uid: c.uid, code: c.code, name: c.name, score: Math.round(sim * 100) / 100, reason: 'Tên gần giống — cần người xác nhận' });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  static trigram(a: string, b: string): number {
    const grams = (s: string) => { const g = new Set<string>(); const t = `  ${s} `; for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g; };
    const A = grams(a); const B = grams(b); let inter = 0; for (const g of A) if (B.has(g)) inter++;
    return inter / Math.max(1, Math.max(A.size, B.size));
  }

  private async nextCode(tenantId: string, type: string) {
    const def = this.dict.objectType(type); const prefix = def?.code_prefix ?? type.toUpperCase().slice(0, 3);
    const [{ n }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM dim_object WHERE tenant_id = $1 AND object_type = $2`, [tenantId, type]);
    return `${prefix}-${String(n + 1).padStart(3, '0')}`;
  }

  async create(actor: Actor, input: ObjectInput) {
    const def = this.dict.objectType(input.object_type);
    if (!def) throw new BadRequestException(`Loại đối tượng "${input.object_type}" không có trong từ điển (config/objects/types.yaml).`);
    if (def.storage !== 'dim_object') throw new BadRequestException(`${def.name}: quản lý ở bảng riêng (${def.builtin_table ?? def.storage}), không tạo trong Object Directory.`);
    if (!input.name?.trim()) throw new BadRequestException('Thiếu tên đối tượng.');
    this.assertCanEdit(actor, input.object_type, input.data_owner_dept ?? actor.department);
    if (!input.force) {
      const dup = await this.resolve(actor.tenant_id, { object_type: input.object_type, name: input.name, master_id: input.master_id, external_ids: input.external_ids });
      if (dup.length && dup[0].score >= 0.9) throw new ConflictException({ message: `Có thể trùng với "${dup[0].name}" (${dup[0].code}): ${dup[0].reason}. Chọn đối tượng đã có hoặc xác nhận tạo mới.`, candidates: dup });
    }
    const code = input.code?.trim() || (await this.nextCode(actor.tenant_id, input.object_type));
    const o = await this.objects.save(this.objects.create({
      tenant_id: actor.tenant_id, object_type: input.object_type, code, name: input.name.trim(), name_norm: DictionaryService.normalizeName(input.name), status: input.status ?? 'active',
      master_id: input.master_id ?? null, master_source: input.master_source ?? def.master_source ?? null, external_ids: input.external_ids ?? {}, attributes: input.attributes ?? {},
      ownership_type: (input.ownership_type ?? def.ownership) as any, data_owner_dept: input.data_owner_dept ?? (actor.role === 'department_staff' ? actor.department : null),
      provenance: { source_type: 'HUMAN', created_by: actor.id, ...(input.provenance ?? {}) }, verification_status: input.verification_status ?? (this.isManager(actor) ? 'verified' : 'pending'),
      valid_from: input.valid_from ?? null, valid_to: input.valid_to ?? null, refreshed_at: new Date(), created_by: actor.id,
    }));
    for (const r of input.relations ?? []) await this.addRelation(actor, o.uid, r);
    for (const e of input.events ?? []) await this.addEvent(actor, o.uid, e);
    return this.get(actor.tenant_id, o.uid);
  }

  /** Nạp hàng loạt (seed, import): khớp theo master_id/mã ngoài/mã code → cập nhật, không thì tạo. */
  async bulk(actor: Actor, items: ObjectInput[]) {
    let created = 0, updated = 0; const uids: string[] = [];
    for (const it of items) {
      const existing = it.code ? await this.objects.findOne({ where: { tenant_id: actor.tenant_id, object_type: it.object_type, code: it.code } }) : null;
      if (existing) { await this.update(actor, existing.uid, it); updated++; uids.push(existing.uid); continue; }
      const o = await this.create(actor, { ...it, force: true }); created++; uids.push(o.uid);
    }
    return { created, updated, uids };
  }

  async update(actor: Actor, uid: string, patch: Partial<ObjectInput>) {
    const o = await this.get(actor.tenant_id, uid);
    this.assertCanEdit(actor, o.object_type, o.data_owner_dept);
    const next: Partial<DimObject> = { refreshed_at: new Date() };
    if (patch.name && patch.name.trim() !== o.name) { next.name = patch.name.trim(); next.name_norm = DictionaryService.normalizeName(patch.name); }
    if (patch.status) next.status = patch.status;
    if (patch.master_id !== undefined) next.master_id = patch.master_id;
    if (patch.master_source !== undefined) next.master_source = patch.master_source;
    if (patch.external_ids) next.external_ids = { ...o.external_ids, ...patch.external_ids };
    if (patch.attributes) next.attributes = { ...o.attributes, ...patch.attributes };
    if (patch.data_owner_dept !== undefined) next.data_owner_dept = patch.data_owner_dept;
    if (patch.verification_status) next.verification_status = patch.verification_status;
    if (patch.valid_from !== undefined) next.valid_from = patch.valid_from;
    if (patch.valid_to !== undefined) next.valid_to = patch.valid_to;
    if (patch.provenance) next.provenance = { ...o.provenance, ...patch.provenance, updated_by: actor.id };
    await this.objects.update(uid, next);
    for (const r of patch.relations ?? []) await this.addRelation(actor, uid, r);
    for (const e of patch.events ?? []) await this.addEvent(actor, uid, e);
    return this.get(actor.tenant_id, uid);
  }

  async verify(actor: Actor, uid: string, status: 'verified' | 'rejected', note?: string) {
    const o = await this.get(actor.tenant_id, uid);
    if (!this.isManager(actor)) {
      const dept = await this.ds.query(`SELECT head_admin_id FROM departments WHERE key = $1`, [o.data_owner_dept]);
      if (dept?.[0]?.head_admin_id !== actor.id) throw new ForbiddenException('Chỉ người đại diện phòng chủ dữ liệu hoặc Văn phòng xác minh được đối tượng.');
    }
    await this.objects.update(uid, { verification_status: status, provenance: { ...o.provenance, verified_by: actor.id, verified_at: new Date().toISOString(), verify_note: note ?? null } });
    return this.get(actor.tenant_id, uid);
  }

  async addRelation(actor: Actor, uid: string, r: { relation_type: string; target_uid?: string; target_code?: string; target_name?: string; source_ref?: Record<string, unknown> }) {
    const def = this.dict.relationTypes().find((x) => x.key === r.relation_type);
    if (!def) throw new BadRequestException(`Loại quan hệ "${r.relation_type}" không có trong từ điển.`);
    let target = r.target_uid ?? null; let name = r.target_name ?? null;
    if (!target && r.target_code) {
      const t = await this.objects.findOne({ where: { tenant_id: actor.tenant_id, code: r.target_code } });
      if (!t) throw new BadRequestException(`Không thấy đối tượng mã ${r.target_code}.`);
      target = t.uid; name = name ?? t.name;
    }
    if (!target) throw new BadRequestException('Quan hệ thiếu đối tượng đích.');
    if (target.length === 36 && !name) { const t = await this.objects.findOne({ where: { uid: target } }); name = t?.name ?? null; }
    const dup = await this.relations.findOne({ where: { tenant_id: actor.tenant_id, relation_type: r.relation_type, source_uid: uid, target_uid: target, status: 'active' } });
    if (dup) return dup;
    return this.relations.save(this.relations.create({ tenant_id: actor.tenant_id, relation_type: r.relation_type, source_uid: uid, target_uid: target, target_name: name, source_ref: r.source_ref ?? { created_by: actor.id } }));
  }

  /** Sự kiện trên Object → event_log (có object_uid); sự kiện mang số (giải ngân) cộng dồn vào thuộc tính tương ứng. */
  async addEvent(actor: Actor, uid: string, e: { event_type: string; event_date: string; values?: Record<string, unknown>; note?: string; source_ref?: Record<string, unknown>; external_id?: string | null }) {
    const o = await this.get(actor.tenant_id, uid);
    const def = this.dict.eventTypes().find((x) => x.key === e.event_type);
    if (!def) throw new BadRequestException(`Loại sự kiện "${e.event_type}" không có trong từ điển.`);
    if (def.object_types?.length && !def.object_types.includes(o.object_type)) throw new BadRequestException(`Sự kiện "${def.name}" không áp dụng cho ${o.object_type}.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.event_date ?? '')) throw new BadRequestException('event_date phải dạng YYYY-MM-DD.');
    const ind = await this.ds.query(`SELECT domain FROM dim_indicator WHERE indicator_id = $1`, [def.indicator ?? '']);
    const ev = await this.events.save(this.events.create({ tenant_id: actor.tenant_id, object_type: OBJECT_CODE[o.object_type] ?? o.object_type.toUpperCase().slice(0, 10), object_id: o.code, object_uid: uid, actor_id: actor.id,
      event_type: e.event_type, event_date: e.event_date, domain: ind?.[0]?.domain ?? null, payload: { name: o.name, values: e.values ?? {}, note: e.note ?? null, event_name: def.name },
      source_ref: e.source_ref ?? { system: 'do360', by: actor.id }, source_system: 'do360', external_id: e.external_id ?? null }));
    const patch: Record<string, unknown> = {};
    const v: any = e.values ?? {};
    if (e.event_type === 'giai_ngan' && v.so_tien != null) patch.giai_ngan = Number((o.attributes as any).giai_ngan ?? 0) + Number(v.so_tien);
    if (e.event_type === 'gpmb' && v.ty_le != null) patch.gpmb = Number(v.ty_le);
    if (e.event_type === 'hoan_thanh') { patch.tien_do = 100; if (o.object_type === 'du_an') await this.objects.update(uid, { status: 'completed' }); }
    if (e.event_type === 'ngung_hoat_dong') await this.objects.update(uid, { status: 'inactive' });
    if (v.tien_do != null) patch.tien_do = Number(v.tien_do);
    await this.objects.update(uid, { attributes: { ...o.attributes, ...patch }, refreshed_at: new Date() });
    return ev;
  }

  async linkDocument(actor: Actor, uid: string, l: { document_kind: string; document_id: number; link_type?: string; note?: string }) {
    await this.get(actor.tenant_id, uid);
    if (!['source_file', 'qlvb_document', 'report_run'].includes(l.document_kind)) throw new BadRequestException('document_kind không hợp lệ.');
    const dup = await this.links.findOne({ where: { tenant_id: actor.tenant_id, object_uid: uid, document_kind: l.document_kind, document_id: l.document_id } });
    if (dup) return dup;
    return this.links.save(this.links.create({ tenant_id: actor.tenant_id, object_uid: uid, document_kind: l.document_kind, document_id: l.document_id, link_type: l.link_type ?? 'evidence', note: l.note ?? null }));
  }

  /** Object 360 (Blueprint mục 52): tổng quan, thuộc tính, quan hệ, timeline, chỉ tiêu, nhiệm vụ, tài liệu, chất lượng, audit. */
  async object360(tenantId: string, uid: string) {
    const o = await this.get(tenantId, uid);
    const def = this.dict.objectType(o.object_type);
    const rels = await this.relations.find({ where: { tenant_id: tenantId, source_uid: uid, status: 'active' }, order: { created_at: 'ASC' } });
    const back = await this.relations.find({ where: { tenant_id: tenantId, target_uid: uid, status: 'active' } });
    const backObjs = back.length ? await this.objects.find({ where: { uid: In(back.map((b) => b.source_uid)) } }) : [];
    const relTypes = new Map(this.dict.relationTypes().map((r) => [r.key, r.name]));
    const evs = await this.events.find({ where: { tenant_id: tenantId, object_uid: uid }, order: { event_date: 'DESC', created_at: 'DESC' }, take: 100 });
    const evTypes = new Map(this.dict.eventTypes().map((e) => [e.key, e.name]));
    const tasks = await this.ds.query(`SELECT t.id, t.code, t.title, t.status, t.due_at::text AS due_at, t.priority, t.target_indicator_id, t.target_value::float8 AS target_value, a.full_name AS assignee FROM tasks t LEFT JOIN admin_users a ON a.id = t.assignee_id WHERE t.object_uid = $1 ORDER BY t.due_at NULLS LAST`, [uid]);
    const links = await this.links.find({ where: { tenant_id: tenantId, object_uid: uid }, order: { created_at: 'DESC' } });
    const docs: any[] = [];
    for (const l of links) {
      if (l.document_kind === 'qlvb_document') { const d = await this.ds.query(`SELECT id, so_ky_hieu, ngay::text AS ngay, loai, trich_yeu, direction FROM qlvb_document WHERE id = $1`, [l.document_id]); if (d[0]) docs.push({ ...l, doc: d[0] }); }
      else if (l.document_kind === 'source_file') { const d = await this.ds.query(`SELECT id, original_name, period, status, created_at::text AS created_at FROM source_file WHERE id = $1`, [l.document_id]); if (d[0]) docs.push({ ...l, doc: d[0] }); }
      else if (l.document_kind === 'report_run') { const d = await this.ds.query(`SELECT run_id AS id, period, status, signed_number, signed_date::text AS signed_date FROM report_run WHERE run_id = $1`, [l.document_id]); if (d[0]) docs.push({ ...l, doc: d[0] }); }
    }
    // chỉ tiêu liên quan: giá trị đơn vị kỳ gần nhất + giá trị riêng của object (breakdown.object = uid)
    const indIds = def?.indicators ?? [];
    const indicators = indIds.length ? await this.ds.query(
      `SELECT i.indicator_id, i.name, i.unit, i.value_type, f.period, f.value::float8 AS value, f.status, f.as_of_date::text AS as_of_date
         FROM dim_indicator i LEFT JOIN LATERAL (SELECT period, value, status, as_of_date FROM fact_indicator x WHERE x.tenant_id = $1 AND x.indicator_id = i.indicator_id AND x.breakdown_key = '' AND x.status IN ('confirmed','approved','locked') ORDER BY x.period DESC, x.version DESC LIMIT 1) f ON true
        WHERE i.indicator_id = ANY($2)`, [tenantId, indIds]) : [];
    const own = await this.ds.query(`SELECT indicator_id, period, value::float8 AS value, status, as_of_date::text AS as_of_date FROM fact_indicator WHERE tenant_id = $1 AND breakdown->>'object' = $2 AND status NOT IN ('rejected','quarantined') ORDER BY period DESC`, [tenantId, uid]);
    const audit = await this.ds.query(`SELECT id, admin_user_id, action, module, created_at::text AS created_at FROM audit_logs WHERE tenant_id = $1 AND module = 'objects' AND (new_value LIKE $2 OR old_value LIKE $2) ORDER BY created_at DESC LIMIT 20`, [tenantId, `%${uid}%`]).catch(() => []);
    const d = this.decorate(o);
    const quality = {
      verification_status: o.verification_status, freshness_status: d.freshness_status, age_days: d.age_days, master_mapped: !!o.master_id,
      completeness: def?.fields?.length ? Math.round((def.fields.filter((f) => (o.attributes as any)?.[f.key] != null && (o.attributes as any)?.[f.key] !== '').length / def.fields.length) * 100) : null,
      provenance: o.provenance,
    };
    return { object: d, type: def ?? null, fields: def?.fields ?? [],
      relations: rels.map((r) => ({ ...r, relation_name: relTypes.get(r.relation_type) ?? r.relation_type })),
      related_from: back.map((b) => ({ ...b, relation_name: relTypes.get(b.relation_type) ?? b.relation_type, source: backObjs.find((x) => x.uid === b.source_uid) ?? null })),
      events: evs.map((e) => ({ ...e, event_name: evTypes.get(e.event_type) ?? e.event_type })), tasks, documents: docs, indicators, own_values: own, quality, audit };
  }

  /**
   * Nạp Object từ BẢNG DANH SÁCH Excel (thiết kế 03/10 "Từ file tải lên đến CSDL": mỗi dòng một công trình, một hộ…).
   * Cột bắt buộc: "Tên"; cột "Mã định danh"/"Master ID" để không trùng bản ghi giữa các kỳ; các cột khác khớp tên thuộc tính trong types.yaml.
   * File đọc qua services/reader (/parse); cùng từ điển, cùng Object ID; dòng trùng Master ID → cập nhật, không tạo mới.
   */
  async importList(actor: Actor, objectType: string, file: { buffer: Buffer; originalname: string }) {
    const def = this.dict.objectType(objectType);
    if (!def || def.storage !== 'dim_object') throw new BadRequestException(`Loại "${objectType}" không nạp từ danh sách được.`);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.buffer)]), file.originalname);
    const readerUrl = (process.env.READER_URL || 'http://localhost:8000').replace(/\/$/, '');
    const res = await fetch(`${readerUrl}/parse`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
    const parsed: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new BadRequestException(parsed?.detail ?? `Không đọc được file (HTTP ${res.status}).`);
    const table = (parsed.tables ?? [])[0];
    if (!table) throw new BadRequestException('File không có bảng.');
    const grid = new Map<string, string>(); let maxRow = 0, maxCol = 0;
    for (const c of table.cells) { grid.set(`${c.row},${c.col}`, String(c.text ?? '').trim()); maxRow = Math.max(maxRow, c.row); maxCol = Math.max(maxCol, c.col); }
    const norm = (s: string) => DictionaryService.normalizeName(s);
    const fieldByName = new Map<string, string>((def.fields ?? []).map((f) => [norm(f.name), f.key]));
    for (const f of def.fields ?? []) fieldByName.set(norm(f.key), f.key);
    let headerRow = 0; const colMap = new Map<number, string>();
    for (let r = 1; r <= Math.min(maxRow, 15) && !headerRow; r++) {
      const cols = new Map<number, string>();
      for (let c = 1; c <= maxCol; c++) {
        const h = norm(grid.get(`${r},${c}`) ?? ''); if (!h) continue;
        if (['ten', 'ten doi tuong', 'ten du an', 'ten cong trinh', 'ten ho kinh doanh', 'ten to chuc'].includes(h) || h.startsWith('ten ')) cols.set(c, '__name');
        else if (['ma dinh danh', 'master id', 'ma so', 'ma chuan'].includes(h) || h.includes('dinh danh')) cols.set(c, '__master');
        else if (['ma', 'ma doi tuong', 'ma do360'].includes(h)) cols.set(c, '__code');
        else if (['trang thai'].includes(h)) cols.set(c, '__status');
        else if (fieldByName.has(h)) cols.set(c, fieldByName.get(h)!);
      }
      if ([...cols.values()].includes('__name')) { headerRow = r; for (const [c, k] of cols) colMap.set(c, k); }
    }
    if (!headerRow) throw new BadRequestException('Không thấy dòng tiêu đề có cột "Tên". Cột: Tên, Mã định danh, và các thuộc tính theo từ điển.');
    const identity = (def.fields ?? []).filter((f) => f.identity).map((f) => f.key);
    const items: ObjectInput[] = []; const skipped: number[] = [];
    for (let r = headerRow + 1; r <= maxRow; r++) {
      const row: Record<string, string> = {}; for (const [c, k] of colMap) row[k] = grid.get(`${r},${c}`) ?? '';
      if (!row.__name) { if (Object.values(row).some(Boolean)) skipped.push(r); continue; }
      const attrs: Record<string, unknown> = {}; const ext: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith('__') || v === '') continue;
        const f = (def.fields ?? []).find((x) => x.key === k);
        attrs[k] = f && ['money', 'integer', 'percent'].includes(f.type) ? Number(String(v).replace(/\./g, '').replace(',', '.')) : f?.type === 'date' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v) ? v.split('/').reverse().map((x, i) => (i ? x.padStart(2, '0') : x)).join('-') : v;
        if (identity.includes(k)) ext[k] = String(v);
      }
      const master = row.__master || (identity.length ? ext[identity[0]] : undefined) || null;
      items.push({ object_type: objectType, name: row.__name, code: row.__code || undefined, master_id: master, external_ids: ext, attributes: attrs, status: row.__status || undefined, provenance: { source_type: 'FILE', file: file.originalname, row: r, by: actor.id }, verification_status: 'pending' });
    }
    // khớp theo Master ID trước, rồi mã; không trùng → tạo mới (bỏ qua đối soát tên vì Master ID là khoá)
    let created = 0, updated = 0; const uids: string[] = [];
    for (const it of items) {
      let existing = it.master_id ? await this.objects.findOne({ where: { tenant_id: actor.tenant_id, object_type: objectType, master_id: it.master_id } }) : null;
      if (!existing && it.code) existing = await this.objects.findOne({ where: { tenant_id: actor.tenant_id, object_type: objectType, code: it.code } });
      if (existing) { await this.update(actor, existing.uid, it); updated++; uids.push(existing.uid); }
      else { const o = await this.create(actor, { ...it, force: true }); created++; uids.push(o.uid); }
    }
    return { object_type: objectType, header_row: headerRow, columns: [...colMap.values()], rows: items.length, created, updated, skipped_rows: skipped, uids };
  }

  /** Danh sách cảnh báo Object (khối "Việc cần xử lý" của bảng điều hành). */
  async alerts(tenantId: string, type?: string) {
    const rows = await this.objects.find({ where: type ? { tenant_id: tenantId, object_type: type, status: 'active' } : { tenant_id: tenantId, status: 'active' } });
    return rows.map((o) => this.decorate(o)).filter((d) => d.alerts.length).map((d) => ({ uid: d.uid, code: d.code, name: d.name, object_type: d.object_type, type_name: d.type_name, alerts: d.alerts, data_owner_dept: d.data_owner_dept }));
  }
}
