import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  Default,
  AllowNull,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { DocumentModel } from './document.model';

@Table({
  tableName: 'chunks',
  underscored: true,
  updatedAt: false,
})
export class ChunkModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => DocumentModel)
  @AllowNull(false)
  @Column(DataType.UUID)
  declare documentId: string;

  @BelongsTo(() => DocumentModel)
  declare document: DocumentModel;

  @AllowNull(false)
  @Column(DataType.INTEGER)
  declare chunkIndex: number;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare content: string;

  @AllowNull(false)
  @Default({})
  @Column(DataType.JSONB)
  declare metadata: Record<string, unknown>;

  declare createdAt: Date;
}
