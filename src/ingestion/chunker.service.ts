import { Injectable } from '@nestjs/common';

@Injectable()
export class ChunkerService {
  private readonly defaultSeparators: string[] = [
    '\n\n',
    '\n',
    '. ',
    '! ',
    '? ',
    ' ',
    '',
  ];

  chunk(text: string, chunkSize: number, overlap: number): string[] {
    if (chunkSize <= 0) {
      throw new Error('chunkSize must be greater than 0');
    }
    if (overlap < 0) {
      throw new Error('overlap must be non-negative');
    }
    if (overlap >= chunkSize) {
      throw new Error('overlap must be less than chunkSize');
    }

    if (!text || text.trim().length === 0) {
      return [];
    }

    const normalizedText = text.replace(/\r\n/g, '\n');
    if (normalizedText.trim().length <= chunkSize) {
      return [normalizedText.trim()];
    }

    const atomicSplits = this.getAtomicSplits(
      normalizedText,
      this.defaultSeparators,
      chunkSize,
    );

    return this.mergeSplits(atomicSplits, chunkSize, overlap);
  }

  private getAtomicSplits(
    text: string,
    separators: string[],
    chunkSize: number,
  ): string[] {
    if (text.length <= chunkSize) {
      return [text];
    }

    let separator = '';
    let nextSeparators: string[] = [];

    for (let i = 0; i < separators.length; i++) {
      const s = separators[i];
      if (s === '') {
        separator = '';
        nextSeparators = [];
        break;
      }
      if (text.includes(s)) {
        separator = s;
        nextSeparators = separators.slice(i + 1);
        break;
      }
    }

    const splits = this.splitKeepingSeparator(text, separator);
    const result: string[] = [];

    for (const split of splits) {
      if (split.length <= chunkSize) {
        result.push(split);
      } else {
        if (nextSeparators.length === 0) {
          // Hard-cut as last resort
          for (let j = 0; j < split.length; j += chunkSize) {
            result.push(split.substring(j, j + chunkSize));
          }
        } else {
          result.push(
            ...this.getAtomicSplits(split, nextSeparators, chunkSize),
          );
        }
      }
    }

    return result;
  }

  private splitKeepingSeparator(text: string, separator: string): string[] {
    if (separator === '') {
      return Array.from(text);
    }

    const parts = text.split(separator);
    const result: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i < parts.length - 1) {
        result.push(part + separator);
      } else if (part.length > 0) {
        result.push(part);
      }
    }

    return result;
  }

  private mergeSplits(
    splits: string[],
    chunkSize: number,
    overlap: number,
  ): string[] {
    const chunks: string[] = [];
    const currentDoc: string[] = [];

    const getCurrentLength = (docs: string[]): number => {
      return docs.reduce((acc, item) => acc + item.length, 0);
    };

    for (const piece of splits) {
      const pieceLen = piece.length;

      if (getCurrentLength(currentDoc) + pieceLen > chunkSize) {
        if (currentDoc.length > 0) {
          const docStr = currentDoc.join('').trim();
          if (docStr.length > 0) {
            chunks.push(docStr);
          }

          while (
            currentDoc.length > 0 &&
            (getCurrentLength(currentDoc) > overlap ||
              getCurrentLength(currentDoc) + pieceLen > chunkSize)
          ) {
            currentDoc.shift();
          }

          if (currentDoc.length === 0 && overlap > 0 && chunks.length > 0) {
            const lastChunk = chunks[chunks.length - 1];
            const maxAllowed = chunkSize - pieceLen - 1;
            if (maxAllowed > 0) {
              const tail = this.getOverlapTail(lastChunk, overlap, maxAllowed);
              if (tail.length > 0) {
                const tailWithSep =
                  !tail.endsWith(' ') &&
                  !tail.endsWith('\n') &&
                  !piece.startsWith(' ') &&
                  !piece.startsWith('\n')
                    ? tail + ' '
                    : tail;
                currentDoc.push(tailWithSep);
              }
            }
          }
        }
      }

      currentDoc.push(piece);
    }

    if (currentDoc.length > 0) {
      const docStr = currentDoc.join('').trim();
      if (docStr.length > 0) {
        chunks.push(docStr);
      }
    }

    return chunks;
  }

  private getOverlapTail(
    text: string,
    overlap: number,
    maxAllowedLen: number,
  ): string {
    const targetLen = Math.min(overlap, maxAllowedLen);
    if (targetLen <= 0 || text.length === 0) {
      return '';
    }

    if (text.length <= targetLen) {
      return text;
    }

    const slice = text.slice(-targetLen);
    const spaceIdx = slice.indexOf(' ');
    if (spaceIdx > 0 && spaceIdx < slice.length / 2) {
      return slice.slice(spaceIdx + 1);
    }

    return slice;
  }
}
