import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Kho chỉ tiêu CHỈ THÊM, KHÔNG GHI ĐÈ — ép ở tầng CSDL để lỗi code hay thao tác tay cũng không sửa được số:
 * - fact_indicator: cấm DELETE; cấm UPDATE các cột định danh và giá trị (tenant, chỉ tiêu, kỳ, ngày chốt,
 *   giá trị, phân tổ, nguồn, phương thức, phiên bản). Chỉ các cột luồng duyệt được đổi.
 *   Dòng đã `locked` thì không đổi được gì nữa, trừ khi phiên làm việc bật `do360.allow_unlock`
 *   (chỉ thao tác "mở lại kỳ" của Văn phòng bật cờ này, có audit log).
 * - fact_status_log, event_log: cấm UPDATE và DELETE.
 */
export class FactImmutability1791167600000 implements MigrationInterface {
    name = 'FactImmutability1791167600000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION do360_fact_guard() RETURNS trigger AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'fact_indicator chi them, khong xoa (id=%)', OLD.id USING ERRCODE = 'restrict_violation';
              END IF;
              IF NEW.tenant_id      IS DISTINCT FROM OLD.tenant_id
              OR NEW.indicator_id   IS DISTINCT FROM OLD.indicator_id
              OR NEW.period         IS DISTINCT FROM OLD.period
              OR NEW.as_of_date     IS DISTINCT FROM OLD.as_of_date
              OR NEW.value          IS DISTINCT FROM OLD.value
              OR NEW.breakdown      IS DISTINCT FROM OLD.breakdown
              OR NEW.breakdown_key  IS DISTINCT FROM OLD.breakdown_key
              OR NEW.source_ref     IS DISTINCT FROM OLD.source_ref
              OR NEW.source_file_id IS DISTINCT FROM OLD.source_file_id
              OR NEW.capture_method IS DISTINCT FROM OLD.capture_method
              OR NEW.version        IS DISTINCT FROM OLD.version
              OR NEW.supersedes_id  IS DISTINCT FROM OLD.supersedes_id
              OR NEW.created_by     IS DISTINCT FROM OLD.created_by
              OR NEW.created_at     IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'fact_indicator: khong ghi de gia tri/nguon cua ban ghi % - sua so thi them phien ban moi', OLD.id USING ERRCODE = 'restrict_violation';
              END IF;
              IF OLD.status = 'locked' AND COALESCE(current_setting('do360.allow_unlock', true), '') <> 'on' THEN
                RAISE EXCEPTION 'fact_indicator: ban ghi % da chot ky, khong doi duoc', OLD.id USING ERRCODE = 'restrict_violation';
              END IF;
              RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        await queryRunner.query(`CREATE TRIGGER trg_fact_indicator_immutable BEFORE UPDATE OR DELETE ON fact_indicator FOR EACH ROW EXECUTE FUNCTION do360_fact_guard()`);

        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION do360_append_only() RETURNS trigger AS $$
            BEGIN
              RAISE EXCEPTION '% chi them, khong sua/xoa', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
            END;
            $$ LANGUAGE plpgsql;
        `);
        await queryRunner.query(`CREATE TRIGGER trg_fact_status_log_append_only BEFORE UPDATE OR DELETE ON fact_status_log FOR EACH ROW EXECUTE FUNCTION do360_append_only()`);
        await queryRunner.query(`CREATE TRIGGER trg_event_log_append_only BEFORE UPDATE OR DELETE ON event_log FOR EACH ROW EXECUTE FUNCTION do360_append_only()`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER IF EXISTS trg_event_log_append_only ON event_log`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS trg_fact_status_log_append_only ON fact_status_log`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS do360_append_only()`);
        await queryRunner.query(`DROP TRIGGER IF EXISTS trg_fact_indicator_immutable ON fact_indicator`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS do360_fact_guard()`);
    }
}
