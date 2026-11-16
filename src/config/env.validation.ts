import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  DB_HOST: string = 'localhost';

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  DB_PORT: number = 5432;

  @IsString()
  @IsOptional()
  DB_USER?: string;

  @IsString()
  @IsOptional()
  DB_PASSWORD?: string;

  @IsString()
  @IsOptional()
  DB_NAME?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  CHUNK_SIZE: number = 1000;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  CHUNK_OVERLAP: number = 200;

  @IsString()
  @IsNotEmpty()
  GEMINI_API_KEY: string;

  @IsString()
  @IsOptional()
  EMBEDDING_MODEL: string = 'gemini-embedding-001';

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  EMBEDDING_DIMENSIONS: number = 1536;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  EMBEDDING_BATCH_SIZE: number = 20;
}

export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
