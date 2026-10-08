import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface ObjectTypeDef {
  key: string; name: string; ownership: string; master_source?: string; storage: 'builtin' | 'dim_object' | 'aggregate_only'; builtin_table?: string;
  code_prefix?: string; freshness_days?: number; fields?: { key: string; name: string; type: string; identity?: boolean }[];
  events?: string[]; relations_out?: string[]; indicators?: string[]; alerts?: { key: string; name: string; rule: string }[];
}
export interface RelationTypeDef { key: string; name: string; source: string; target: string }
export interface EventTypeDef { key: string; name: string; object_types: string[]; values?: string[]; indicator?: string }
export interface DatasetDef { code: string; name: string; object_types: string[]; ownership: string; structured: string; refresh: string; indicators: string[]; primary_key?: string; quality_threshold?: number; probe?: Record<string, string> }
export interface SourceDef { key: string; name: string; owner: string; steward?: string; ingestion: string; api_available: boolean; status: string; permission_class: string; datasets: DatasetDef[] }
export interface DashboardCard { indicator: string; pair_with?: string; label?: string; plan?: boolean; breakdown?: string[]; bad_if?: string; drill?: string; funnel?: string[]; lower_is_better?: boolean; data_health?: boolean }
export interface DashboardDomain { key: string; name: string; nav?: string; roles?: string[]; cards?: DashboardCard[]; tabs?: { key: string; name: string; cards: DashboardCard[] }[]; objects?: string }

/** Nạp các từ điển cấu hình của Data Core (config/objects, data-map, dashboard, notifications) — cache 60 giây, đổi YAML không cần sửa code. */
@Injectable()
export class DictionaryService {
  private cache = new Map<string, { at: number; doc: any }>();

  configDir(): string { return process.env.CONFIG_DIR || path.resolve(process.cwd(), '..', '..', 'config'); }

  private load<T = any>(rel: string, fallback: T): T {
    const hit = this.cache.get(rel);
    if (hit && Date.now() - hit.at < 60_000) return hit.doc as T;
    const p = path.join(this.configDir(), rel);
    let doc: T = fallback;
    try { if (fs.existsSync(p)) doc = (yaml.load(fs.readFileSync(p, 'utf8')) as T) ?? fallback; } catch { doc = fallback; }
    this.cache.set(rel, { at: Date.now(), doc });
    return doc;
  }

  reload() { this.cache.clear(); return { ok: true }; }

  objectTypes(): ObjectTypeDef[] { return this.load<any>('objects/types.yaml', { types: [] }).types ?? []; }
  objectType(key: string): ObjectTypeDef | undefined { return this.objectTypes().find((t) => t.key === key); }
  relationTypes(): RelationTypeDef[] { return this.load<any>('objects/relations.yaml', { relations: [] }).relations ?? []; }
  eventTypes(): EventTypeDef[] { return this.load<any>('objects/events.yaml', { events: [] }).events ?? []; }
  sources(): SourceDef[] { return this.load<any>('data-map/sources.yaml', { sources: [] }).sources ?? []; }
  dashboardDomains(): DashboardDomain[] { return this.load<any>('dashboard/domains.yaml', { domains: [] }).domains ?? []; }
  notificationRules(): any { return this.load<any>('notifications/rules.yaml', { rules: [], tiers: {}, classification: { deny_patterns: [] }, digest: {} }); }

  /** Tên chuẩn hoá để đối soát trùng: bỏ dấu tiếng Việt, thường, bỏ từ pháp lý thường gặp, gộp khoảng trắng. */
  static normalizeName(s: string): string {
    const noAccent = (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
    return noAccent.replace(/\b(cong ty|cty|tnhh|co\.?,? ?ltd|jsc|cp|co phan|mtv|mot thanh vien|ho kinh doanh|hkd|du an|cong trinh)\b/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
