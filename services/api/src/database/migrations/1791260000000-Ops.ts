import { MigrationInterface, QueryRunner } from "typeorm";

/** Cảnh báo dữ liệu cá nhân trên file Bronze; bản Word đã biên tập + kết quả đối chiếu trên report_run. */
export class Ops1791260000000 implements MigrationInterface {
    name = 'Ops1791260000000'

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "source_file" ADD "pii_warning" text`);
        await q.query(`ALTER TABLE "report_run" ADD "edited_file" character varying`);
        await q.query(`ALTER TABLE "report_run" ADD "edited_check" jsonb`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "report_run" DROP COLUMN "edited_check"`);
        await q.query(`ALTER TABLE "report_run" DROP COLUMN "edited_file"`);
        await q.query(`ALTER TABLE "source_file" DROP COLUMN "pii_warning"`);
    }
}
