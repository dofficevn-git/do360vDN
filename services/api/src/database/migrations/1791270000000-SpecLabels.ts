import { MigrationInterface, QueryRunner } from "typeorm";

/** Ngôn ngữ cán bộ: tên slot, nhãn phép kiểm, tên mục của mẫu báo cáo; vai HĐND (council) không cần đổi schema. */
export class SpecLabels1791270000000 implements MigrationInterface {
    name = 'SpecLabels1791270000000'

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "report_slot" ADD "title" character varying`);
        await q.query(`ALTER TABLE "report_slot" ADD "check_labels" jsonb NOT NULL DEFAULT '{}'`);
        await q.query(`ALTER TABLE "report_slot" ADD "narrative_template" text`);
        await q.query(`ALTER TABLE "report_spec" ADD "sections" jsonb NOT NULL DEFAULT '{}'`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "report_spec" DROP COLUMN "sections"`);
        await q.query(`ALTER TABLE "report_slot" DROP COLUMN "narrative_template"`);
        await q.query(`ALTER TABLE "report_slot" DROP COLUMN "check_labels"`);
        await q.query(`ALTER TABLE "report_slot" DROP COLUMN "title"`);
    }
}
