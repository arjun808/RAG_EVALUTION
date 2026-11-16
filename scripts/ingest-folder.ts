import * as fs from 'fs';
import * as path from 'path';

interface IngestResponse {
  documentId: string;
  status: 'created' | 'skipped';
  chunkCount: number;
}

async function main(): Promise<void> {
  const targetDir = process.argv[2] || './data/docs';
  const resolvedDir = path.resolve(process.cwd(), targetDir);

  if (!fs.existsSync(resolvedDir)) {
    console.error(`Target directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  const baseUrl = (process.env.INGEST_URL || 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );
  const ingestEndpoint = `${baseUrl}/ingest`;

  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  const validFiles = entries.filter((entry) => {
    if (!entry.isFile()) return false;
    const ext = path.extname(entry.name).toLowerCase();
    return ext === '.md' || ext === '.txt';
  });

  if (validFiles.length === 0) {
    console.log(`No .md or .txt files found in ${resolvedDir}`);
    return;
  }

  console.log(
    `Ingesting ${validFiles.length} files from ${resolvedDir} to ${ingestEndpoint}...`,
  );

  for (const entry of validFiles) {
    const filePath = path.join(resolvedDir, entry.name);
    const ext = path.extname(entry.name);
    const title = path.basename(entry.name, ext);
    const relativeSource = path
      .relative(process.cwd(), filePath)
      .replace(/\\/g, '/');

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      const response = await fetch(ingestEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          content,
          source: relativeSource,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `Failed: ${entry.name} - HTTP ${response.status}: ${errorText}`,
        );
        continue;
      }

      const result = (await response.json()) as IngestResponse;
      console.log(
        `${entry.name}: status=${result.status}, chunkCount=${result.chunkCount}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error(`Error processing ${entry.name}: ${message}`);
    }
  }

  console.log('Ingestion finished.');
}

void main();
