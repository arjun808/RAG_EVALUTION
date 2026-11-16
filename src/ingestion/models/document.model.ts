import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  AllowNull,
  Unique,
  HasMany,
} from 'sequelize-typescript';
import { ChunkModel } from './chunk.model';

@Table({
  tableName: 'documents',
  underscored: true,
})
export class DocumentModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare title: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare source: string | null;

  @AllowNull(false)
  @Unique
  @Column(DataType.TEXT)
  declare contentHash: string;

  @AllowNull(false)
  @Default({})
  @Column(DataType.JSONB)
  declare metadata: Record<string, unknown>;

  @HasMany(() => ChunkModel)
  declare chunks: ChunkModel[];

  declare createdAt: Date;
  declare updatedAt: Date;
}
