import { MigrationInterface, QueryRunner } from "typeorm";

/** GĐ B: file nguồn mang "ngày chốt số liệu" của riêng nó (bộ phận khai khi nộp) — số bóc từ file lấy ngày này thay vì ngày nộp. */
export class DemoOps1791300000000 implements MigrationInterface {
    name = 'DemoOps1791300000000'

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "source_file" ADD "as_of_date" date`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "source_file" DROP COLUMN "as_of_date"`);
    }
}
